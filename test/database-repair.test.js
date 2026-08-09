import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const testDbPath = path.join(os.tmpdir(), `capture-database-repair-${process.pid}.sqlite`);
process.env.SQLITE_PATH = testDbPath;

const legacy = new DatabaseSync(testDbPath);
legacy.exec(`
  CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    display_name TEXT NOT NULL,
    profile_url TEXT NOT NULL,
    platform_account_id TEXT,
    avatar_url TEXT,
    bio TEXT,
    category TEXT,
    tags TEXT,
    notes TEXT,
    capture_frequency TEXT NOT NULL DEFAULT 'daily',
    preferred_capture_time TEXT NOT NULL DEFAULT '09:00',
    capture_video_limit INTEGER NOT NULL DEFAULT 10,
    like_alert_threshold INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    latest_follower_count INTEGER,
    latest_collect_status TEXT DEFAULT 'unknown',
    last_captured_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform_id, profile_url)
  );
  CREATE TABLE account_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    captured_at TEXT NOT NULL,
    follower_count INTEGER,
    follower_count_status TEXT NOT NULL,
    raw_follower_text TEXT,
    source_url TEXT,
    capture_job_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE capture_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    platform_id INTEGER NOT NULL REFERENCES platforms(id),
    job_type TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    platform_video_id TEXT,
    video_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    cover_url TEXT,
    published_at TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(account_id, video_url)
  );
  CREATE TABLE video_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    like_count INTEGER,
    comment_count INTEGER,
    favorite_count INTEGER,
    like_count_status TEXT NOT NULL,
    comment_count_status TEXT NOT NULL,
    favorite_count_status TEXT NOT NULL,
    raw_metric_text TEXT,
    capture_job_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO platforms (id, code, name) VALUES (1, 'douyin', '抖音');
  INSERT INTO accounts (id, platform_id, display_name, profile_url, latest_collect_status)
  VALUES
    (1, 1, 'canonical owner', 'https://example.com/canonical-owner', 'success'),
    (2, 1, 'follower only repair', 'https://example.com/follower-only-repair', 'success'),
    (3, 1, 'follower outlier repair', 'https://example.com/follower-outlier-repair', 'success');
  INSERT INTO capture_jobs (
    id, account_id, platform_id, job_type, trigger_type, status, scheduled_at, started_at, finished_at
  ) VALUES (
    1, 2, 1, 'profile_and_videos', 'daily', 'success',
    '2026-07-03T01:00:00.000Z', '2026-07-03T01:00:00.000Z', '2026-07-03T01:01:00.000Z'
  );
  INSERT INTO account_snapshots (
    account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url, capture_job_id
  ) VALUES (
    2, '2026-07-03T01:00:00.000Z', 100, 'available', '100',
    'https://example.com/follower-only-repair', 1
  );
  INSERT INTO account_snapshots (
    account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url
  ) VALUES
    (3, '2026-07-01T01:00:00.000Z', 10000, 'available', '1.0万', 'https://example.com/follower-outlier-repair'),
    (3, '2026-07-02T01:00:00.000Z', 249, 'available', '249', 'https://example.com/follower-outlier-repair'),
    (3, '2026-07-03T01:00:00.000Z', 251, 'available', '251', 'https://example.com/follower-outlier-repair'),
    (3, '2026-07-04T01:00:00.000Z', 5, 'available', '5', 'https://example.com/follower-outlier-repair'),
    (3, '2026-07-05T01:00:00.000Z', 10000, 'available', '1.0万', 'https://example.com/follower-outlier-repair');
  INSERT INTO videos (id, account_id, video_url, title, first_seen_at)
  VALUES
    (1, 1, 'https://example.com/shared-video', 'canonical', '2026-07-01 00:00:00'),
    (2, 2, 'https://example.com/shared-video', 'cross-account duplicate', '2026-07-02 00:00:00'),
    (3, 2, 'https://example.com/follower-only-known-video', 'known video', '2026-07-02 00:00:00');
  INSERT INTO video_snapshots (
    video_id, captured_at, like_count, comment_count, favorite_count,
    like_count_status, comment_count_status, favorite_count_status
  ) VALUES
    (1, '2026-07-01T01:00:00.000Z', 1000, 100, 50, 'available', 'available', 'available'),
    (1, '2026-07-02T01:00:00.000Z', 10, 1, 1, 'available', 'available', 'available'),
    (2, '2026-07-02T01:00:00.000Z', 1000, 100, 50, 'available', 'available', 'available'),
    (2, '2026-07-03T01:00:00.000Z', 1001, 101, 51, 'available', 'available', 'available'),
    (2, '2026-07-04T01:00:00.000Z', 1002, 102, 52, 'available', 'available', 'available'),
    (3, '2026-07-01T01:00:00.000Z', 100, 10, 5, 'available', 'available', 'available'),
    (3, '2026-07-02T01:00:00.000Z', 10000, 1000, 500, 'available', 'available', 'available'),
    (3, '2026-07-03T01:00:00.000Z', 101, 11, 6, 'available', 'available', 'available');
`);
legacy.close();

