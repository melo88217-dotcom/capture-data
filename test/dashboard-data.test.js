import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `capture-dashboard-data-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const { initDatabase, db } = await import("../src/backend/db/database.js");
const { isImplausibleMetricChange } = await import("../src/backend/utils/dataQuality.js");
const {
  clearAccountCaptureData,
  computeWeeklySummaries,
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
  listTopLikedVideos,
  saveCaptureResult
} = await import("../src/backend/services/repository.js");

initDatabase();

test("metric quality guard handles nulls and both discontinuity directions at its boundaries", () => {
  assert.equal(isImplausibleMetricChange(null, 1000), false);
  assert.equal(isImplausibleMetricChange(100, 81), false);
  assert.equal(isImplausibleMetricChange(100, 26), false);
  assert.equal(isImplausibleMetricChange(100, 25), true);
  assert.equal(isImplausibleMetricChange(25, 100), true);
});

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

test("daily changes carry the last valid video metrics across a failed capture", () => {
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

  assert.equal(failedDay.like_total, 200);
  assert.equal(failedDay.comment_total, 20);
  assert.equal(failedDay.favorite_total, 10);
  assert.equal(failedDay.like_delta, 0);
  assert.equal(failedDay.comment_delta, 0);
  assert.equal(failedDay.favorite_delta, 0);
  assert.equal(recoveredDay.like_total, 220);
  assert.equal(recoveredDay.like_delta, 20);
  assert.equal(recoveredDay.comment_delta, 2);
  assert.equal(recoveredDay.favorite_delta, 1);
});

test("daily changes keep prior video totals when a capture returns no videos", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "daily-empty-video-capture",
    profile_url: `https://example.com/daily-empty-video-capture-${process.pid}`,
    capture_frequency: "daily"
  });
  const video = db.prepare(
    `INSERT INTO videos (account_id, video_url, title, published_at) VALUES (?, ?, ?, ?)`
  ).run(
    account.id,
    `https://example.com/v/daily-empty-video-capture-${process.pid}`,
    "carried video",
    "2026-07-01T00:00:00.000Z"
  ).lastInsertRowid;

  db.prepare(
    `INSERT INTO account_snapshots (
      account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
    ) VALUES (?, ?, 1000, 'available', '1000', ?), (?, ?, 1001, 'available', '1001', ?)`
  ).run(
    account.id, "2026-07-10T01:00:00.000Z", account.profile_url,
    account.id, "2026-07-11T01:00:00.000Z", account.profile_url
  );
  db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status
    ) VALUES (?, ?, 234400, 32000, 22000, 'available', 'available', 'available')`
  ).run(video, "2026-07-10T01:00:00.000Z");

  const rows = listDailyChanges({ account_id: account.id, limit: "10" });
  const emptyDay = rows.find((row) => row.day === "2026-07-11");

  assert.equal(emptyDay.video_count, 1);
  assert.equal(emptyDay.like_total, 234400);
  assert.equal(emptyDay.comment_total, 32000);
  assert.equal(emptyDay.favorite_total, 22000);
  assert.equal(emptyDay.like_delta, 0);
  assert.equal(emptyDay.comment_delta, 0);
  assert.equal(emptyDay.favorite_delta, 0);
});

test("daily changes compare the same videos when the capture sample rotates", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "daily-rotating-video-sample",
    profile_url: `https://example.com/daily-rotating-video-sample-${process.pid}`,
    capture_frequency: "daily"
  });
  const insertVideo = db.prepare(
    `INSERT INTO videos (account_id, video_url, title, published_at) VALUES (?, ?, ?, ?)`
  );
  const stableVideo = insertVideo.run(
    account.id, `https://example.com/v/stable-${process.pid}`, "stable", "2026-07-01T00:00:00.000Z"
  ).lastInsertRowid;
  const missingVideo = insertVideo.run(
    account.id, `https://example.com/v/missing-${process.pid}`, "missing", "2026-07-01T00:00:00.000Z"
  ).lastInsertRowid;
  const newlySeenVideo = insertVideo.run(
    account.id, `https://example.com/v/newly-seen-${process.pid}`, "newly seen", "2026-06-01T00:00:00.000Z"
  ).lastInsertRowid;

  db.prepare(
    `INSERT INTO account_snapshots (
      account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
    ) VALUES (?, ?, 1000, 'available', '1000', ?), (?, ?, 1001, 'available', '1001', ?)`
  ).run(
    account.id, "2026-07-20T01:00:00.000Z", account.profile_url,
    account.id, "2026-07-21T01:00:00.000Z", account.profile_url
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status
    ) VALUES (?, ?, ?, ?, ?, 'available', 'available', 'available')`
  );
  insertSnapshot.run(stableVideo, "2026-07-20T01:00:00.000Z", 100, 10, 5);
  insertSnapshot.run(missingVideo, "2026-07-20T01:00:00.000Z", 500, 50, 25);
  insertSnapshot.run(stableVideo, "2026-07-21T01:00:00.000Z", 107, 12, 6);
  insertSnapshot.run(newlySeenVideo, "2026-07-21T01:00:00.000Z", 10000, 900, 800);

  const rows = listDailyChanges({ account_id: account.id, limit: "10" });
  const rotatedDay = rows.find((row) => row.day === "2026-07-21");

  assert.equal(rotatedDay.video_count, 3);
  assert.equal(rotatedDay.like_total, 10607);
  assert.equal(rotatedDay.comment_total, 962);
  assert.equal(rotatedDay.favorite_total, 831);
  assert.equal(rotatedDay.like_delta, 7);
  assert.equal(rotatedDay.comment_delta, 2);
  assert.equal(rotatedDay.favorite_delta, 1);
});

test("limited daily changes seed totals before the requested window", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "daily-window-seed",
    profile_url: `https://example.com/daily-window-seed-${process.pid}`,
    capture_frequency: "daily"
  });
  const videoId = db.prepare(
    "INSERT INTO videos (account_id, video_url, title) VALUES (?, ?, 'window seed')"
  ).run(account.id, `https://example.com/v/daily-window-seed-${process.pid}`).lastInsertRowid;
  const insertAccountSnapshot = db.prepare(
    `INSERT INTO account_snapshots (
       account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
     ) VALUES (?, ?, ?, 'available', ?, ?)`
  );
  const insertVideoSnapshot = db.prepare(
    `INSERT INTO video_snapshots (
       video_id, captured_at, like_count, comment_count, favorite_count,
       like_count_status, comment_count_status, favorite_count_status
     ) VALUES (?, ?, ?, ?, ?, 'available', 'available', 'available')`
  );
  for (let day = 1; day <= 30; day += 1) {
    const capturedAt = new Date(Date.UTC(2026, 5, day, 1)).toISOString();
    insertAccountSnapshot.run(account.id, capturedAt, 1000 + day, String(1000 + day), account.profile_url);
    insertVideoSnapshot.run(videoId, capturedAt, 100 + day, 10 + day, 5 + day);
  }

  const rows = listDailyChanges({ account_id: account.id, limit: 2 });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, "2026-06-30");
  assert.equal(rows[0].like_total, 130);
  assert.equal(rows[0].like_delta, 1);
  assert.equal(rows[1].day, "2026-06-29");
  assert.equal(rows[1].like_total, 129);
  assert.equal(rows[1].like_delta, null);
});

