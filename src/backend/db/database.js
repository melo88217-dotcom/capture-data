import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { FOLLOWER_ONLY_CAPTURE_RESULT } from "../utils/captureStatus.js";
import { isImplausibleMetricChange, VIDEO_METRICS } from "../utils/dataQuality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "app.sqlite");
const DATA_INTEGRITY_MIGRATION = "2026-07-18-data-integrity-v2";
const FOLLOWER_OUTLIER_MIGRATION = "2026-07-29-follower-outlier-repair-v1";

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
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
      latest_total_like_count INTEGER,
      latest_collect_status TEXT DEFAULT 'unknown',
      last_captured_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(platform_id, profile_url)
    );

    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      captured_at TEXT NOT NULL,
      follower_count INTEGER,
      follower_count_status TEXT NOT NULL,
      raw_follower_text TEXT,
      total_like_count INTEGER,
      total_like_count_status TEXT NOT NULL DEFAULT 'unknown',
      raw_total_like_text TEXT,
      source_url TEXT,
      capture_job_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
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

    CREATE TABLE IF NOT EXISTS video_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES videos(id),
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

    CREATE TABLE IF NOT EXISTS capture_jobs (
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

    CREATE TABLE IF NOT EXISTS capture_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES capture_jobs(id),
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      follower_delta INTEGER,
      video_like_delta INTEGER,
      video_comment_delta INTEGER,
      video_favorite_delta INTEGER,
      data_status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, week_start, week_end)
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_association_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_id TEXT NOT NULL,
      video_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      video_url TEXT NOT NULL,
      video_json TEXT NOT NULL,
      snapshots_json TEXT NOT NULL,
      quarantined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const insertPlatform = db.prepare(`
    INSERT OR IGNORE INTO platforms (code, name)
    VALUES (?, ?)
  `);
  insertPlatform.run("douyin", "抖音");
  insertPlatform.run("shipinhao", "视频号");
  ensureColumn("accounts", "preferred_capture_time", "TEXT NOT NULL DEFAULT '09:00'");
  ensureColumn("accounts", "capture_video_limit", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn("accounts", "like_alert_threshold", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("accounts", "latest_total_like_count", "INTEGER");
  ensureColumn("account_snapshots", "total_like_count", "INTEGER");
  ensureColumn("account_snapshots", "total_like_count_status", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn("account_snapshots", "raw_total_like_text", "TEXT");
  const integrityRepairs = runDataIntegrityMigration();
  const followerOutliersQuarantined = runFollowerOutlierMigration();
  createLookupIndexes();
  return {
    ...integrityRepairs,
    quarantinedMetrics: integrityRepairs.quarantinedMetrics + followerOutliersQuarantined
  };
}

export function getDbPath() {
  return dbPath;
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function removeDuplicateVideoAssociations() {
  const rows = db
    .prepare(
      `
      SELECT v.id, v.video_url, v.first_seen_at, COUNT(vs.id) AS snapshot_count
      FROM videos v
      LEFT JOIN video_snapshots vs ON vs.video_id = v.id
      GROUP BY v.id
      ORDER BY v.video_url, datetime(v.first_seen_at) ASC, v.id ASC
    `
    )
    .all();
  const seenVideoUrls = new Set();
  const duplicateIds = [];
  for (const row of rows) {
    if (!seenVideoUrls.has(row.video_url)) {
      seenVideoUrls.add(row.video_url);
    } else {
      duplicateIds.push(row.id);
    }
  }
  if (!duplicateIds.length) return 0;

  const deleteSnapshots = db.prepare("DELETE FROM video_snapshots WHERE video_id = ?");
  const deleteVideo = db.prepare("DELETE FROM videos WHERE id = ?");
  const findVideo = db.prepare("SELECT * FROM videos WHERE id = ?");
  const findSnapshots = db.prepare("SELECT * FROM video_snapshots WHERE video_id = ? ORDER BY captured_at, id");
  const quarantineVideo = db.prepare(
    `INSERT INTO video_association_quarantine (
       migration_id, video_id, account_id, video_url, video_json, snapshots_json
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const videoId of duplicateIds) {
    const video = findVideo.get(videoId);
    quarantineVideo.run(
      DATA_INTEGRITY_MIGRATION,
      videoId,
      video.account_id,
      video.video_url,
      JSON.stringify(video),
      JSON.stringify(findSnapshots.all(videoId))
    );
    deleteSnapshots.run(videoId);
    deleteVideo.run(videoId);
  }
  return duplicateIds.length;
}

function quarantineHistoricalMetricDrops() {
  let quarantined = 0;
  const lastFollowerByAccount = new Map();
  const pendingFollowerByAccount = new Map();
  const accountRows = db
    .prepare(
      `SELECT id, account_id, follower_count, follower_count_status
       FROM account_snapshots
       WHERE follower_count_status IN ('available', 'failed') AND follower_count IS NOT NULL
       ORDER BY account_id, captured_at, id`
    )
    .all();
  const quarantineFollower = db.prepare(
    "UPDATE account_snapshots SET follower_count_status = 'failed' WHERE id = ?"
  );
  const restoreFollower = db.prepare(
    "UPDATE account_snapshots SET follower_count_status = 'available' WHERE id = ?"
  );
  for (const row of accountRows) {
    const stable = lastFollowerByAccount.get(row.account_id);
    const pending = pendingFollowerByAccount.get(row.account_id);
    if (shouldQuarantineHistoricalMetric(stable, pending, row.follower_count)) {
      if (row.follower_count_status !== "failed") {
        quarantineFollower.run(row.id);
        quarantined += 1;
      }
      pendingFollowerByAccount.set(row.account_id, row.follower_count);
    } else {
      if (row.follower_count_status !== "available") {
        restoreFollower.run(row.id);
        quarantined += 1;
      }
      lastFollowerByAccount.set(row.account_id, row.follower_count);
      pendingFollowerByAccount.delete(row.account_id);
    }
  }

  const videoRows = db
    .prepare(
      `SELECT id, video_id,
         like_count, like_count_status,
         comment_count, comment_count_status,
         favorite_count, favorite_count_status
       FROM video_snapshots
       ORDER BY video_id, captured_at, id`
    )
    .all();
  const previousByVideoMetric = new Map();
  const pendingByVideoMetric = new Map();
  const quarantineStatements = new Map(
    VIDEO_METRICS.map(({ statusColumn }) => [
      statusColumn,
      db.prepare(`UPDATE video_snapshots SET ${statusColumn} = 'failed' WHERE id = ?`)
    ])
  );
  const restoreStatements = new Map(
    VIDEO_METRICS.map(({ statusColumn }) => [
      statusColumn,
      db.prepare(`UPDATE video_snapshots SET ${statusColumn} = 'available' WHERE id = ?`)
    ])
  );
  for (const row of videoRows) {
    for (const { column, statusColumn } of VIDEO_METRICS) {
      if (!["available", "failed"].includes(row[statusColumn]) || row[column] == null) continue;
      const key = `${row.video_id}:${column}`;
      const stable = previousByVideoMetric.get(key);
      const pending = pendingByVideoMetric.get(key);
      if (shouldQuarantineHistoricalMetric(stable, pending, row[column])) {
        if (row[statusColumn] !== "failed") {
          quarantineStatements.get(statusColumn).run(row.id);
          quarantined += 1;
        }
        pendingByVideoMetric.set(key, row[column]);
      } else {
        if (row[statusColumn] !== "available") {
          restoreStatements.get(statusColumn).run(row.id);
          quarantined += 1;
        }
        previousByVideoMetric.set(key, row[column]);
        pendingByVideoMetric.delete(key);
      }
    }
  }
  return quarantined;
}

function shouldQuarantineHistoricalMetric(stable, pending, current) {
  if (!isImplausibleMetricChange(stable, current)) return false;
  return pending == null || isImplausibleMetricChange(pending, current);
}

function refreshLatestFollowerCounts() {
  db.exec(`
    UPDATE accounts
    SET latest_follower_count = (
      SELECT follower_count
      FROM account_snapshots
      WHERE account_id = accounts.id
        AND follower_count_status = 'available'
        AND follower_count IS NOT NULL
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1
      FROM account_snapshots
      WHERE account_id = accounts.id
        AND follower_count_status = 'available'
        AND follower_count IS NOT NULL
    );
  `);
}

function reclassifyFollowerOnlyCaptureJobs() {
  const result = db
    .prepare(
      `
      UPDATE capture_jobs AS job
      SET status = ?,
          error_code = COALESCE(error_code, ?),
          error_message = COALESCE(NULLIF(error_message, ''), ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE job.status = 'success'
        AND EXISTS (
          SELECT 1 FROM account_snapshots snapshot
          WHERE snapshot.capture_job_id = job.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM video_snapshots snapshot
          WHERE snapshot.capture_job_id = job.id
        )
        AND EXISTS (
          SELECT 1 FROM videos video
          WHERE video.account_id = job.account_id
        )
    `
    )
    .run(
      FOLLOWER_ONLY_CAPTURE_RESULT.status,
      FOLLOWER_ONLY_CAPTURE_RESULT.error_code,
      FOLLOWER_ONLY_CAPTURE_RESULT.error_message
    );
  return result.changes;
}

function runDataIntegrityMigration() {
  const emptyResult = {
    duplicateVideosRemoved: 0,
    quarantinedMetrics: 0,
    followerOnlyJobsReclassified: 0
  };
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(DATA_INTEGRITY_MIGRATION);
  if (applied) return emptyResult;

  db.exec("BEGIN IMMEDIATE");
  try {
    const repairs = {
      duplicateVideosRemoved: removeDuplicateVideoAssociations(),
      quarantinedMetrics: quarantineHistoricalMetricDrops(),
      followerOnlyJobsReclassified: reclassifyFollowerOnlyCaptureJobs()
    };
    refreshLatestFollowerCounts();
    refreshLatestCollectionStatuses();
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS videos_video_url_unique ON videos(video_url);");
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(DATA_INTEGRITY_MIGRATION);
    db.exec("COMMIT");
    return repairs;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function runFollowerOutlierMigration() {
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(FOLLOWER_OUTLIER_MIGRATION);
  if (applied) return 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = reconcileBoundedFollowerOutliers();
    refreshLatestFollowerCounts();
    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(FOLLOWER_OUTLIER_MIGRATION);
    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function reconcileBoundedFollowerOutliers() {
  const rows = db
    .prepare(
      `SELECT id, account_id, follower_count, follower_count_status
       FROM account_snapshots
       WHERE follower_count_status IN ('available', 'failed') AND follower_count IS NOT NULL
       ORDER BY account_id, captured_at, id`
    )
    .all();
  const markFailed = db.prepare("UPDATE account_snapshots SET follower_count_status = 'failed' WHERE id = ?");
  const restoreAvailable = db.prepare("UPDATE account_snapshots SET follower_count_status = 'available' WHERE id = ?");
  let changed = 0;
  let start = 0;

  while (start < rows.length) {
    let end = start + 1;
    while (end < rows.length && rows[end].account_id === rows[start].account_id) end += 1;
    const accountRows = rows.slice(start, end);

    for (let index = 0; index < accountRows.length; index += 1) {
      const row = accountRows[index];
      if (row.follower_count_status === "available" && isBoundedFollowerOutlier(accountRows, index)) {
        markFailed.run(row.id);
        row.follower_count_status = "failed";
        changed += 1;
      }
    }

    for (let index = 0; index < accountRows.length; index += 1) {
      const row = accountRows[index];
      if (
        row.follower_count_status === "failed" &&
        !isBoundedFollowerOutlier(accountRows, index) &&
        hasPriorAvailableComparableFollower(accountRows, index)
      ) {
        restoreAvailable.run(row.id);
        row.follower_count_status = "available";
        changed += 1;
      }
    }

    start = end;
  }

  return changed;
}

function isBoundedFollowerOutlier(rows, index) {
  const current = rows[index].follower_count;
  for (let beforeIndex = index - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const before = rows[beforeIndex].follower_count;
    if (!isImplausibleMetricChange(before, current)) continue;
    for (let afterIndex = index + 1; afterIndex < rows.length; afterIndex += 1) {
      const after = rows[afterIndex].follower_count;
      if (
        isImplausibleMetricChange(after, current) &&
        !isImplausibleMetricChange(before, after)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasPriorAvailableComparableFollower(rows, index) {
  const current = rows[index].follower_count;
  for (let priorIndex = index - 1; priorIndex >= 0; priorIndex -= 1) {
    const prior = rows[priorIndex];
    if (prior.follower_count_status === "available" && !isImplausibleMetricChange(prior.follower_count, current)) {
      return true;
    }
  }
  return false;
}

function createLookupIndexes() {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS videos_video_url_unique ON videos(video_url);
    CREATE INDEX IF NOT EXISTS videos_account_id_index ON videos(account_id);
    CREATE INDEX IF NOT EXISTS account_snapshots_account_time_index
      ON account_snapshots(account_id, captured_at, id);
    CREATE INDEX IF NOT EXISTS account_snapshots_job_index ON account_snapshots(capture_job_id);
    CREATE INDEX IF NOT EXISTS video_snapshots_video_time_index
      ON video_snapshots(video_id, captured_at, id);
    CREATE INDEX IF NOT EXISTS video_snapshots_job_index ON video_snapshots(capture_job_id);
    CREATE INDEX IF NOT EXISTS capture_jobs_account_finished_index
      ON capture_jobs(account_id, finished_at, id);
  `);
}

function refreshLatestCollectionStatuses() {
  db.exec(`
    UPDATE accounts
    SET latest_collect_status = (
      SELECT status
      FROM capture_jobs
      WHERE account_id = accounts.id AND finished_at IS NOT NULL
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1
      FROM capture_jobs
      WHERE account_id = accounts.id AND finished_at IS NOT NULL
    );
  `);
}