const { db, initDatabase } = await import("../src/backend/db/database.js");

test("database startup repairs cross-account duplicates and quarantines historical drops", () => {
  const repairs = initDatabase();
  const videos = db.prepare("SELECT id, account_id FROM videos ORDER BY id").all();
  const suspect = db.prepare(
    "SELECT like_count_status, comment_count_status, favorite_count_status FROM video_snapshots WHERE video_id = 1 ORDER BY captured_at DESC LIMIT 1"
  ).get();
  const indexes = db.prepare("PRAGMA index_list(videos)").all();
  const repairedJob = db.prepare("SELECT status, error_code FROM capture_jobs WHERE id = 1").get();
  const repairedAccount = db.prepare("SELECT latest_collect_status FROM accounts WHERE id = 2").get();
  const quarantinedAssociation = db.prepare(
    "SELECT video_id, account_id, video_url, snapshots_json FROM video_association_quarantine"
  ).get();
  const recoveredStatuses = db.prepare(
    `SELECT like_count_status, comment_count_status, favorite_count_status
     FROM video_snapshots WHERE video_id = 3 ORDER BY captured_at`
  ).all();
  const followerStatuses = db.prepare(
    "SELECT follower_count_status FROM account_snapshots WHERE account_id = 3 ORDER BY captured_at"
  ).all();

  assert.equal(repairs.duplicateVideosRemoved, 1);
  assert.equal(repairs.quarantinedMetrics, 11);
  assert.deepEqual(videos.map((row) => [row.id, row.account_id]), [[1, 1], [3, 2]]);
  assert.equal(suspect.like_count_status, "failed");
  assert.equal(suspect.comment_count_status, "failed");
  assert.equal(suspect.favorite_count_status, "failed");
  assert.equal(indexes.some((index) => index.name === "videos_video_url_unique" && index.unique === 1), true);
  assert.equal(quarantinedAssociation.video_id, 2);
  assert.equal(quarantinedAssociation.account_id, 2);
  assert.equal(JSON.parse(quarantinedAssociation.snapshots_json).length, 3);
  assert.deepEqual(recoveredStatuses.map((row) => ({ ...row })), [
    { like_count_status: "available", comment_count_status: "available", favorite_count_status: "available" },
    { like_count_status: "failed", comment_count_status: "failed", favorite_count_status: "failed" },
    { like_count_status: "available", comment_count_status: "available", favorite_count_status: "available" }
  ]);
  assert.deepEqual(followerStatuses.map((row) => row.follower_count_status), [
    "available", "failed", "failed", "failed", "available"
  ]);
  assert.equal(repairs.followerOnlyJobsReclassified, 1);
  assert.equal(repairedJob.status, "partial_success");
  assert.equal(repairedJob.error_code, "VIDEO_DATA_MISSING");
  assert.equal(repairedAccount.latest_collect_status, "partial_success");

  const secondRepairs = initDatabase();
  assert.deepEqual(secondRepairs, {
    duplicateVideosRemoved: 0,
    quarantinedMetrics: 0,
    followerOnlyJobsReclassified: 0
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 2);
});