test("capture persistence quarantines implausible follower and video metric drops", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "capture-quality-guard",
    profile_url: `https://example.com/capture-quality-guard-${process.pid}`,
    capture_frequency: "daily",
    like_alert_threshold: 100
  });
  const firstJob = createCaptureJob(account.id, "manual_now");
  const secondJob = createCaptureJob(account.id, "manual_now");
  const videoUrl = `https://example.com/v/capture-quality-guard-${process.pid}`;
  const baseResult = {
    status: "success",
    error_code: null,
    error_message: null,
    account: {
      profile_url: account.profile_url,
      follower_count: 10000,
      follower_count_status: "available",
      raw_follower_text: "1.0万"
    },
    videos: [{
      video_url: videoUrl,
      title: "quality guarded video",
      like_count: 1000,
      comment_count: 100,
      favorite_count: 50,
      like_count_status: "available",
      comment_count_status: "available",
      favorite_count_status: "available"
    }]
  };

  saveCaptureResult(firstJob, { ...baseResult, captured_at: "2026-07-22T01:00:00.000Z" });
  const quality = saveCaptureResult(secondJob, {
    ...baseResult,
    captured_at: "2026-07-23T01:00:00.000Z",
    account: { ...baseResult.account, follower_count: 4, raw_follower_text: "4" },
    videos: [{
      ...baseResult.videos[0],
      like_count: 20,
      comment_count: 1,
      favorite_count: 1
    }]
  });

  const latestAccountSnapshot = db.prepare(
    "SELECT * FROM account_snapshots WHERE account_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1"
  ).get(account.id);
  const latestVideoSnapshot = db.prepare(
    `SELECT vs.* FROM video_snapshots vs JOIN videos v ON v.id = vs.video_id
     WHERE v.account_id = ? ORDER BY vs.captured_at DESC, vs.id DESC LIMIT 1`
  ).get(account.id);
  const savedAccount = db.prepare("SELECT latest_follower_count FROM accounts WHERE id = ?").get(account.id);
  const listedVideo = listVideos({ account_id: account.id })[0];
  const topVideo = listTopLikedVideos(10000).find((video) => video.video_url === videoUrl);
  const hotVideo = listHotVideos({ months: "all", limit: 10000 }).find((video) => video.video_url === videoUrl);

  assert.equal(latestAccountSnapshot.follower_count_status, "failed");
  assert.equal(latestVideoSnapshot.like_count_status, "failed");
  assert.equal(latestVideoSnapshot.comment_count_status, "failed");
  assert.equal(latestVideoSnapshot.favorite_count_status, "failed");
  assert.equal(savedAccount.latest_follower_count, 10000);
  assert.equal(quality.warnings.length, 4);
  assert.equal(listedVideo.like_count, 1000);
  assert.equal(listedVideo.comment_count, 100);
  assert.equal(listedVideo.favorite_count, 50);
  assert.equal(topVideo.like_count, 1000);
  assert.equal(hotVideo.like_count, 1000);
});

