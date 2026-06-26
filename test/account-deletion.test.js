import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `capture-account-deletion-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const { initDatabase, db } = await import("../src/backend/db/database.js");
const {
  createAccount,
  createCaptureJob,
  deleteAccount,
  failInterruptedCaptureJobs,
  getAccount,
  getCaptureJob,
  listDueAccounts,
  markJobRunning,
  updateAccount
} = await import("../src/backend/services/repository.js");

initDatabase();

test("deleting an account invalidates its running job and removes it from scheduling", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "deletion-race-test",
    profile_url: `https://example.com/account-${process.pid}`,
    capture_frequency: "daily",
    preferred_capture_time: "09:00"
  });
  const job = createCaptureJob(account.id, "daily");
  markJobRunning(job.id);

  deleteAccount(account.id);

  assert.equal(getCaptureJob(job.id).status, "skipped");
  assert.equal(listDueAccounts().some((item) => item.id === account.id), false);
});

test("a skipped job cannot be moved back to running", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "skipped-job-test",
    profile_url: `https://example.com/skipped-${process.pid}`,
    capture_frequency: "daily"
  });
  const job = createCaptureJob(account.id, "daily");

  deleteAccount(account.id);
  markJobRunning(job.id);

  assert.equal(getCaptureJob(job.id).status, "skipped");
});

test("a stale running job is closed before creating a new capture job", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "stale-running-job-test",
    profile_url: `https://example.com/stale-running-${process.pid}`,
    capture_frequency: "daily"
  });
  const staleJob = createCaptureJob(account.id, "daily");
  markJobRunning(staleJob.id);
  db.prepare(
    "UPDATE capture_jobs SET started_at = ?, updated_at = ? WHERE id = ?"
  ).run("2026-06-24T00:00:00.000Z", "2026-06-24T00:00:00.000Z", staleJob.id);

  const newJob = createCaptureJob(account.id, "manual_now", "2026-06-25T00:00:00.000Z");

  assert.notEqual(newJob.id, staleJob.id);
  assert.equal(newJob.status, "pending");
  assert.equal(getCaptureJob(staleJob.id).status, "failed");
  assert.equal(getCaptureJob(staleJob.id).error_code, "CAPTURE_TIMEOUT");
});

test("interrupted running jobs are closed on service startup recovery", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "startup-recovery-test",
    profile_url: `https://example.com/startup-recovery-${process.pid}`,
    capture_frequency: "daily"
  });
  const job = createCaptureJob(account.id, "daily");
  markJobRunning(job.id);

  const changed = failInterruptedCaptureJobs(new Date("2026-06-25T00:00:00.000Z"));

  assert.equal(changed >= 1, true);
  assert.equal(getCaptureJob(job.id).status, "failed");
  assert.equal(getCaptureJob(job.id).error_code, "CAPTURE_INTERRUPTED");
});

test("account capture video limit defaults to 10 and can be customized", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "video-limit-test",
    profile_url: `https://example.com/video-limit-${process.pid}`,
    capture_frequency: "daily"
  });

  assert.equal(account.capture_video_limit, 10);

  updateAccount(account.id, { capture_video_limit: 25 });

  assert.equal(getAccount(account.id).capture_video_limit, 25);
});
