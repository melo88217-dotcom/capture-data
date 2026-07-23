import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";
import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";

const testDbPath = path.join(os.tmpdir(), `capture-runner-retry-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const { db, initDatabase } = await import("../src/backend/db/database.js");
const { createCaptureJob, getCaptureJob } = await import("../src/backend/services/repository.js");
const { CaptureTrafficGuard } = await import("../src/backend/utils/captureRetry.js");
const { runExclusiveBrowserOperation } = await import("../src/backend/services/browserMaintenance.js");
const {
  addRecoverySummary,
  runCaptureJob,
  runQueuedCollectorAttempt
} = await import("../src/backend/services/captureRunner.js");

initDatabase();

after(async () => {
  db.close();
  await unlink(testDbPath).catch(() => {});
  await unlink(`${testDbPath}-wal`).catch(() => {});
  await unlink(`${testDbPath}-shm`).catch(() => {});
});

test("a terminal failure after retry is not reported as recovered", () => {
  const result = addRecoverySummary(
    {
      status: "failed",
      error_code: "LOGIN_REQUIRED",
      error_message: "需要登录",
      diagnostics: {}
    },
    2,
    3
  );

  assert.equal(result.diagnostics.recovered, false);
  assert.equal(result.diagnostics.retry_exhausted, false);
  assert.equal(result.diagnostics.terminal_failure, true);
  assert.doesNotMatch(result.error_message, /恢复成功/);
  assert.match(result.error_message, /不可自动重试/);
});

test("traffic guard wait stops between chunks when the job is cancelled", async () => {
  let now = 1_000;
  let cancellationChecks = 0;
  const sleeps = [];
  const guard = new CaptureTrafficGuard({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    cooldownMs: 5_000
  });
  guard.recordAttemptFinished();

  await assert.rejects(
    guard.wait(
      async () => {},
      async () => {
        cancellationChecks += 1;
        return cancellationChecks >= 3;
      }
    ),
    { code: "CAPTURE_CANCELLED" }
  );
  assert.deepEqual(sleeps, [1_000]);
});

test("a queued attempt checks the guard only after the prior collector settles", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const guard = {
    wait: async () => events.push("guard"),
    recordAttemptFinished: () => events.push("finished")
  };
  const common = {
    runBrowserOperation: runExclusiveBrowserOperation,
    trafficGuard: guard,
    isCancelled: () => false,
    timeoutMs: 1_000,
    timeoutMessage: "timeout",
    onWait: async () => {}
  };

  const first = runQueuedCollectorAttempt({
    ...common,
    collector: async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
      return "first";
    }
  });
  await waitForEvent(events, "first-start");

  const second = runQueuedCollectorAttempt({
    ...common,
    collector: async () => {
      events.push("second-start");
      return "second";
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["guard", "first-start"]);

  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.ok(events.indexOf("first-end") < events.lastIndexOf("guard"));
  assert.ok(events.indexOf("finished") < events.lastIndexOf("guard"));
  assert.ok(events.lastIndexOf("guard") < events.indexOf("second-start"));
});

test("runCaptureJob keeps one job across a retry and persists the recovered result", async () => {
  const accountId = insertAccount("runner-recovery");
  const job = createCaptureJob(accountId, "manual_now");
  const capturedAt = new Date().toISOString();
  const results = [
    {
      status: "failed",
      error_code: "PAGE_RENDER_INCOMPLETE",
      error_message: "page incomplete",
      diagnostics: { video_link_count: 0 }
    },
    {
      platform: "douyin",
      account: {
        display_name: "runner-recovery",
        profile_url: "https://www.douyin.com/user/runner-recovery",
        follower_count: 123,
        follower_count_status: "available",
        raw_follower_text: "123"
      },
      videos: [],
      status: "success",
      error_code: null,
      error_message: null,
      captured_at: capturedAt
    }
  ];
  let calls = 0;

  const finished = await runCaptureJob(job.id, runnerOptions(async () => {
    calls += 1;
    return results.shift();
  }));

  assert.equal(calls, 2);
  assert.equal(finished.id, job.id);
  assert.equal(finished.status, "success");
  assert.equal(finished.retry_count, 1);
  assert.match(finished.error_message, /自动恢复成功/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM account_snapshots WHERE capture_job_id = ?").get(job.id).count,
    1
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM capture_logs WHERE job_id = ? AND message = '采集触发自动重试'").get(job.id)
      .count,
    1
  );
});

test("runCaptureJob does not retry a terminal login failure", async () => {
  const accountId = insertAccount("runner-login");
  const job = createCaptureJob(accountId, "manual_now");
  let calls = 0;

  const finished = await runCaptureJob(job.id, runnerOptions(async () => {
    calls += 1;
    return {
      platform: "douyin",
      account: {
        display_name: "runner-login",
        profile_url: "https://www.douyin.com/user/runner-login",
        follower_count: null,
        follower_count_status: "failed",
        raw_follower_text: ""
      },
      videos: [],
      status: "failed",
      error_code: "LOGIN_REQUIRED",
      error_message: "login required",
      captured_at: new Date().toISOString()
    };
  }));

  assert.equal(calls, 1);
  assert.equal(finished.status, "failed");
  assert.equal(finished.retry_count, 0);
  assert.equal(finished.error_code, "LOGIN_REQUIRED");
});

function runnerOptions(collector) {
  return {
    collector,
    retryDelaysMs: [0],
    retrySleep: async () => {},
    resetPage: async () => {},
    timeoutMs: 1_000,
    captureTrafficGuard: new CaptureTrafficGuard({ cooldownMs: 0, circuitBreakMs: 0 }),
    runBrowserOperation: runExclusiveBrowserOperation
  };
}

function insertAccount(slug) {
  const platform = db.prepare("SELECT id FROM platforms WHERE code = 'douyin'").get();
  return db
    .prepare("INSERT INTO accounts (platform_id, display_name, profile_url) VALUES (?, ?, ?)")
    .run(platform.id, slug, `https://www.douyin.com/user/${slug}`).lastInsertRowid;
}

async function waitForEvent(events, expected) {
  for (let index = 0; index < 20 && !events.includes(expected); index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(events.includes(expected), `missing event: ${expected}`);
}
