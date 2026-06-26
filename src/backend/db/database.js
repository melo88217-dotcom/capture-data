import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "app.sqlite");

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
