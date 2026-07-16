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
  getOverview,
  listVideos,
  listWeeklySummaries,
  listTopLikedVideos
} = await import("../src/backend/services/repository.js");

initDatabase();

test("overview totals include only the current week's summaries", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "current-week-overview",
    profile_url: `https://example.com/current-week-overview-${process.pid}`,
    capture_frequency: "daily"
  });
  const now = new Date();
  const day = now.getDay() || 7;
  const currentWeekStart = new Date(now);
  currentWeekStart.setHours(0, 0, 0, 0);
  currentWeekStart.setDate(now.getDate() - day + 1);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  db.prepare(
    `INSERT INTO weekly_summaries (
      account_id, week_start, week_end, follower_delta, video_like_delta,
      video_comment_delta, video_favorite_delta, data_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(account.id, previousWeekStart.toISOString(), new Date(currentWeekStart.getTime() - 1).toISOString(), -488899, 1, 1, 1, "complete");

  db.prepare(
    `INSERT INTO account_snapshots (
      account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
    ) VALUES (?, ?, ?, 'available', ?, ?), (?, ?, ?, 'available', ?, ?)`
  ).run(
    account.id, new Date(currentWeekStart.getTime() + 3600000).toISOString(), 1000, "1000", account.profile_url,
    account.id, new Date(currentWeekStart.getTime() + 7200000).toISOString(), 1154, "1154", account.profile_url
  );

  const overview = getOverview();

  assert.equal(overview.weeklyTotals.followers, 154);
  assert.equal(overview.weeklyTotals.interactions, 0);
});

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

test("hot videos default to recent three months and accept a custom month range", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "recent-hot-videos",
    profile_url: `https://example.com/recent-hot-videos-${process.pid}`,
    capture_frequency: "daily",
    like_alert_threshold: 10
  });
  const recentPublishedAt = new Date();
  recentPublishedAt.setMonth(recentPublishedAt.getMonth() - 1);
  const olderPublishedAt = new Date();
  olderPublishedAt.setMonth(olderPublishedAt.getMonth() - 4);
  const ancientPublishedAt = new Date();
  ancientPublishedAt.setMonth(ancientPublishedAt.getMonth() - 121);

  addVideo(account.id, "https://example.com/v/recent-hot", "recent hot", recentPublishedAt.toISOString(), 30);
  addVideo(account.id, "https://example.com/v/older-hot", "older hot", olderPublishedAt.toISOString(), 50);
  addVideo(account.id, "https://example.com/v/ancient-hot", "ancient hot", ancientPublishedAt.toISOString(), 70);

  const defaultRows = listHotVideos();
  const sixMonthRows = listHotVideos({ months: "6" });
  const allRows = listHotVideos({ months: "all" });
  const invalidRows = listHotVideos({ months: "invalid" });
  const zeroRows = listHotVideos({ months: "0" });
  const cappedRows = listHotVideos({ months: "121" });

  assert.equal(defaultRows.some((item) => item.title === "recent hot"), true);
  assert.equal(defaultRows.some((item) => item.title === "older hot"), false);
  assert.equal(sixMonthRows.some((item) => item.title === "older hot"), true);
  assert.equal(allRows.some((item) => item.title === "older hot"), true);
  assert.equal(invalidRows.some((item) => item.title === "older hot"), false);
  assert.equal(zeroRows.some((item) => item.title === "older hot"), false);
  assert.equal(cappedRows.some((item) => item.title === "ancient hot"), false);
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

test("daily changes do not treat failed video metric snapshots as zero", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "daily-video-failed-not-zero",
    profile_url: `https://example.com/daily-video-failed-not-zero-${process.pid}`,
    capture_frequency: "daily"
  });

  const video = db.prepare(
    `INSERT INTO videos (account_id, video_url, title, published_at) VALUES (?, ?, ?, ?)`
  ).run(account.id, `https://example.com/v/failed-not-zero-${process.pid}`, "failed metric video", "2026-07-01T00:00:00.000Z").lastInsertRowid;

  db.prepare(
    `INSERT INTO account_snapshots (
      account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
    ) VALUES (?, ?, ?, 'available', ?, ?), (?, ?, ?, 'available', ?, ?), (?, ?, ?, 'available', ?, ?)`
  ).run(
    account.id, "2026-07-05T01:00:00.000Z", 1000, "1000", account.profile_url,
    account.id, "2026-07-06T01:00:00.000Z", 1001, "1001", account.profile_url,
    account.id, "2026-07-08T01:00:00.000Z", 1002, "1002", account.profile_url
  );
  db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status, raw_metric_text
    ) VALUES
      (?, ?, 200, 20, 10, 'available', 'available', 'available', ''),
      (?, ?, NULL, NULL, NULL, 'failed', 'failed', 'failed', '页面要求登录后查看。'),
      (?, ?, 220, 22, 11, 'available', 'available', 'available', '')`
  ).run(
    video, "2026-07-05T01:00:00.000Z",
    video, "2026-07-06T01:00:00.000Z",
    video, "2026-07-08T01:00:00.000Z"
  );

  const rows = listDailyChanges({ account_id: account.id, limit: "10" });
  const failedDay = rows.find((row) => row.day === "2026-07-06");
  const recoveredDay = rows.find((row) => row.day === "2026-07-08");

  assert.equal(failedDay.like_total, null);
  assert.equal(failedDay.comment_total, null);
  assert.equal(failedDay.favorite_total, null);
  assert.equal(failedDay.like_delta, null);
  assert.equal(failedDay.comment_delta, null);
  assert.equal(failedDay.favorite_delta, null);
  assert.equal(recoveredDay.like_total, 220);
  assert.equal(recoveredDay.like_delta, null);
  assert.equal(recoveredDay.comment_delta, null);
  assert.equal(recoveredDay.favorite_delta, null);
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
