import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";
import test, { after } from "node:test";
import assert from "node:assert/strict";

const testDbPath = path.join(os.tmpdir(), `capture-job-retry-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const { db, initDatabase } = await import("../src/backend/db/database.js");
const {
  createCaptureJob,
  getCaptureJob,
  markJobRetrying,
  markJobRunning
} = await import("../src/backend/services/repository.js");

initDatabase();

after(async () => {
  db.close();
  await unlink(testDbPath).catch(() => {});
  await unlink(`${testDbPath}-wal`).catch(() => {});
  await unlink(`${testDbPath}-shm`).catch(() => {});
});

test("a running job exposes automatic retry progress without becoming a new scheduled job", () => {
  const platform = db.prepare("SELECT id FROM platforms WHERE code = 'douyin'").get();
  const accountId = db.prepare(
    `INSERT INTO accounts (platform_id, display_name, profile_url)
     VALUES (?, '重试测试账号', 'https://www.douyin.com/user/retry-test')`
  ).run(platform.id).lastInsertRowid;
  const job = createCaptureJob(accountId, "daily");
  assert.equal(markJobRunning(job.id), true);

  markJobRetrying(job.id, {
    retryCount: 1,
    errorCode: "PAGE_RENDER_INCOMPLETE",
    errorMessage: "页面未完整渲染，系统将在 1 分钟后自动重试。"
  });

  const retrying = getCaptureJob(job.id);
  assert.equal(retrying.status, "running");
  assert.equal(retrying.retry_count, 1);
  assert.equal(retrying.error_code, "PAGE_RENDER_INCOMPLETE");
  assert.match(retrying.error_message, /自动重试/);
});
