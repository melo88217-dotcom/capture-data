import { getCollector } from "../collectors/index.js";
import {
  addCaptureLog,
  createCaptureJob,
  expireStaleCaptureJobs,
  getCaptureJob,
  listDueAccounts,
  markJobFinished,
  markJobRunning,
  saveCaptureResult
} from "./repository.js";
import { nextScheduledAt, shouldSchedule } from "../utils/time.js";
import {
  isBrowserCacheCleanupRunning,
  isBrowserOperationRunning,
  trackBrowserOperation
} from "./browserMaintenance.js";

export async function runCaptureJob(jobId) {
  assertBrowserAvailable();
  const job = getCaptureJob(jobId);
  if (!job) throw new Error("采集任务不存在");
  if (job.status === "running") return job;
  if (!job.is_active) {
    markJobFinished(jobId, {
      status: "skipped",
      error_code: "ACCOUNT_INACTIVE",
      error_message: "账号已删除，跳过采集"
    });
    return getCaptureJob(jobId);
  }

  if (!markJobRunning(jobId)) return getCaptureJob(jobId);
  addCaptureLog(jobId, "info", "采集任务开始", { trigger_type: job.trigger_type });

  try {
    const collector = getCollector(job.platform_code);
    const collectorOperation = trackBrowserOperation(Promise.resolve().then(() => collector(job)));
    const result = await withTimeout(
      collectorOperation,
      getCaptureJobTimeoutMs(),
      `采集超过最长运行时间 ${Math.round(getCaptureJobTimeoutMs() / 60000)} 分钟，系统已自动结束。`
    );
    const currentJob = getCaptureJob(jobId);
    if (!currentJob?.is_active || currentJob.status === "skipped") return currentJob;

    saveCaptureResult(job, result);
    markJobFinished(jobId, result);
    addCaptureLog(jobId, result.status === "failed" ? "error" : "info", "采集任务结束", result);
    return getCaptureJob(jobId);
  } catch (error) {
    const currentJob = getCaptureJob(jobId);
    if (!currentJob?.is_active || currentJob.status === "skipped") return currentJob;

    const result = {
      status: "failed",
      error_code: error.code || "UNKNOWN_ERROR",
      error_message: error.message
    };
    markJobFinished(jobId, result);
    addCaptureLog(jobId, "error", "采集任务异常结束", { message: error.message });
    return getCaptureJob(jobId);
  }
}

function getCaptureJobTimeoutMs() {
  const configured = Number(process.env.CAPTURE_JOB_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 12 * 60 * 1000;
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "CAPTURE_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function enqueueAndRun(accountId, triggerType = "manual_now") {
  assertBrowserAvailable();
  const job = createCaptureJob(accountId, triggerType);
  return runCaptureJob(job.id);
}

export function enqueueAndStart(accountId, triggerType = "manual_now") {
  assertBrowserAvailable();
  const job = createCaptureJob(accountId, triggerType);
  runCaptureJob(job.id).catch((error) => {
    console.error("[capture] background job failed", error);
  });
  return getCaptureJob(job.id);
}

export async function scheduleDueCaptures() {
  if (isBrowserCacheCleanupRunning() || isBrowserOperationRunning()) return [];
  const now = new Date();
  const accounts = listDueAccounts().filter((account) => shouldSchedule(account, now));
  const jobs = [];

  for (const account of accounts) {
    const triggerType = account.capture_frequency === "weekly" ? "weekly" : "daily";
    jobs.push(createCaptureJob(account.id, triggerType));
  }

  return jobs;
}

function assertBrowserAvailable() {
  if (!isBrowserCacheCleanupRunning()) return;
  const error = new Error("浏览器缓存正在清理，请稍后再开始采集。");
  error.code = "CACHE_CLEANUP_RUNNING";
  error.statusCode = 409;
  throw error;
}

export function nextDueCaptureAt(now = new Date()) {
  return listDueAccounts()
    .map((account) => nextScheduledAt(account, now))
    .filter(Boolean)
    .reduce((earliest, candidate) => (!earliest || candidate < earliest ? candidate : earliest), null);
}

let schedulerRunning = false;

export async function runDueCaptures() {
  if (schedulerRunning) return [];
  schedulerRunning = true;
  try {
    expireStaleCaptureJobs();
    const jobs = await scheduleDueCaptures();
    const finished = [];
    for (const job of jobs) {
      finished.push(await runCaptureJob(job.id));
    }
    return finished;
  } finally {
    schedulerRunning = false;
  }
}
