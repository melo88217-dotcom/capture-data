import { setTimeout as delay } from "node:timers/promises";
import { readNonNegativeNumber } from "./captureConfig.js";

const RETRYABLE_CAPTURE_CODES = new Set([
  "PAGE_RENDER_INCOMPLETE",
  "VIDEO_DATA_MISSING",
  "VIDEO_DETAIL_INCOMPLETE",
  "NETWORK_ERROR",
  "CAPTURE_TIMEOUT"
]);
const NEVER_CANCELLED = () => false;

export function isRetryableCaptureResult(result) {
  return RETRYABLE_CAPTURE_CODES.has(result?.error_code);
}

export function getCaptureRetryDelaysMs(env = process.env) {
  const configured = String(env.CAPTURE_RETRY_DELAYS_MS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return configured.length ? configured : [60_000, 5 * 60_000, 20 * 60_000];
}

export async function runCaptureAttempts({
  attempt,
  retryDelaysMs = getCaptureRetryDelaysMs(),
  sleep = delay,
  beforeAttempt = async () => {},
  afterAttempt = async () => {},
  reset = async () => {},
  onRetry = async () => {},
  isCancelled = NEVER_CANCELLED
}) {
  let attemptCount = 0;

  while (attemptCount <= retryDelaysMs.length) {
    attemptCount += 1;
    await beforeAttempt({ attemptCount });

    let result;
    let error = null;
    try {
      result = await attempt({ attemptCount });
    } catch (attemptError) {
      error = attemptError;
      result = {
        status: "failed",
        error_code: attemptError.code || "UNKNOWN_ERROR",
        error_message: attemptError.message
      };
    }
    await afterAttempt({ attemptCount, result: error ? null : result, error });

    if (!isRetryableCaptureResult(result) || attemptCount > retryDelaysMs.length) {
      if (error) throw error;
      return { result, attemptCount };
    }

    const retryCount = attemptCount;
    const delayMs = retryDelaysMs[attemptCount - 1];
    await onRetry({ attemptCount, retryCount, delayMs, result, error });
    await reset({ attemptCount, retryCount, result, error });
    await sleepWithCancellation(delayMs, sleep, isCancelled);
  }

  throw new Error("采集重试流程异常结束。");
}

export class CaptureTrafficGuard {
  constructor({
    now = Date.now,
    sleep = delay,
    cooldownMs = readNonNegativeNumber(process.env.CAPTURE_ACCOUNT_COOLDOWN_MS, 30_000),
    circuitBreakMs = readNonNegativeNumber(process.env.CAPTURE_CIRCUIT_BREAK_MS, 15 * 60_000),
    circuitThreshold = readPositiveNumber(process.env.CAPTURE_CIRCUIT_THRESHOLD, 2)
  } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.cooldownMs = cooldownMs;
    this.circuitBreakMs = circuitBreakMs;
    this.circuitThreshold = circuitThreshold;
    this.lastAttemptFinishedAt = null;
    this.consecutiveTransientFailures = 0;
    this.circuitOpenUntil = 0;
  }

  async wait(onWait = async () => {}, isCancelled = NEVER_CANCELLED) {
    throwIfCancelled(await isCancelled());
    const current = this.now();
    const cooldownUntil = this.lastAttemptFinishedAt == null
      ? 0
      : this.lastAttemptFinishedAt + this.cooldownMs;
    const waitUntil = Math.max(cooldownUntil, this.circuitOpenUntil);
    const waitMs = Math.max(0, waitUntil - current);
    if (!waitMs) return 0;

    await onWait({ waitMs, circuitOpen: this.circuitOpenUntil > current });
    await sleepWithCancellation(waitMs, this.sleep, isCancelled);
    return waitMs;
  }

  recordAttemptFinished() {
    this.lastAttemptFinishedAt = this.now();
  }

  recordJobResult(result) {
    if (isRetryableCaptureResult(result)) {
      this.consecutiveTransientFailures += 1;
      if (this.consecutiveTransientFailures >= this.circuitThreshold) {
        this.circuitOpenUntil = Math.max(this.circuitOpenUntil, this.now() + this.circuitBreakMs);
      }
      return;
    }

    this.consecutiveTransientFailures = 0;
    this.circuitOpenUntil = 0;
  }

  getState() {
    return {
      lastAttemptFinishedAt: this.lastAttemptFinishedAt,
      consecutiveTransientFailures: this.consecutiveTransientFailures,
      circuitOpenUntil: this.circuitOpenUntil
    };
  }
}

async function sleepWithCancellation(delayMs, sleep, isCancelled) {
  if (isCancelled === NEVER_CANCELLED) {
    await sleep(delayMs);
    return;
  }

  let remainingMs = delayMs;
  while (remainingMs > 0) {
    throwIfCancelled(await isCancelled());
    const chunkMs = Math.min(remainingMs, 1_000);
    await sleep(chunkMs);
    remainingMs -= chunkMs;
  }
  throwIfCancelled(await isCancelled());
}

function throwIfCancelled(cancelled) {
  if (!cancelled) return;
  const error = new Error("采集任务已取消，不再继续重试。");
  error.code = "CAPTURE_CANCELLED";
  throw error;
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
