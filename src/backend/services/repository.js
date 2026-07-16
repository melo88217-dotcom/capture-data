import { db } from "../db/database.js";
import { endOfWeek, nowIso, startOfWeek } from "../utils/time.js";

const accountSelect = `
  SELECT
    a.*,
    p.code AS platform_code,
    p.name AS platform_name
  FROM accounts a
  JOIN platforms p ON p.id = a.platform_id
`;

function sqlValue(value) {
  return value === undefined ? null : value;
}

function normalizeCaptureVideoLimit(value, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

export function listPlatforms() {
  return db.prepare("SELECT * FROM platforms WHERE enabled = 1 ORDER BY id").all();
}

export function listAccounts(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.platform) {
    clauses.push("p.code = ?");
    params.push(filters.platform);
  }
  if (!filters.status || filters.status === "active") clauses.push("a.is_active = 1");
  if (filters.status === "inactive") clauses.push("a.is_active = 0");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`${accountSelect} ${where} ORDER BY a.updated_at DESC`).all(...params);
}

export function getAccount(id) {
  return db.prepare(`${accountSelect} WHERE a.id = ?`).get(id);
}

export function createAccount(payload) {
  const platform = db.prepare("SELECT id FROM platforms WHERE code = ?").get(payload.platform);
  if (!platform) throw new Error("平台不存在");

  const existing = db
    .prepare("SELECT id, is_active FROM accounts WHERE platform_id = ? AND profile_url = ?")
    .get(platform.id, payload.profile_url);

  if (existing?.is_active) throw new Error("账号已存在");

  if (existing) {
    db.prepare(
      `
      UPDATE accounts
      SET display_name = ?,
          category = ?,
          tags = ?,
          notes = ?,
          capture_frequency = ?,
          preferred_capture_time = ?,
          capture_video_limit = ?,
          like_alert_threshold = ?,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      payload.display_name,
      payload.category || "",
      payload.tags || "",
      payload.notes || "",
      payload.capture_frequency || "daily",
      payload.preferred_capture_time || "09:00",
      normalizeCaptureVideoLimit(payload.capture_video_limit),
      Number(payload.like_alert_threshold || 0),
      existing.id
    );
    return getAccount(existing.id);
  }

  const info = db
    .prepare(
      `
      INSERT INTO accounts (
        platform_id, display_name, profile_url, category, tags, notes, capture_frequency, preferred_capture_time, capture_video_limit, like_alert_threshold, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      platform.id,
      payload.display_name,
      payload.profile_url,
      payload.category || "",
      payload.tags || "",
      payload.notes || "",
      payload.capture_frequency || "daily",
      payload.preferred_capture_time || "09:00",
      normalizeCaptureVideoLimit(payload.capture_video_limit),
      Number(payload.like_alert_threshold || 0),
      payload.is_active === false ? 0 : 1
    );

  return getAccount(info.lastInsertRowid);
}

export function updateAccount(id, payload) {
  const current = getAccount(id);
  if (!current) throw new Error("账号不存在");

  const platform = payload.platform
    ? db.prepare("SELECT id FROM platforms WHERE code = ?").get(payload.platform)
    : { id: current.platform_id };

  db.prepare(
    `
      UPDATE accounts
      SET platform_id = ?,
          display_name = ?,
          profile_url = ?,
          category = ?,
          tags = ?,
          notes = ?,
          capture_frequency = ?,
          preferred_capture_time = ?,
          capture_video_limit = ?,
          like_alert_threshold = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(
    platform.id,
    payload.display_name ?? current.display_name,
    payload.profile_url ?? current.profile_url,
    payload.category ?? current.category,
    payload.tags ?? current.tags,
    payload.notes ?? current.notes,
    payload.capture_frequency ?? current.capture_frequency,
    payload.preferred_capture_time ?? current.preferred_capture_time ?? "09:00",
    normalizeCaptureVideoLimit(payload.capture_video_limit, current.capture_video_limit ?? 10),
    Number(payload.like_alert_threshold ?? current.like_alert_threshold ?? 0),
    payload.is_active == null ? current.is_active : payload.is_active ? 1 : 0,
    id
  );

  return getAccount(id);
}

export function deleteAccount(id) {
  const current = getAccount(id);
  if (!current) throw new Error("账号不存在");

  db.prepare(
    `
      UPDATE accounts
      SET is_active = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(id);

  db.prepare(
    `
      UPDATE capture_jobs
      SET status = 'skipped',
          finished_at = ?,
          error_code = 'ACCOUNT_INACTIVE',
          error_message = '账号已删除，跳过未执行采集',
          updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ?
        AND status IN ('pending', 'running')
    `
  ).run(nowIso(), id);

  return getAccount(id);
}

export function clearAccountCaptureData(id) {
  const current = getAccount(id);
  if (!current) throw new Error("账号不存在");
  if (!current.is_active) throw new Error("账号已删除");

  db.exec("BEGIN");
  try {
    db.prepare(
      `
      DELETE FROM capture_logs
      WHERE job_id IN (
        SELECT id FROM capture_jobs WHERE account_id = ?
      )
    `
    ).run(id);
    const deletedVideoSnapshots = db.prepare(
      `
      DELETE FROM video_snapshots
      WHERE video_id IN (
        SELECT id FROM videos WHERE account_id = ?
      )
    `
    ).run(id).changes;
    const deletedVideos = db.prepare("DELETE FROM videos WHERE account_id = ?").run(id).changes;
    const deletedAccountSnapshots = db
      .prepare("DELETE FROM account_snapshots WHERE account_id = ?")
      .run(id).changes;
    const deletedWeeklySummaries = db
      .prepare("DELETE FROM weekly_summaries WHERE account_id = ?")
      .run(id).changes;
    const deletedJobs = db.prepare("DELETE FROM capture_jobs WHERE account_id = ?").run(id).changes;

    db.prepare(
      `
      UPDATE accounts
      SET latest_follower_count = NULL,
          latest_collect_status = 'unknown',
          last_captured_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(id);
    db.exec("COMMIT");

    return {
      account: getAccount(id),
      deleted: {
        videos: deletedVideos,
        video_snapshots: deletedVideoSnapshots,
        account_snapshots: deletedAccountSnapshots,
        weekly_summaries: deletedWeeklySummaries,
        capture_jobs: deletedJobs
      }
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createCaptureJob(accountId, triggerType = "manual_now", scheduledAt = nowIso()) {
  const account = getAccount(accountId);
  if (!account) throw new Error("账号不存在");
  if (!account.is_active) throw new Error("账号已删除，不再采集");

  expireStaleCaptureJobs({ accountId });

  const running = db
    .prepare(
      "SELECT id FROM capture_jobs WHERE account_id = ? AND status IN ('pending', 'running') LIMIT 1"
    )
    .get(accountId);
  if (running) return getCaptureJob(running.id);

  const info = db
    .prepare(
      `
      INSERT INTO capture_jobs (account_id, platform_id, job_type, trigger_type, scheduled_at)
      VALUES (?, ?, ?, ?, ?)
    `
    )
    .run(accountId, account.platform_id, triggerType === "manual_now" ? "manual" : "scheduled", triggerType, scheduledAt);

  return getCaptureJob(info.lastInsertRowid);
}

export function expireStaleCaptureJobs({ accountId = null, maxAgeMs = getStaleJobMs(), now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
  const params = [now.toISOString(), cutoff];
  const accountClause = accountId ? " AND account_id = ?" : "";
  if (accountId) params.push(accountId);

  return db
    .prepare(
      `
      UPDATE capture_jobs
      SET status = 'failed',
          finished_at = ?,
          error_code = 'CAPTURE_TIMEOUT',
          error_message = '采集任务超过最长运行时间，系统已自动结束，可重新采集。',
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'
        AND datetime(COALESCE(started_at, updated_at, created_at)) <= datetime(?)
        ${accountClause}
    `
    )
    .run(...params).changes;
}

export function failInterruptedCaptureJobs(now = new Date()) {
  return db
    .prepare(
      `
      UPDATE capture_jobs
      SET status = 'failed',
          finished_at = ?,
          error_code = 'CAPTURE_INTERRUPTED',
          error_message = '服务重启或采集进程中断，系统已自动结束该任务，可重新采集。',
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running'
    `
    )
    .run(now.toISOString()).changes;
}

function getStaleJobMs() {
  const configured = Number(process.env.CAPTURE_JOB_STALE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 2 * 60 * 60 * 1000;
}

export function getCaptureJob(id) {
  return db
    .prepare(
      `
      SELECT
        j.*,
        a.display_name,
        a.profile_url,
        a.platform_account_id,
        a.avatar_url,
        a.bio,
        a.category,
        a.tags,
        a.notes,
        a.capture_frequency,
        a.is_active,
        p.code AS platform_code,
        p.name AS platform_name
      FROM capture_jobs j
      JOIN accounts a ON a.id = j.account_id
      JOIN platforms p ON p.id = j.platform_id
      WHERE j.id = ?
    `
    )
    .get(id);
}

export function listCaptureJobs(limit = 80) {
  return db
    .prepare(
      `
      SELECT j.*, a.display_name, p.name AS platform_name, p.code AS platform_code
      FROM capture_jobs j
      JOIN accounts a ON a.id = j.account_id
      JOIN platforms p ON p.id = j.platform_id
      WHERE a.is_active = 1
      ORDER BY j.created_at DESC
      LIMIT ?
    `
    )
    .all(limit);
}

function buildVideoFilters(filters = {}) {
  const clauses = ["a.is_active = 1"];
  const params = [];

  if (filters.account_id) {
    clauses.push("v.account_id = ?");
    params.push(Number(filters.account_id));
  }
  if (filters.platform) {
    clauses.push("p.code = ?");
    params.push(filters.platform);
  }
  if (filters.from) {
    clauses.push("datetime(v.published_at) >= datetime(?)");
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push("datetime(v.published_at) <= datetime(?)");
    params.push(filters.to);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function parseLimit(value, fallback = 120) {
  if (value === "all") return 10000;
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10000) : fallback;
}

export function listDueAccounts() {
  const latestScheduledAttempt = db.prepare(`
    SELECT MAX(scheduled_at) AS scheduled_at
    FROM capture_jobs
    WHERE account_id = ? AND job_type = 'scheduled'
  `);

  return listAccounts({ status: "active" })
    .filter((account) => account.capture_frequency !== "manual")
    .map((account) => ({
      ...account,
      last_scheduled_at: latestScheduledAttempt.get(account.id)?.scheduled_at || null
    }));
}

export function markJobRunning(jobId) {
  const result = db.prepare(
    `
      UPDATE capture_jobs
      SET status = 'running', started_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `
  ).run(nowIso(), jobId);
  return result.changes > 0;
}

export function markJobFinished(jobId, result) {
  db.prepare(
    `
    UPDATE capture_jobs
    SET status = ?,
        finished_at = ?,
        error_code = ?,
        error_message = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(result.status, nowIso(), result.error_code || null, result.error_message || null, jobId);
}

export function addCaptureLog(jobId, level, message, context = {}) {
  db.prepare(
    `
    INSERT INTO capture_logs (job_id, level, message, context_json)
    VALUES (?, ?, ?, ?)
  `
  ).run(jobId, level, message, JSON.stringify(context));
}

export function saveCaptureResult(job, result) {
  const insertSnapshot = db.prepare(
    `
    INSERT INTO account_snapshots (
      account_id, captured_at, follower_count, follower_count_status, raw_follower_text, source_url, capture_job_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );

  insertSnapshot.run(
    job.account_id,
    sqlValue(result.captured_at),
    sqlValue(result.account.follower_count),
    sqlValue(result.account.follower_count_status),
    sqlValue(result.account.raw_follower_text),
    sqlValue(result.account.profile_url),
    job.id
  );

  if (result.account.follower_count_status === "available") {
    db.prepare(
      `
      UPDATE accounts
      SET latest_follower_count = ?,
          latest_collect_status = ?,
          last_captured_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(result.account.follower_count, result.status, result.captured_at, job.account_id);
  } else {
    db.prepare(
      `
      UPDATE accounts
      SET latest_collect_status = ?,
          last_captured_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(result.status, result.captured_at, job.account_id);
  }

  for (const video of result.videos || []) {
    const existing = db
      .prepare("SELECT id FROM videos WHERE account_id = ? AND video_url = ?")
      .get(job.account_id, video.video_url);

    let videoId = existing?.id;
    if (videoId) {
      db.prepare(
        `
        UPDATE videos
        SET platform_video_id = COALESCE(?, platform_video_id),
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            cover_url = COALESCE(?, cover_url),
            published_at = COALESCE(?, published_at),
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(
        sqlValue(video.platform_video_id),
        sqlValue(video.title),
        sqlValue(video.description || ""),
        sqlValue(video.cover_url || ""),
        sqlValue(video.published_at),
        videoId
      );
    } else {
      videoId = db
        .prepare(
          `
          INSERT INTO videos (
            account_id, platform_video_id, video_url, title, description, cover_url, published_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          job.account_id,
          sqlValue(video.platform_video_id),
          sqlValue(video.video_url),
          sqlValue(video.title),
          sqlValue(video.description || ""),
          sqlValue(video.cover_url || ""),
          sqlValue(video.published_at)
        ).lastInsertRowid;
    }

    db.prepare(
      `
      INSERT INTO video_snapshots (
        video_id, captured_at, like_count, comment_count, favorite_count,
        like_count_status, comment_count_status, favorite_count_status, raw_metric_text, capture_job_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      videoId,
      sqlValue(result.captured_at),
      sqlValue(video.like_count),
      sqlValue(video.comment_count),
      sqlValue(video.favorite_count),
      sqlValue(video.like_count_status),
      sqlValue(video.comment_count_status),
      sqlValue(video.favorite_count_status),
      sqlValue(video.raw_metric_text || ""),
      job.id
    );
  }
}

export function listVideos(filters = {}) {
  const { where, params } = buildVideoFilters(filters);
  const limit = parseLimit(filters.limit);
  return db
    .prepare(
      `
      SELECT
        v.*,
        a.display_name AS account_name,
        p.name AS platform_name,
        p.code AS platform_code,
        vs.like_count,
        vs.comment_count,
        vs.favorite_count,
        vs.like_count_status,
        vs.comment_count_status,
        vs.favorite_count_status,
        vs.captured_at
      FROM videos v
      JOIN accounts a ON a.id = v.account_id
      JOIN platforms p ON p.id = a.platform_id
      LEFT JOIN video_snapshots vs ON vs.id = (
        SELECT id FROM video_snapshots
        WHERE video_id = v.id
        ORDER BY captured_at DESC
        LIMIT 1
      )
      ${where}
      ORDER BY datetime(v.published_at) DESC, v.last_seen_at DESC
      LIMIT ?
    `
    )
    .all(...params, limit);
}

export function listHotVideos(filters = {}) {
  const normalizedFilters =
    typeof filters === "object" && filters !== null ? filters : { limit: filters };
  const months = parseHotVideoMonths(normalizedFilters.months);
  const publishedAtClause = months == null
    ? ""
    : "AND datetime(v.published_at) >= datetime('now', ?)";
  const params = months == null ? [] : [`-${months} months`];

  return db
    .prepare(
      `
      SELECT
        v.*,
        a.display_name AS account_name,
        a.like_alert_threshold,
        p.name AS platform_name,
        p.code AS platform_code,
        vs.like_count,
        vs.comment_count,
        vs.favorite_count,
        vs.like_count_status,
        vs.comment_count_status,
        vs.favorite_count_status,
        vs.captured_at
      FROM videos v
      JOIN accounts a ON a.id = v.account_id
      JOIN platforms p ON p.id = a.platform_id
      JOIN video_snapshots vs ON vs.id = (
        SELECT id FROM video_snapshots
        WHERE video_id = v.id
        ORDER BY captured_at DESC
        LIMIT 1
      )
      WHERE a.like_alert_threshold > 0
        AND a.is_active = 1
        AND vs.like_count IS NOT NULL
        AND vs.like_count >= a.like_alert_threshold
        ${publishedAtClause}
      ORDER BY vs.like_count DESC, datetime(v.published_at) DESC
      LIMIT ?
    `
    )
    .all(...params, parseLimit(normalizedFilters.limit, 120));
}

function parseHotVideoMonths(value) {
  if (value === "all") return null;
  const parsed = Number(value ?? 3);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return Math.min(Math.floor(parsed), 120);
}

export function listAccountDashboardRows() {
  return db
    .prepare(
      `
      SELECT
        a.*,
        p.code AS platform_code,
        p.name AS platform_name,
        COUNT(DISTINCT v.id) AS video_count,
        COUNT(DISTINCT CASE
          WHEN v.published_at IS NOT NULL
            AND date(v.published_at, 'localtime') >= date('now', 'localtime', '-6 days')
          THEN v.id
        END) AS recent_video_count
      FROM accounts a
      JOIN platforms p ON p.id = a.platform_id
      LEFT JOIN videos v ON v.account_id = a.id
      WHERE a.is_active = 1
      GROUP BY a.id
      ORDER BY a.updated_at DESC
    `
    )
    .all();
}

export function listTopLikedVideos(limit = 5) {
  return db
    .prepare(
      `
      SELECT
        v.*,
        a.display_name AS account_name,
        p.name AS platform_name,
        p.code AS platform_code,
        vs.like_count,
        vs.comment_count,
        vs.favorite_count,
        vs.like_count_status,
        vs.comment_count_status,
        vs.favorite_count_status,
        vs.captured_at
      FROM videos v
      JOIN accounts a ON a.id = v.account_id
      JOIN platforms p ON p.id = a.platform_id
      JOIN video_snapshots vs ON vs.id = (
        SELECT id FROM video_snapshots
        WHERE video_id = v.id
        ORDER BY captured_at DESC
        LIMIT 1
      )
      WHERE a.is_active = 1
        AND vs.like_count IS NOT NULL
      ORDER BY vs.like_count DESC, datetime(v.published_at) DESC, datetime(v.updated_at) DESC
      LIMIT ?
    `
    )
    .all(parseLimit(limit, 5));
}

export function exportVideosCsv(filters = {}) {
  const rows = listVideos(filters);
  const headers = [
    "账号",
    "平台",
    "发布时间",
    "视频标题",
    "点赞",
    "评论",
    "收藏",
    "采集时间",
    "视频链接"
  ];
  const lines = [headers.map(csvCell).join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.account_name,
        row.platform_name,
        row.published_at,
        row.title,
        row.like_count,
        row.comment_count,
        row.favorite_count,
        row.captured_at,
        row.video_url
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

export function exportVideosExcel(filters = {}) {
  const rows = listVideos(filters);
  const headers = ["账号", "平台", "发布时间", "视频标题", "点赞", "评论", "收藏", "采集时间", "视频链接"];
  const tableRows = [
    `<tr>${headers.map((header) => `<th>${htmlCell(header)}</th>`).join("")}</tr>`,
    ...rows.map((row) =>
      `<tr>${[
        row.account_name,
        row.platform_name,
        row.published_at,
        row.title,
        row.like_count,
        row.comment_count,
        row.favorite_count,
        row.captured_at,
        row.video_url
      ]
        .map((value) => `<td>${htmlCell(value)}</td>`)
        .join("")}</tr>`
    )
  ];

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: "Microsoft YaHei", Arial, sans-serif; }
    th, td { border: 1px solid #d9d9d9; padding: 6px 8px; mso-number-format:"\\@"; }
    th { background: #eef5f2; font-weight: 700; }
  </style>
</head>
<body>
  <table>${tableRows.join("")}</table>
</body>
</html>`;
}

export function listDailyChanges(filters = {}) {
  const accounts = filters.account_id
    ? [getAccount(Number(filters.account_id))].filter((account) => account?.is_active)
    : listAccounts();
  const rows = [];

  for (const account of accounts) {
    const dates = db
      .prepare(
        `
        SELECT DISTINCT date(captured_at, 'localtime') AS day
        FROM account_snapshots
        WHERE account_id = ?
        UNION
        SELECT DISTINCT date(vs.captured_at, 'localtime') AS day
        FROM video_snapshots vs
        JOIN videos v ON v.id = vs.video_id
        WHERE v.account_id = ?
        ORDER BY day DESC
        LIMIT ?
      `
      )
      .all(account.id, account.id, parseLimit(filters.limit, 120));

    const ordered = dates.map((item) => buildDailyRow(account, item.day)).reverse();
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const previous = ordered[index - 1];
      rows.push({
        ...current,
        follower_delta: diff(current.follower_count, previous?.follower_count),
        like_delta: diff(current.like_total, previous?.like_total),
        comment_delta: diff(current.comment_total, previous?.comment_total),
        favorite_delta: diff(current.favorite_total, previous?.favorite_total)
      });
    }
  }

  return rows.sort((a, b) => b.day.localeCompare(a.day) || a.account_name.localeCompare(b.account_name));
}

function buildDailyRow(account, day) {
  const latestSnapshot = db
    .prepare(
      `
      SELECT *
      FROM account_snapshots
      WHERE account_id = ? AND date(captured_at, 'localtime') = ?
      ORDER BY captured_at DESC
      LIMIT 1
    `
    )
    .get(account.id, day);
  const followerSnapshot = db
    .prepare(
      `
      SELECT *
      FROM account_snapshots
      WHERE account_id = ?
        AND date(captured_at, 'localtime') = ?
        AND follower_count IS NOT NULL
        AND follower_count_status = 'available'
      ORDER BY captured_at DESC
      LIMIT 1
    `
    )
    .get(account.id, day);

  const totals = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT v.id) AS video_count,
        CASE
          WHEN SUM(CASE WHEN latest.like_count_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE SUM(CASE WHEN latest.like_count IS NOT NULL THEN latest.like_count ELSE 0 END)
        END AS like_total,
        CASE
          WHEN SUM(CASE WHEN latest.comment_count_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE SUM(CASE WHEN latest.comment_count IS NOT NULL THEN latest.comment_count ELSE 0 END)
        END AS comment_total,
        CASE
          WHEN SUM(CASE WHEN latest.favorite_count_status = 'failed' THEN 1 ELSE 0 END) > 0 THEN NULL
          ELSE SUM(CASE WHEN latest.favorite_count IS NOT NULL THEN latest.favorite_count ELSE 0 END)
        END AS favorite_total
      FROM videos v
      LEFT JOIN video_snapshots latest ON latest.id = (
        SELECT id
        FROM video_snapshots
        WHERE video_id = v.id AND date(captured_at, 'localtime') = ?
        ORDER BY captured_at DESC
        LIMIT 1
      )
      WHERE v.account_id = ?
        AND EXISTS (
          SELECT 1 FROM video_snapshots vs
          WHERE vs.video_id = v.id AND date(vs.captured_at, 'localtime') = ?
        )
    `
    )
    .get(day, account.id, day);

  const videoCount = totals.video_count || 0;

  return {
    day,
    captured_at: latestSnapshot?.captured_at || getDailyVideoCapturedAt(account.id, day),
    account_id: account.id,
    account_name: account.display_name,
    platform_name: account.platform_name,
    follower_count: followerSnapshot?.follower_count ?? null,
    follower_count_status: followerSnapshot?.follower_count_status || latestSnapshot?.follower_count_status || "not_public",
    video_count: videoCount,
    like_total: videoCount === 0 ? 0 : totals.like_total,
    comment_total: videoCount === 0 ? 0 : totals.comment_total,
    favorite_total: videoCount === 0 ? 0 : totals.favorite_total
  };
}

function getDailyVideoCapturedAt(accountId, day) {
  const row = db
    .prepare(
      `
      SELECT MAX(vs.captured_at) AS captured_at
      FROM video_snapshots vs
      JOIN videos v ON v.id = vs.video_id
      WHERE v.account_id = ? AND date(vs.captured_at, 'localtime') = ?
    `
    )
    .get(accountId, day);
  return row?.captured_at || null;
}

export function exportDailyChangesCsv(filters = {}) {
  const rows = listDailyChanges(filters);
  const headers = ["日期", "数据时间", "账号", "平台", "粉丝", "粉丝变化", "视频数", "点赞合计", "点赞变化", "评论合计", "评论变化", "收藏合计", "收藏变化"];
  return `\uFEFF${[
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.day,
        row.captured_at,
        row.account_name,
        row.platform_name,
        row.follower_count,
        row.follower_delta,
        row.video_count,
        row.like_total,
        row.like_delta,
        row.comment_total,
        row.comment_delta,
        row.favorite_total,
        row.favorite_delta
      ]
        .map(csvCell)
        .join(",")
    )
  ].join("\r\n")}`;
}

export function exportDailyChangesExcel(filters = {}) {
  const rows = listDailyChanges(filters);
  const headers = ["日期", "数据时间", "账号", "平台", "粉丝", "粉丝变化", "视频数", "点赞合计", "点赞变化", "评论合计", "评论变化", "收藏合计", "收藏变化"];
  const tableRows = [
    `<tr>${headers.map((header) => `<th>${htmlCell(header)}</th>`).join("")}</tr>`,
    ...rows.map((row) =>
      `<tr>${[
        row.day,
        row.captured_at,
        row.account_name,
        row.platform_name,
        row.follower_count,
        row.follower_delta,
        row.video_count,
        row.like_total,
        row.like_delta,
        row.comment_total,
        row.comment_delta,
        row.favorite_total,
        row.favorite_delta
      ]
        .map((value) => `<td>${htmlCell(value)}</td>`)
        .join("")}</tr>`
    )
  ];

  return `<!doctype html><html><head><meta charset="utf-8" /><style>table{border-collapse:collapse;font-family:"Microsoft YaHei",Arial,sans-serif}th,td{border:1px solid #d9d9d9;padding:6px 8px;mso-number-format:"\\@"}th{background:#eef5f2;font-weight:700}</style></head><body><table>${tableRows.join("")}</table></body></html>`;
}

function diff(current, previous) {
  if (current == null || previous == null) return null;
  return current - previous;
}

function csvCell(value) {
  if (value == null) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

function htmlCell(value) {
  if (value == null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function computeWeeklySummaries(date = new Date()) {
  const weekStart = startOfWeek(date).toISOString();
  const weekEnd = endOfWeek(date).toISOString();
  const accounts = listAccounts({ status: "active" });

  for (const account of accounts) {
    const snapshots = db
      .prepare(
        `
        SELECT * FROM account_snapshots
        WHERE account_id = ?
          AND captured_at >= ?
          AND captured_at <= ?
          AND follower_count_status = 'available'
        ORDER BY captured_at ASC
      `
      )
      .all(account.id, weekStart, weekEnd);

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const followerDelta = first && last && snapshots.length > 1 ? last.follower_count - first.follower_count : null;
    const dataStatus = snapshots.length > 1 ? "complete" : snapshots.length === 1 ? "partial" : "insufficient";

    const videoDelta = db
      .prepare(
        `
        SELECT
          COUNT(newest.id) AS video_snapshot_count,
          SUM(CASE WHEN newest.like_count IS NOT NULL AND oldest.like_count IS NOT NULL THEN newest.like_count - oldest.like_count ELSE 0 END) AS like_delta,
          SUM(CASE WHEN newest.comment_count IS NOT NULL AND oldest.comment_count IS NOT NULL THEN newest.comment_count - oldest.comment_count ELSE 0 END) AS comment_delta,
          SUM(CASE WHEN newest.favorite_count IS NOT NULL AND oldest.favorite_count IS NOT NULL THEN newest.favorite_count - oldest.favorite_count ELSE 0 END) AS favorite_delta
        FROM videos v
        LEFT JOIN video_snapshots oldest ON oldest.id = (
          SELECT id FROM video_snapshots
          WHERE video_id = v.id AND captured_at >= ? AND captured_at <= ?
          ORDER BY captured_at ASC
          LIMIT 1
        )
        LEFT JOIN video_snapshots newest ON newest.id = (
          SELECT id FROM video_snapshots
          WHERE video_id = v.id AND captured_at >= ? AND captured_at <= ?
          ORDER BY captured_at DESC
          LIMIT 1
        )
        WHERE v.account_id = ?
      `
    )
      .get(weekStart, weekEnd, weekStart, weekEnd, account.id);

    if (snapshots.length === 0 && !videoDelta.video_snapshot_count) {
      db.prepare("DELETE FROM weekly_summaries WHERE account_id = ? AND week_start = ? AND week_end = ?").run(
        account.id,
        weekStart,
        weekEnd
      );
      continue;
    }

    db.prepare(
      `
      INSERT INTO weekly_summaries (
        account_id, week_start, week_end, follower_delta, video_like_delta,
        video_comment_delta, video_favorite_delta, data_status, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, week_start, week_end)
      DO UPDATE SET
        follower_delta = excluded.follower_delta,
        video_like_delta = excluded.video_like_delta,
        video_comment_delta = excluded.video_comment_delta,
        video_favorite_delta = excluded.video_favorite_delta,
        data_status = excluded.data_status,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `
    ).run(
      account.id,
      weekStart,
      weekEnd,
      followerDelta,
      videoDelta.like_delta ?? null,
      videoDelta.comment_delta ?? null,
      videoDelta.favorite_delta ?? null,
      dataStatus,
      dataStatus === "insufficient" ? "数据不足" : ""
    );
  }
}

export function listWeeklySummaries(limit = 80) {
  computeWeeklySummaries();
  return db
    .prepare(
      `
      SELECT
        ws.*,
        a.display_name,
        p.name AS platform_name,
        p.code AS platform_code,
        prev.follower_delta AS previous_follower_delta,
        prev.video_like_delta AS previous_video_like_delta,
        prev.video_comment_delta AS previous_video_comment_delta,
        prev.video_favorite_delta AS previous_video_favorite_delta,
        CASE
          WHEN ws.follower_delta IS NOT NULL AND prev.follower_delta IS NOT NULL
          THEN ws.follower_delta - prev.follower_delta
        END AS follower_delta_change,
        CASE
          WHEN ws.video_like_delta IS NOT NULL AND prev.video_like_delta IS NOT NULL
          THEN ws.video_like_delta - prev.video_like_delta
        END AS video_like_delta_change,
        CASE
          WHEN ws.video_comment_delta IS NOT NULL AND prev.video_comment_delta IS NOT NULL
          THEN ws.video_comment_delta - prev.video_comment_delta
        END AS video_comment_delta_change,
        CASE
          WHEN ws.video_favorite_delta IS NOT NULL AND prev.video_favorite_delta IS NOT NULL
          THEN ws.video_favorite_delta - prev.video_favorite_delta
        END AS video_favorite_delta_change,
        (
          SELECT COUNT(*)
          FROM videos v
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_video_count,
        (
          SELECT COUNT(*)
          FROM videos v
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_video_count,
        (
          SELECT COALESCE(SUM(vs.like_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_like_total,
        (
          SELECT COALESCE(SUM(vs.like_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_like_total,
        (
          SELECT COALESCE(SUM(vs.comment_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_comment_total,
        (
          SELECT COALESCE(SUM(vs.comment_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_comment_total,
        (
          SELECT COALESCE(SUM(vs.favorite_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_favorite_total,
        (
          SELECT COALESCE(SUM(vs.favorite_count), 0)
          FROM videos v
          LEFT JOIN video_snapshots vs ON vs.id = (
            SELECT id FROM video_snapshots
            WHERE video_id = v.id
            ORDER BY captured_at DESC
            LIMIT 1
          )
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_favorite_total
      FROM weekly_summaries ws
      JOIN accounts a ON a.id = ws.account_id
      JOIN platforms p ON p.id = a.platform_id
      LEFT JOIN weekly_summaries prev ON prev.account_id = ws.account_id
        AND date(prev.week_start) = date(ws.week_start, '-7 days')
      WHERE a.is_active = 1
      ORDER BY ws.week_start DESC, ws.updated_at DESC
      LIMIT ?
    `
    )
    .all(limit);
}

export function getOverview() {
  computeWeeklySummaries();
  const currentWeekStart = startOfWeek().toISOString();

  const totals = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS account_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN is_active = 1 AND latest_collect_status = 'failed' THEN 1 ELSE 0 END) AS failed_count
      FROM accounts
    `
    )
    .get();

  const jobs = db
    .prepare(
      `
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM capture_jobs
      WHERE created_at >= datetime('now', '-7 days')
    `
    )
    .get();

  const topFollowers = db
    .prepare(
      `
      SELECT ws.*, a.display_name, p.name AS platform_name
      FROM weekly_summaries ws
      JOIN accounts a ON a.id = ws.account_id
      JOIN platforms p ON p.id = a.platform_id
      WHERE a.is_active = 1 AND ws.week_start = ?
      ORDER BY COALESCE(ws.follower_delta, -999999999) DESC
      LIMIT 5
    `
    )
    .all(currentWeekStart);

  const weeklyTotals = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(ws.follower_delta), 0) AS followers,
        COALESCE(SUM(ws.video_like_delta), 0)
          + COALESCE(SUM(ws.video_comment_delta), 0)
          + COALESCE(SUM(ws.video_favorite_delta), 0) AS interactions
      FROM weekly_summaries ws
      JOIN accounts a ON a.id = ws.account_id
      WHERE a.is_active = 1 AND ws.week_start = ?
    `
    )
    .get(currentWeekStart);

  return { totals, jobs, topFollowers, weeklyTotals };
}
