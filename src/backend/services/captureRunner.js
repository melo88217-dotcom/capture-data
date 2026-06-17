import { getCollector } from "../collectors/index.js";
import {
  addCaptureLog,
  createCaptureJob,
  getCaptureJob,
  listDueAccounts,
  markJobFinished,
  markJobRunning,
  saveCaptureResult
} from "./repository.js";
import { shouldSchedule } from "../utils/time.js";

export async function runCaptureJob(jobId) {
  const job = getCaptureJob(jobId);
  if (!job) throw new Error("采集任务不存在");
  if (job.status === "running") return job;

  markJobRunning(jobId);
  addCaptureLog(jobId, "info", "采集任务开始", { trigger_type: job.trigger_type });

  try {
    const collector = getCollector(job.platform_code);
    const result = await collector(job);

    saveCaptureResult(job, result);
    markJobFinished(jobId, result);
    addCaptureLog(jobId, result.status === "failed" ? "error" : "info", "采集任务结束", result);
    return getCaptureJob(jobId);
  } catch (error) {
    const result = {
      status: "failed",
      error_code: "UNKNOWN_ERROR",
      error_message: error.message
    };
    markJobFinished(jobId, result);
    addCaptureLog(jobId, "error", "采集任务异常结束", { message: error.message });
    return getCaptureJob(jobId);
  }
}

export async function enqueueAndRun(accountId, triggerType = "manual_now") {
  const job = createCaptureJob(accountId, triggerType);
  return runCaptureJob(job.id);
}

export async function scheduleDueCaptures() {
  const now = new Date();
  const accounts = listDueAccounts().filter((account) => shouldSchedule(account, now));
  const jobs = [];

  for (const account of accounts) {
    const triggerType = account.capture_frequency === "weekly" ? "weekly" : "daily";
    jobs.push(createCaptureJob(account.id, triggerType));
  }

  return jobs;
}

let schedulerRunning = false;

export async function runDueCaptures() {
  if (schedulerRunning) return [];
  schedulerRunning = true;
  try {
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