test("capture persistence quarantines an isolated upward spike and accepts a corroborated new range", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "capture-quality-confirmation",
    profile_url: `https://example.com/capture-quality-confirmation-${process.pid}`,
    capture_frequency: "daily"
  });
  const videoUrl = `https://example.com/v/capture-quality-confirmation-${process.pid}`;
  const resultFor = (capturedAt, followerCount, likeCount) => ({
    captured_at: capturedAt,
    status: "success",
    account: {
      profile_url: account.profile_url,
      follower_count: followerCount,
      follower_count_status: "available",
      raw_follower_text: String(followerCount)
    },
    videos: [{
      video_url: videoUrl,
      title: "quality confirmation video",
      like_count: likeCount,
      comment_count: 100,
      favorite_count: 50,
      like_count_status: "available",
      comment_count_status: "available",
      favorite_count_status: "available"
    }]
  });

  saveCaptureResult(
    createCaptureJob(account.id, "manual_now"),
    resultFor("2026-07-25T01:00:00.000Z", 100, 100)
  );
  const spike = saveCaptureResult(
    createCaptureJob(account.id, "manual_now"),
    resultFor("2026-07-26T01:00:00.000Z", 10000, 10000)
  );
  const recovery = saveCaptureResult(
    createCaptureJob(account.id, "manual_now"),
    resultFor("2026-07-27T01:00:00.000Z", 101, 101)
  );
  const pendingRange = saveCaptureResult(
    createCaptureJob(account.id, "manual_now"),
    resultFor("2026-07-28T01:00:00.000Z", 10000, 10000)
  );
  const confirmedRange = saveCaptureResult(
    createCaptureJob(account.id, "manual_now"),
    resultFor("2026-07-29T01:00:00.000Z", 10100, 10100)
  );

  const snapshots = db.prepare(
    "SELECT follower_count, follower_count_status FROM account_snapshots WHERE account_id = ? ORDER BY captured_at"
  ).all(account.id);
  const listedVideo = listVideos({ account_id: account.id })[0];

  assert.equal(spike.warnings.length, 2);
  assert.equal(recovery.warnings.length, 0);
  assert.equal(pendingRange.warnings.length, 2);
  assert.equal(confirmedRange.warnings.length, 0);
  assert.deepEqual(snapshots.map((row) => row.follower_count_status), [
    "available", "failed", "available", "failed", "available"
  ]);
  assert.equal(listedVideo.like_count, 10100);
});

