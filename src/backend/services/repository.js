import { db } from "../db/database.js";
import { isImplausibleMetricChange, VIDEO_METRICS } from "../utils/dataQuality.js";
import { endOfWeek, nowIso, startOfWeek } from "../utils/time.js";

const accountSelect = `
  SELECT
    a.*,
    p.code AS platform_code,
    p.name AS platform_name
  FROM accounts a
  JOIN platforms p ON p.id = a.platform_id
`;

const latestVideoMetricsCte = `
  latest_video_metric_values AS (
    SELECT
      v.id AS video_id,
      (SELECT like_count FROM video_snapshots WHERE video_id = v.id AND like_count_status = 'available' AND like_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS like_count,
      (SELECT comment_count FROM video_snapshots WHERE video_id = v.id AND comment_count_status = 'available' AND comment_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS comment_count,
      (SELECT favorite_count FROM video_snapshots WHERE video_id = v.id AND favorite_count_status = 'available' AND favorite_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS favorite_count,
      (SELECT MAX(captured_at) FROM video_snapshots WHERE video_id = v.id AND (
        (like_count_status = 'available' AND like_count IS NOT NULL) OR
        (comment_count_status = 'available' AND comment_count IS NOT NULL) OR
        (favorite_count_status = 'available' AND favorite_count IS NOT NULL)
      )) AS captured_at
    FROM videos v
  ),
  latest_video_metrics AS (
    SELECT
      values_row.*,
      CASE WHEN values_row.like_count IS NOT NULL THEN 'available' ELSE COALESCE(raw.like_count_status, 'not_public') END AS like_count_status,
      CASE WHEN values_row.comment_count IS NOT NULL THEN 'available' ELSE COALESCE(raw.comment_count_status, 'not_public') END AS comment_count_status,
      CASE WHEN values_row.favorite_count IS NOT NULL THEN 'available' ELSE COALESCE(raw.favorite_count_status, 'not_public') END AS favorite_count_status
    FROM latest_video_metric_values values_row
    LEFT JOIN video_snapshots raw ON raw.id = (
      SELECT id FROM video_snapshots
      WHERE video_id = values_row.video_id
      ORDER BY captured_at DESC, id DESC
      LIMIT 1
    )
  )
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
          latest_total_like_count = NULL,
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
        a.capture_video_limit,
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

export function markJobRetrying(jobId, { retryCount, errorCode, errorMessage }) {
  db.prepare(
    `
      UPDATE capture_jobs
      SET retry_count = ?,
          error_code = ?,
          error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'
    `
  ).run(retryCount, errorCode || null, errorMessage || null, jobId);
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
  const warnings = [];
  const findPreviousFollower = db.prepare(
    `SELECT
       (SELECT follower_count FROM account_snapshots
        WHERE account_id = ? AND follower_count_status = 'available' AND follower_count IS NOT NULL
        ORDER BY captured_at DESC, id DESC LIMIT 1) AS value,
       (SELECT follower_count FROM account_snapshots
        WHERE account_id = ? AND follower_count_status = 'failed' AND follower_count IS NOT NULL
          AND captured_at > COALESCE((
            SELECT captured_at FROM account_snapshots
            WHERE account_id = ? AND follower_count_status = 'available' AND follower_count IS NOT NULL
            ORDER BY captured_at DESC, id DESC LIMIT 1
          ), '')
        ORDER BY captured_at DESC, id DESC LIMIT 1) AS pending_value`
  );
  const insertSnapshot = db.prepare(
    `
    INSERT INTO account_snapshots (
      account_id, captured_at,
      follower_count, follower_count_status, raw_follower_text,
      total_like_count, total_like_count_status, raw_total_like_text,
      source_url, capture_job_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  );
  const findVideo = db.prepare("SELECT id, account_id FROM videos WHERE video_url = ? ORDER BY id LIMIT 1");
  const updateVideo = db.prepare(
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
  );
  const insertVideo = db.prepare(
    `
    INSERT INTO videos (
      account_id, platform_video_id, video_url, title, description, cover_url, published_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  );
  const findPreviousVideoMetrics = db.prepare(
    `SELECT
       (SELECT like_count FROM video_snapshots WHERE video_id = ? AND like_count_status = 'available' AND like_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS like_count,
       (SELECT like_count FROM video_snapshots WHERE video_id = ? AND like_count_status = 'failed' AND like_count IS NOT NULL AND captured_at > COALESCE((SELECT captured_at FROM video_snapshots WHERE video_id = ? AND like_count_status = 'available' AND like_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1), '') ORDER BY captured_at DESC, id DESC LIMIT 1) AS pending_like_count,
       (SELECT comment_count FROM video_snapshots WHERE video_id = ? AND comment_count_status = 'available' AND comment_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS comment_count,
       (SELECT comment_count FROM video_snapshots WHERE video_id = ? AND comment_count_status = 'failed' AND comment_count IS NOT NULL AND captured_at > COALESCE((SELECT captured_at FROM video_snapshots WHERE video_id = ? AND comment_count_status = 'available' AND comment_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1), '') ORDER BY captured_at DESC, id DESC LIMIT 1) AS pending_comment_count,
       (SELECT favorite_count FROM video_snapshots WHERE video_id = ? AND favorite_count_status = 'available' AND favorite_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS favorite_count,
       (SELECT favorite_count FROM video_snapshots WHERE video_id = ? AND favorite_count_status = 'failed' AND favorite_count IS NOT NULL AND captured_at > COALESCE((SELECT captured_at FROM video_snapshots WHERE video_id = ? AND favorite_count_status = 'available' AND favorite_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1), '') ORDER BY captured_at DESC, id DESC LIMIT 1) AS pending_favorite_count`
  );
  const insertVideoSnapshot = db.prepare(
    `
    INSERT INTO video_snapshots (
      video_id, captured_at, like_count, comment_count, favorite_count,
      like_count_status, comment_count_status, favorite_count_status, raw_metric_text, capture_job_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const previousFollower = findPreviousFollower.get(job.account_id, job.account_id, job.account_id);
    const accountMetric = validateIncomingMetric({
      entityType: "account",
      entityId: job.account_id,
      metric: "follower_count",
      value: result.account.follower_count,
      status: result.account.follower_count_status,
      previous: previousFollower?.value,
      pending: previousFollower?.pending_value,
      warnings
    });
    insertSnapshot.run(
      job.account_id,
      sqlValue(result.captured_at),
      sqlValue(accountMetric.value),
      sqlValue(accountMetric.status),
      sqlValue(result.account.raw_follower_text),
      sqlValue(result.account.total_like_count),
      sqlValue(result.account.total_like_count_status || "not_public"),
      sqlValue(result.account.raw_total_like_text),
      sqlValue(result.account.profile_url),
      job.id
    );

    for (const video of result.videos || []) {
      const existing = findVideo.get(video.video_url);

      if (existing && existing.account_id !== job.account_id) {
        warnings.push({
          type: "video_account_conflict",
          video_url: video.video_url,
          owner_account_id: existing.account_id,
          rejected_account_id: job.account_id
        });
        continue;
      }

      let videoId = existing?.id;
      if (videoId) {
        updateVideo.run(
          sqlValue(video.platform_video_id),
          sqlValue(video.title),
          sqlValue(video.description || ""),
          sqlValue(video.cover_url || ""),
          sqlValue(video.published_at),
          videoId
        );
      } else {
        videoId = insertVideo.run(
          job.account_id,
          sqlValue(video.platform_video_id),
          sqlValue(video.video_url),
          sqlValue(video.title),
          sqlValue(video.description || ""),
          sqlValue(video.cover_url || ""),
          sqlValue(video.published_at)
        ).lastInsertRowid;
      }

      const previous = findPreviousVideoMetrics.get(...Array(9).fill(videoId));
      const metrics = Object.fromEntries(
        VIDEO_METRICS.map(({ column, statusColumn }) => [
          column,
          validateIncomingMetric({
            entityType: "video",
            entityId: videoId,
            metric: column,
            value: video[column],
            status: video[statusColumn],
            previous: previous[column],
            pending: previous[`pending_${column}`],
            warnings
          })
        ])
      );

      insertVideoSnapshot.run(
        videoId,
        sqlValue(result.captured_at),
        sqlValue(metrics.like_count.value),
        sqlValue(metrics.comment_count.value),
        sqlValue(metrics.favorite_count.value),
        sqlValue(metrics.like_count.status),
        sqlValue(metrics.comment_count.status),
        sqlValue(metrics.favorite_count.status),
        sqlValue(video.raw_metric_text || ""),
        job.id
      );
    }

    const effectiveStatus = warnings.some((warning) => warning.type === "video_account_conflict") && result.status === "success"
      ? "partial_success"
      : result.status;
    db.prepare(
      `
      UPDATE accounts
      SET latest_follower_count = CASE WHEN ? = 'available' THEN ? ELSE latest_follower_count END,
          latest_total_like_count = CASE WHEN ? = 'available' THEN ? ELSE latest_total_like_count END,
          latest_collect_status = ?,
          last_captured_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(
      accountMetric.status,
      accountMetric.value,
      result.account.total_like_count_status || "not_public",
      sqlValue(result.account.total_like_count),
      effectiveStatus,
      result.captured_at,
      job.account_id
    );

    db.exec("COMMIT");
    return {
      warnings,
      rejected_video_count: warnings.filter((warning) => warning.type === "video_account_conflict").length,
      effective_status: effectiveStatus
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function validateIncomingMetric({ entityType, entityId, metric, value, status, previous, pending, warnings }) {
  if (entityType === "account") return { value, status };
  if (status !== "available" || !isImplausibleMetricChange(previous, value)) return { value, status };
  if (pending != null && !isImplausibleMetricChange(pending, value)) return { value, status };
  warnings.push({
    type: "implausible_metric_drop",
    entity_type: entityType,
    entity_id: entityId,
    metric,
    previous_value: previous,
    rejected_value: value
  });
  return { value, status: "failed" };
}

export function listVideos(filters = {}) {
  const { where, params } = buildVideoFilters(filters);
  const limit = parseLimit(filters.limit);
  return db
    .prepare(
      `
      WITH ${latestVideoMetricsCte}
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
      LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
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
      WITH ${latestVideoMetricsCte}
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
      JOIN latest_video_metrics vs ON vs.video_id = v.id
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
      WITH ${latestVideoMetricsCte}
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
      JOIN latest_video_metrics vs ON vs.video_id = v.id
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

    const orderedDays = dates.map((item) => item.day).reverse();
    const ordered = buildDailyRows(account, orderedDays);
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      const previous = ordered[index - 1];
      const hasDailyBaseline = areConsecutiveDays(previous?.day, current.day);
      rows.push({
        ...current,
        follower_delta: hasDailyBaseline
          ? safeFollowerDelta(current.follower_count, previous?.follower_count)
          : null,
        like_delta: hasDailyBaseline ? current.like_delta : null,
        comment_delta: hasDailyBaseline ? current.comment_delta : null,
        favorite_delta: hasDailyBaseline ? current.favorite_delta : null
      });
    }
  }

  return rows.sort((a, b) => b.day.localeCompare(a.day) || a.account_name.localeCompare(b.account_name));
}

function safeFollowerDelta(current, previous) {
  if (isImplausibleMetricChange(previous, current)) return null;
  return diff(current, previous);
}

function areConsecutiveDays(previousDay, currentDay) {
  if (!previousDay || !currentDay) return false;
  const previous = Date.parse(`${previousDay}T00:00:00Z`);
  const current = Date.parse(`${currentDay}T00:00:00Z`);
  return Number.isFinite(previous) && Number.isFinite(current) && current - previous === 24 * 60 * 60 * 1000;
}

function buildDailyRows(account, days) {
  if (!days.length) return [];
  const firstDay = days[0];
  const lastDay = days.at(-1);
  const accountSnapshots = db
    .prepare(
      `
      SELECT *, date(captured_at, 'localtime') AS day
      FROM account_snapshots
      WHERE account_id = ? AND date(captured_at, 'localtime') BETWEEN ? AND ?
      ORDER BY captured_at, id
    `
    )
    .all(account.id, firstDay, lastDay);
  const metricSeeds = db
    .prepare(
      `
      SELECT
        v.id AS video_id,
        (SELECT like_count FROM video_snapshots WHERE video_id = v.id AND date(captured_at, 'localtime') < ? AND like_count_status = 'available' AND like_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS like_count,
        (SELECT comment_count FROM video_snapshots WHERE video_id = v.id AND date(captured_at, 'localtime') < ? AND comment_count_status = 'available' AND comment_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS comment_count,
        (SELECT favorite_count FROM video_snapshots WHERE video_id = v.id AND date(captured_at, 'localtime') < ? AND favorite_count_status = 'available' AND favorite_count IS NOT NULL ORDER BY captured_at DESC, id DESC LIMIT 1) AS favorite_count
      FROM videos v
      WHERE v.account_id = ? AND EXISTS (
        SELECT 1 FROM video_snapshots
        WHERE video_id = v.id AND date(captured_at, 'localtime') < ?
      )
    `
    )
    .all(firstDay, firstDay, firstDay, account.id, firstDay);
  const videoSnapshots = db
    .prepare(
      `
      SELECT vs.*, date(vs.captured_at, 'localtime') AS day
      FROM video_snapshots vs
      JOIN videos v ON v.id = vs.video_id
      WHERE v.account_id = ? AND date(vs.captured_at, 'localtime') BETWEEN ? AND ?
      ORDER BY vs.captured_at, vs.id
    `
    )
    .all(account.id, firstDay, lastDay);

  const accountByDay = new Map();
  for (const snapshot of accountSnapshots) {
    const daily = accountByDay.get(snapshot.day) || {};
    daily.latest = snapshot;
    if (snapshot.follower_count_status === "available" && snapshot.follower_count != null) {
      daily.follower = snapshot;
    }
    accountByDay.set(snapshot.day, daily);
  }

  const seenVideos = new Set();
  const metricStates = {
    like: createDailyMetricState("like_count"),
    comment: createDailyMetricState("comment_count"),
    favorite: createDailyMetricState("favorite_count")
  };
  for (const seed of metricSeeds) {
    seenVideos.add(seed.video_id);
    for (const state of Object.values(metricStates)) {
      if (seed[state.column] != null) state.values.set(seed.video_id, seed[state.column]);
    }
  }
  let videoIndex = 0;
  return days.map((day, dayIndex) => {
    let latestVideoCapturedAt = null;
    while (videoIndex < videoSnapshots.length && videoSnapshots[videoIndex].day <= day) {
      const snapshot = videoSnapshots[videoIndex];
      seenVideos.add(snapshot.video_id);
      if (snapshot.day === day) latestVideoCapturedAt = snapshot.captured_at;
      for (const state of Object.values(metricStates)) updateDailyMetricState(state, snapshot);
      videoIndex += 1;
    }

    const dailyAccount = accountByDay.get(day) || {};
    const row = {
      day,
      captured_at: dailyAccount.latest?.captured_at || latestVideoCapturedAt,
      account_id: account.id,
      account_name: account.display_name,
      platform_name: account.platform_name,
      follower_count: dailyAccount.follower?.follower_count ?? null,
      follower_count_status:
        dailyAccount.follower?.follower_count_status || dailyAccount.latest?.follower_count_status || "not_public",
      video_count: seenVideos.size,
      like_total: sumMetricValues(metricStates.like.values),
      comment_total: sumMetricValues(metricStates.comment.values),
      favorite_total: sumMetricValues(metricStates.favorite.values),
      like_delta: dailyMetricDelta(metricStates.like, dayIndex),
      comment_delta: dailyMetricDelta(metricStates.comment, dayIndex),
      favorite_delta: dailyMetricDelta(metricStates.favorite, dayIndex)
    };
    for (const state of Object.values(metricStates)) {
      state.comparableVideoIds = new Set(state.values.keys());
      state.delta = 0;
    }
    return row;
  });
}

function createDailyMetricState(column) {
  return { column, values: new Map(), comparableVideoIds: null, delta: 0 };
}

function updateDailyMetricState(state, snapshot) {
  if (snapshot[`${state.column}_status`] !== "available" || snapshot[state.column] == null) return;
  const previousValue = state.values.get(snapshot.video_id);
  if (state.comparableVideoIds?.has(snapshot.video_id)) {
    state.delta += snapshot[state.column] - previousValue;
  }
  state.values.set(snapshot.video_id, snapshot[state.column]);
}

function sumMetricValues(values) {
  if (!values.size) return null;
  return [...values.values()].reduce((total, value) => total + value, 0);
}

function dailyMetricDelta(state, dayIndex) {
  if (dayIndex === 0 || !state.comparableVideoIds?.size) return null;
  return state.delta;
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
    const followerDelta = first && last && snapshots.length > 1
      ? safeFollowerDelta(last.follower_count, first.follower_count)
      : null;
    const dataStatus = snapshots.length > 1 ? "complete" : snapshots.length === 1 ? "partial" : "insufficient";

    const videoDelta = db
      .prepare(
        `
        WITH snapshots AS (
          SELECT vs.*
          FROM video_snapshots vs
          JOIN videos v ON v.id = vs.video_id
          WHERE v.account_id = ? AND vs.captured_at >= ? AND vs.captured_at <= ?
        ),
        metric_points AS (
          SELECT video_id, 'like' AS metric, like_count AS value, captured_at, id
          FROM snapshots WHERE like_count_status = 'available' AND like_count IS NOT NULL
          UNION ALL
          SELECT video_id, 'comment', comment_count, captured_at, id
          FROM snapshots WHERE comment_count_status = 'available' AND comment_count IS NOT NULL
          UNION ALL
          SELECT video_id, 'favorite', favorite_count, captured_at, id
          FROM snapshots WHERE favorite_count_status = 'available' AND favorite_count IS NOT NULL
        ),
        ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY video_id, metric ORDER BY captured_at, id) AS oldest_rank,
            ROW_NUMBER() OVER (PARTITION BY video_id, metric ORDER BY captured_at DESC, id DESC) AS newest_rank
          FROM metric_points
        ),
        metric_values AS (
          SELECT video_id, metric,
            MAX(CASE WHEN oldest_rank = 1 THEN value END) AS oldest_value,
            MAX(CASE WHEN newest_rank = 1 THEN value END) AS newest_value
          FROM ranked
          GROUP BY video_id, metric
        )
        SELECT
          COUNT(DISTINCT video_id) AS video_snapshot_count,
          SUM(CASE WHEN metric = 'like' THEN newest_value - oldest_value ELSE 0 END) AS like_delta,
          SUM(CASE WHEN metric = 'comment' THEN newest_value - oldest_value ELSE 0 END) AS comment_delta,
          SUM(CASE WHEN metric = 'favorite' THEN newest_value - oldest_value ELSE 0 END) AS favorite_delta
        FROM metric_values
      `
    )
      .get(account.id, weekStart, weekEnd);

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
      WHERE weekly_summaries.follower_delta IS NOT excluded.follower_delta
         OR weekly_summaries.video_like_delta IS NOT excluded.video_like_delta
         OR weekly_summaries.video_comment_delta IS NOT excluded.video_comment_delta
         OR weekly_summaries.video_favorite_delta IS NOT excluded.video_favorite_delta
         OR weekly_summaries.data_status IS NOT excluded.data_status
         OR weekly_summaries.notes IS NOT excluded.notes
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
      WITH ${latestVideoMetricsCte}
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
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_like_total,
        (
          SELECT COALESCE(SUM(vs.like_count), 0)
          FROM videos v
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_like_total,
        (
          SELECT COALESCE(SUM(vs.comment_count), 0)
          FROM videos v
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_comment_total,
        (
          SELECT COALESCE(SUM(vs.comment_count), 0)
          FROM videos v
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start, '-7 days') AND date(ws.week_end, '-7 days')
        ) AS previous_published_comment_total,
        (
          SELECT COALESCE(SUM(vs.favorite_count), 0)
          FROM videos v
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
          WHERE v.account_id = ws.account_id
            AND date(v.published_at) BETWEEN date(ws.week_start) AND date(ws.week_end)
        ) AS current_published_favorite_total,
        (
          SELECT COALESCE(SUM(vs.favorite_count), 0)
          FROM videos v
          LEFT JOIN latest_video_metrics vs ON vs.video_id = v.id
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
