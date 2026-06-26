import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `capture-dashboard-data-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const { initDatabase, db } = await import("../src/backend/db/database.js");
const {
  clearAccountCaptureData,
  createCaptureJob,
  createAccount,
  deleteAccount,
  listCaptureJobs,
  listAccountDashboardRows,
  listDailyChanges,
  listHotVideos,
  listVideos,
  listWeeklySummaries,
  listTopLikedVideos
} = await import("../src/backend/services/repository.js");

initDatabase();

function addVideo(accountId, url, title, publishedAt, likeCount, commentCount = 0, favoriteCount = 0) {
  const info = db.prepare(
    `INSERT INTO videos (account_id, video_url, title, published_at) VALUES (?, ?, ?, ?)`
  ).run(accountId, url, title, publishedAt);
  db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status
    ) VALUES (?, ?, ?, ?, ?, 'available', 'available', 'available')`
  ).run(info.lastInsertRowid, new Date().toISOString(), likeCount, commentCount, favoriteCount);
  return info.lastInsertRowid;
}

test("dashboard account rows include active account video totals and recent video counts", () => {
  const active = createAccount({
    platform: "douyin",
    display_name: "active-dashboard-account",
    profile_url: `https://example.com/dashboard-active-${process.pid}`,
    capture_frequency: "daily"
  });
  const inactive = createAccount({
    platform: "douyin",
    display_name: "inactive-dashboard-account",
    profile_url: `https://example.com/dashboard-inactive-${process.pid}`,
    capture_frequency: "daily",
    is_active: false
  });

  addVideo(active.id, "https://example.com/v/recent", "recent", new Date().toISOString(), 10);
  addVideo(active.id, "https://example.com/v/old", "old", new Date(Date.now() - 10 * 86400000).toISOString(), 20);
  addVideo(inactive.id, "https://example.com/v/inactive", "inactive", new Date().toISOString(), 99);

  const rows = listAccountDashboardRows();
  const row = rows.find((item) => item.id === active.id);

  assert.equal(rows.some((item) => item.id === inactive.id), false);
  assert.equal(row.video_count, 2);
  assert.equal(row.recent_video_count, 1);
});

test("top liked videos use latest real like count and exclude inactive accounts", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "top-liked-active",
    profile_url: `https://example.com/top-liked-active-${process.pid}`,
    capture_frequency: "daily"
  });
  const inactive = createAccount({
    platform: "douyin",
    display_name: "top-liked-inactive",
    profile_url: `https://example.com/top-liked-inactive-${process.pid}`,
    capture_frequency: "daily",
    is_active: false
  });

  addVideo(account.id, "https://example.com/v/low", "low likes", "2026-06-01T00:00:00.000Z", 5, 2, 1);
  addVideo(account.id, "https://example.com/v/high", "high likes", "2026-06-02T00:00:00.000Z", 50, 3, 2);
  addVideo(inactive.id, "https://example.com/v/inactive-top", "inactive high", "2026-06-03T00:00:00.000Z", 500, 9, 9);

  const rows = listTopLikedVideos(5);

  assert.equal(rows[0].title, "high likes");
  assert.equal(rows[0].like_count, 50);
  assert.equal(rows.some((item) => item.title === "inactive high"), false);
});

test("deleted account data is hidden from inner pages and exports", () => {
  const active = createAccount({
    platform: "douyin",
    display_name: "visible-inner-pages",
    profile_url: `https://example.com/visible-inner-${process.pid}`,
    capture_frequency: "daily",
    like_alert_threshold: 10
  });
  const deleted = createAccount({
    platform: "douyin",
    display_name: "deleted-inner-pages",
    profile_url: `https://example.com/deleted-inner-${process.pid}`,
    capture_frequency: "daily",
    like_alert_threshold: 10
  });

  addVideo(active.id, "https://example.com/v/visible-inner", "visible video", "2026-06-10T00:00:00.000Z", 30, 1, 1);
  addVideo(deleted.id, "https://example.com/v/deleted-inner", "deleted video", "2026-06-11T00:00:00.000Z", 99, 9, 9);
  const deletedJob = createCaptureJob(deleted.id, "daily");
  db.prepare(
    `INSERT INTO weekly_summaries (
      account_id, week_start, week_end, follower_delta, video_like_delta,
      video_comment_delta, video_favorite_delta, data_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(deleted.id, "2026-06-08T00:00:00.000Z", "2026-06-14T23:59:59.999Z", 1, 2, 3, 4, "complete");

  deleteAccount(deleted.id);

  assert.equal(listVideos().some((item) => item.account_id === deleted.id), false);
  assert.equal(listVideos({ account_id: deleted.id }).length, 0);
  assert.equal(listHotVideos().some((item) => item.account_id === deleted.id), false);
  assert.equal(listDailyChanges({ account_id: deleted.id }).length, 0);
  assert.equal(listWeeklySummaries().some((item) => item.account_id === deleted.id), false);
  assert.equal(listCaptureJobs().some((item) => item.id === deletedJob.id), false);
});

test("daily changes keep same-day available follower snapshot when later capture misses follower", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "daily-follower-fallback",
    profile_url: `https://example.com/daily-follower-fallback-${process.pid}`,
    capture_frequency: "daily"
  });

  db.prepare(
    `
      INSERT INTO account_snapshots (
        account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(account.id, "2026-06-25T01:00:00.000Z", 1000, "available", "1000", account.profile_url);
  db.prepare(
    `
      INSERT INTO account_snapshots (
        account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(account.id, "2026-06-25T03:00:00.000Z", null, "not_public", "", account.profile_url);

  const rows = listDailyChanges({ account_id: account.id });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].captured_at, "2026-06-25T03:00:00.000Z");
  assert.equal(rows[0].follower_count, 1000);
  assert.equal(rows[0].follower_count_status, "available");
});

test("clearing account capture data keeps account settings and removes historical rows", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "clear-history-account",
    profile_url: `https://example.com/clear-history-${process.pid}`,
    capture_frequency: "weekly",
    preferred_capture_time: "10:30",
    capture_video_limit: 12,
    like_alert_threshold: 300
  });
  const job = createCaptureJob(account.id, "manual_now");

  db.prepare(
    `
      INSERT INTO account_snapshots (
        account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url, capture_job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(account.id, "2026-06-25T01:00:00.000Z", 1000, "available", "1000", account.profile_url, job.id);
  addVideo(account.id, "https://example.com/v/clear-history", "clear history video", "2026-06-25T00:00:00.000Z", 50, 3, 2);
  db.prepare(
    `INSERT INTO weekly_summaries (
      account_id, week_start, week_end, follower_delta, video_like_delta,
      video_comment_delta, video_favorite_delta, data_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(account.id, "2026-06-22T00:00:00.000Z", "2026-06-28T23:59:59.999Z", 1, 2, 3, 4, "complete");

  const result = clearAccountCaptureData(account.id);

  assert.equal(result.account.id, account.id);
  assert.equal(result.account.capture_frequency, "weekly");
  assert.equal(result.account.preferred_capture_time, "10:30");
  assert.equal(result.account.capture_video_limit, 12);
  assert.equal(result.account.like_alert_threshold, 300);
  assert.equal(result.account.latest_follower_count, null);
  assert.equal(listVideos({ account_id: account.id }).length, 0);
  assert.equal(listDailyChanges({ account_id: account.id }).length, 0);
  assert.equal(listWeeklySummaries().some((item) => item.account_id === account.id), false);
  assert.equal(listCaptureJobs().some((item) => item.account_id === account.id), false);
});
