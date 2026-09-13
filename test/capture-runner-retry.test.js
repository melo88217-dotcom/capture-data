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

test("daily collection passes the configured video limit to its collector", async () => {
  const accountId = insertAccount("runner-daily-video-limit", { captureVideoLimit: 5 });
  const job = createCaptureJob(accountId, "daily");
  let receivedLimit = null;

  const finished = await runCaptureJob(job.id, runnerOptions(async (account) => {
    receivedLimit = account.capture_video_limit;
    return {
      platform: "douyin",
      account: {
        display_name: "runner-daily-video-limit",
        profile_url: "https://www.douyin.com/user/runner-daily-video-limit",
        follower_count: 100,
        follower_count_status: "available",
        raw_follower_text: "100"
      },
      videos: [],
      status: "success",
      error_code: null,
      error_message: null,
      captured_at: new Date().toISOString()
    };
  }));

  assert.equal(finished.status, "success");
  assert.equal(receivedLimit, 5);
});

test("a data-quality warning does not downgrade a successful automatic capture", async () => {
  const accountId = insertAccount("runner-quality-warning");
  const job = createCaptureJob(accountId, "daily");
  const videoUrl = `https://www.douyin.com/video/runner-quality-warning-${process.pid}`;
  const videoId = db
    .prepare("INSERT INTO videos (account_id, video_url, title) VALUES (?, ?, ?)")
    .run(accountId, videoUrl, "quality warning video").lastInsertRowid;
  db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status
    ) VALUES (?, ?, ?, ?, ?, 'available', 'available', 'available')`
  ).run(videoId, "2026-07-28T01:00:00.000Z", 1_000, 100, 50);

  const finished = await runCaptureJob(job.id, runnerOptions(async () => ({
    platform: "douyin",
    account: {
      display_name: "runner-quality-warning",
      profile_url: "https://www.douyin.com/user/runner-quality-warning",
      follower_count: 1_234,
      follower_count_status: "available",
      raw_follower_text: "1234"
    },
    videos: [{
      video_url: videoUrl,
      title: "quality warning video",
      like_count: 1,
      comment_count: 1,
      favorite_count: 1,
      like_count_status: "available",
      comment_count_status: "available",
      favorite_count_status: "available"
    }],
    status: "success",
    error_code: null,
    error_message: null,
    captured_at: "2026-07-29T01:00:00.000Z"
  })));

  assert.equal(finished.status, "success");
  assert.equal(finished.error_code, "DATA_QUALITY_WARNING");
  assert.match(finished.error_message, /数据质量校验已排除 3 个异常值/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM capture_logs WHERE job_id = ? AND message = '采集数据质量校验'").get(job.id)
      .count,
    1
  );
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

function insertAccount(slug, { captureVideoLimit = 10 } = {}) {
  const platform = db.prepare("SELECT id FROM platforms WHERE code = 'douyin'").get();
  return db
    .prepare("INSERT INTO accounts (platform_id, display_name, profile_url, capture_video_limit) VALUES (?, ?, ?, ?)")
    .run(platform.id, slug, `https://www.douyin.com/user/${slug}`, captureVideoLimit).lastInsertRowid;
}

async function waitForEvent(events, expected) {
  for (let index = 0; index < 20 && !events.includes(expected); index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(events.includes(expected), `missing event: ${expected}`);
}