test("capture persistence rejects a video URL already owned by another account", () => {
  const owner = createAccount({
    platform: "douyin",
    display_name: "video-url-owner",
    profile_url: `https://example.com/video-url-owner-${process.pid}`,
    capture_frequency: "daily"
  });
  const other = createAccount({
    platform: "douyin",
    display_name: "video-url-other",
    profile_url: `https://example.com/video-url-other-${process.pid}`,
    capture_frequency: "daily"
  });
  const sharedUrl = `https://example.com/v/globally-owned-${process.pid}`;
  const resultFor = (account, capturedAt) => ({
    captured_at: capturedAt,
    status: "success",
    account: {
      profile_url: account.profile_url,
      follower_count: 100,
      follower_count_status: "available",
      raw_follower_text: "100"
    },
    videos: [{
      video_url: sharedUrl,
      title: "globally owned video",
      like_count: 10,
      comment_count: 1,
      favorite_count: 1,
      like_count_status: "available",
      comment_count_status: "available",
      favorite_count_status: "available"
    }]
  });

  saveCaptureResult(createCaptureJob(owner.id, "manual_now"), resultFor(owner, "2026-07-24T01:00:00.000Z"));
  const quality = saveCaptureResult(
    createCaptureJob(other.id, "manual_now"),
    resultFor(other, "2026-07-24T02:00:00.000Z")
  );

  const rows = db.prepare("SELECT account_id FROM videos WHERE video_url = ?").all(sharedUrl);
  assert.deepEqual(rows.map((row) => row.account_id), [owner.id]);
  assert.equal(quality.rejected_video_count, 1);
  assert.equal(quality.warnings.length, 1);
});

test("weekly summaries ignore failed metric snapshots", () => {
  const account = createAccount({
    platform: "douyin",
    display_name: "weekly-failed-metric",
    profile_url: `https://example.com/weekly-failed-metric-${process.pid}`,
    capture_frequency: "daily"
  });
  const video = db.prepare(
    `INSERT INTO videos (account_id, video_url, title, published_at) VALUES (?, ?, ?, ?)`
  ).run(
    account.id,
    `https://example.com/v/weekly-failed-metric-${process.pid}`,
    "weekly failed metric",
    "2026-07-01T00:00:00.000Z"
  ).lastInsertRowid;
  db.prepare(
    `INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status
    ) VALUES
      (?, '2026-07-06T01:00:00.000Z', 100, 10, 5, 'available', 'available', 'available'),
      (?, '2026-07-10T01:00:00.000Z', 1, 1, 1, 'failed', 'failed', 'failed')`
  ).run(video, video);

  computeWeeklySummaries(new Date("2026-07-08T12:00:00.000Z"));
  const summary = db.prepare(
    "SELECT * FROM weekly_summaries WHERE account_id = ? ORDER BY id DESC LIMIT 1"
  ).get(account.id);

  assert.equal(summary.video_like_delta, 0);
  assert.equal(summary.video_comment_delta, 0);
  assert.equal(summary.video_favorite_delta, 0);
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
