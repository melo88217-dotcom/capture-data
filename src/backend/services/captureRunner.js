import { getCollector } from "../collectors/index.js";
import {
  addCaptureLog,
  createCaptureJob,
  expireStaleCaptureJobs,
  getCaptureJob,
  listDueAccounts,
  markJobFinished,
  markJobRunning,
  markJobRetrying,
  saveCaptureResult
} from "./repository.js";
import { nextScheduledAt, shouldSchedule } from "../utils/time.js";
import { resetPersistentPage } from "../collectors/shared/browserCollector.js";
import {
  CaptureTrafficGuard,
  getCaptureRetryDelaysMs,
  isRetryableCaptureResult,
  runCaptureAttempts
} from "../utils/captureRetry.js";
import {
  isBrowserCacheCleanupRunning,
  isBrowserOperationRunning,
  runExclusiveBrowserOperation
} from "./browserMaintenance.js";

const captureTrafficGuard = new CaptureTrafficGuard();

export async function runCaptureJob(jobId, options = {}) {
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

  const trafficGuard = options.captureTrafficGuard || captureTrafficGuard;
  const retryDelaysMs = options.retryDelaysMs ?? getCaptureRetryDelaysMs();
  const isCancelled = () => getCaptureJob(jobId)?.status !== "running";

  try {
    const collector = options.collector || getCollector(job.platform_code);
    const timeoutMs = options.timeoutMs ?? getCaptureJobTimeoutMs();
    const runBrowserOperation = options.runBrowserOperation || runExclusiveBrowserOperation;
    const { result, attemptCount } = await runCaptureAttempts({
      retryDelaysMs,
      sleep: options.retrySleep,
      isCancelled,
      attempt: async ({ attemptCount: currentAttempt }) =>
        runQueuedCollectorAttempt({
          runBrowserOperation,
          trafficGuard,
          isCancelled,
          collector: () => collector(job),
          timeoutMs,
          timeoutMessage: `采集超过最长运行时间 ${Math.round(timeoutMs / 60000)} 分钟，系统已自动结束。`,
          onWait: async ({ waitMs, circuitOpen }) => {
            addCaptureLog(
              jobId,
              "info",
              circuitOpen ? "平台访问保护已启动" : "采集访问冷却",
              { wait_ms: waitMs, attempt: currentAttempt }
            );
          }
        }),
      reset: async () => (options.resetPage || resetPersistentPage)(),
      onRetry: async ({ retryCount, delayMs, result: attemptResult }) => {
        const progressMessage = [
          attemptResult.error_message || "本次采集未取得完整数据。",
          `系统将在 ${formatDelay(delayMs)}后自动进行第 ${retryCount} 次重试。`
        ].join(" ");
        markJobRetrying(jobId, {
          retryCount,
          errorCode: attemptResult.error_code,
          errorMessage: progressMessage
        });
        addCaptureLog(jobId, "warn", "采集触发自动重试", {
          retry_count: retryCount,
          next_attempt: retryCount + 1,
          delay_ms: delayMs,
          error_code: attemptResult.error_code,
          error_message: attemptResult.error_message,
          diagnostics: attemptResult.diagnostics || null
        });
      }
    });
    const currentJob = getCaptureJob(jobId);
    if (!currentJob?.is_active || currentJob.status === "skipped") return currentJob;
    trafficGuard.recordJobResult(result);

    const recoveredResult = addRecoverySummary(result, attemptCount, retryDelaysMs.length);
    const persistence = saveCaptureResult(job, recoveredResult);
    const finalResult = persistence.warnings.length
      ? {
          ...recoveredResult,
          status: persistence.effective_status,
          error_code: recoveredResult.error_code || "DATA_QUALITY_WARNING",
          error_message: [
            recoveredResult.error_message,
            `数据质量校验已排除 ${persistence.warnings.length} 个异常值，历史有效数据已保留。`
          ].filter(Boolean).join(" ")
        }
      : recoveredResult;
    if (persistence.warnings.length) {
      addCaptureLog(jobId, "warn", "采集数据质量校验", persistence);
    }
    markJobFinished(jobId, finalResult);
    addCaptureLog(jobId, finalResult.status === "failed" ? "error" : "info", "采集任务结束", finalResult);
    return getCaptureJob(jobId);
  } catch (error) {
    const currentJob = getCaptureJob(jobId);
    if (error.code === "CAPTURE_CANCELLED" || !currentJob?.is_active || currentJob.status === "skipped") {
      return currentJob;
    }
    trafficGuard.recordJobResult({
      status: "failed",
      error_code: error.code || "UNKNOWN_ERROR"
    });

    const result = {
      status: "failed",
      error_code: error.code || "UNKNOWN_ERROR",
      error_message: [
        error.message,
        currentJob.retry_count > 0
          ? `系统已自动重试 ${currentJob.retry_count}/${retryDelaysMs.length} 次，仍未恢复。`
          : null
      ].filter(Boolean).join(" ")
    };
    markJobFinished(jobId, result);
    addCaptureLog(jobId, "error", "采集任务异常结束", { message: error.message });
    return getCaptureJob(jobId);
  }
}

export function addRecoverySummary(result, attemptCount, maxRetryCount) {
  if (attemptCount <= 1) return result;
  const retryCount = attemptCount - 1;
  const retryExhausted = isRetryableCaptureResult(result);
  const recovered = result.status !== "failed" && !retryExhausted;
  const terminalFailure = result.status === "failed" && !retryExhausted;
  const recoveryMessage = recovered
    ? `系统在第 ${attemptCount} 次尝试时自动恢复成功。`
    : retryExhausted
      ? `系统已自动重试 ${retryCount}/${maxRetryCount} 次，仍未取得完整数据。`
      : `系统已自动重试 ${retryCount} 次，随后遇到不可自动重试的失败，已停止重试。`;
  return {
    ...result,
    error_message: [result.error_message, recoveryMessage].filter(Boolean).join(" "),
    diagnostics: {
      ...(result.diagnostics || {}),
      automatic_retry_count: retryCount,
      recovered,
      retry_exhausted: retryExhausted,
      terminal_failure: terminalFailure
    }
  };
}

export function runQueuedCollectorAttempt({
  runBrowserOperation,
  trafficGuard,
  isCancelled,
  collector,
  timeoutMs,
  timeoutMessage,
  onWait
}) {
  let resolveVisibleAttempt;
  let rejectVisibleAttempt;
  const visibleAttempt = new Promise((resolve, reject) => {
    resolveVisibleAttempt = resolve;
    rejectVisibleAttempt = reject;
  });

  return runBrowserOperation(
    async () => {
      let collectorStarted = false;
      try {
        await trafficGuard.wait(onWait, isCancelled);
        if (await isCancelled()) throw captureCancelledError();

        collectorStarted = true;
        const collectorOperation = Promise.resolve().then(collector);
        withTimeout(collectorOperation, timeoutMs, timeoutMessage).then(resolveVisibleAttempt, rejectVisibleAttempt);
        return await collectorOperation;
      } catch (error) {
        rejectVisibleAttempt(error);
        throw error;
      } finally {
        if (collectorStarted) trafficGuard.recordAttemptFinished();
      }
    },
    () => visibleAttempt
  );
}

function captureCancelledError() {
  const error = new Error("采集任务已结束，不再启动浏览器采集。");
  error.code = "CAPTURE_CANCELLED";
  return error;
}

function formatDelay(delayMs) {
  if (delayMs < 60_000) return `${Math.max(1, Math.round(delayMs / 1000))} 秒`;
  return `${Math.max(1, Math.round(delayMs / 60_000))} 分钟`;
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
