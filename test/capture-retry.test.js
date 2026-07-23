import test from "node:test";
import assert from "node:assert/strict";

import {
  CaptureTrafficGuard,
  getCaptureRetryDelaysMs,
  isRetryableCaptureResult,
  runCaptureAttempts
} from "../src/backend/utils/captureRetry.js";

const incomplete = {
  status: "failed",
  error_code: "PAGE_RENDER_INCOMPLETE",
  error_message: "页面没有完整渲染"
};

test("retry delays use defaults when the setting is missing or empty", () => {
  const defaults = [60_000, 300_000, 1_200_000];

  assert.deepEqual(getCaptureRetryDelaysMs({}), defaults);
  assert.deepEqual(getCaptureRetryDelaysMs({ CAPTURE_RETRY_DELAYS_MS: "" }), defaults);
  assert.deepEqual(getCaptureRetryDelaysMs({ CAPTURE_RETRY_DELAYS_MS: " ,  " }), defaults);
});

test("a transient render failure is retried until collection succeeds", async () => {
  const results = [incomplete, incomplete, { status: "success", error_code: null }];
  const delays = [];
  const retries = [];

  const outcome = await runCaptureAttempts({
    attempt: async () => results.shift(),
    retryDelaysMs: [10, 20, 30],
    sleep: async (ms) => delays.push(ms),
    onRetry: async (event) => retries.push(event)
  });

  assert.equal(outcome.result.status, "success");
  assert.equal(outcome.attemptCount, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.deepEqual(retries.map((event) => event.retryCount), [1, 2]);
});

test("login and captcha failures are never retried", async () => {
  for (const errorCode of ["LOGIN_REQUIRED", "CAPTCHA_REQUIRED", "ACCESS_DENIED"]) {
    let calls = 0;
    const outcome = await runCaptureAttempts({
      attempt: async () => {
        calls += 1;
        return { status: "failed", error_code: errorCode };
      },
      retryDelaysMs: [1, 1, 1],
      sleep: async () => assert.fail("non-retryable failures must not sleep")
    });

    assert.equal(calls, 1);
    assert.equal(outcome.attemptCount, 1);
  }
});

test("a thrown attempt timeout is retried without losing the final success", async () => {
  let calls = 0;
  let resets = 0;
  const outcome = await runCaptureAttempts({
    attempt: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("attempt timed out");
        error.code = "CAPTURE_TIMEOUT";
        throw error;
      }
      return { status: "success", error_code: null };
    },
    retryDelaysMs: [0],
    sleep: async () => {},
    reset: async () => {
      resets += 1;
    }
  });

  assert.equal(outcome.result.status, "success");
  assert.equal(outcome.attemptCount, 2);
  assert.equal(resets, 1);
});

test("retry backoff stops promptly when the capture is cancelled", async () => {
  let cancelled = false;
  let attempts = 0;
  const sleeps = [];

  await assert.rejects(
    runCaptureAttempts({
      attempt: async () => {
        attempts += 1;
        return incomplete;
      },
      retryDelaysMs: [2_500],
      sleep: async (ms) => {
        sleeps.push(ms);
        cancelled = true;
      },
      isCancelled: () => cancelled
    }),
    (error) => error.code === "CAPTURE_CANCELLED"
  );

  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, [1_000]);
});

test("retry budget exhaustion returns the final retryable result without another wait", async () => {
  let attempts = 0;
  let resets = 0;
  const sleeps = [];
  const retries = [];

  const outcome = await runCaptureAttempts({
    attempt: async () => {
      attempts += 1;
      return incomplete;
    },
    retryDelaysMs: [10, 20],
    sleep: async (ms) => sleeps.push(ms),
    reset: async () => {
      resets += 1;
    },
    onRetry: async (event) => retries.push(event.retryCount)
  });

  assert.equal(outcome.result, incomplete);
  assert.equal(outcome.attemptCount, 3);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(resets, 2);
  assert.deepEqual(retries, [1, 2]);
});

test("retry policy includes incomplete pages, missing videos, networks and attempt timeouts", () => {
  for (const errorCode of [
    "PAGE_RENDER_INCOMPLETE",
    "VIDEO_DATA_MISSING",
    "VIDEO_DETAIL_INCOMPLETE",
    "NETWORK_ERROR",
    "CAPTURE_TIMEOUT"
  ]) {
    assert.equal(isRetryableCaptureResult({ status: "failed", error_code: errorCode }), true);
  }
  assert.equal(isRetryableCaptureResult({ status: "failed", error_code: "LOGIN_REQUIRED" }), false);
});

test("traffic guard applies cooldown and opens a circuit after two final transient failures", async () => {
  let now = 1_000;
  const waits = [];
  const guard = new CaptureTrafficGuard({
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    cooldownMs: 1_000,
    circuitBreakMs: 5_000,
    circuitThreshold: 2
  });

  guard.recordAttemptFinished();
  now += 400;
  await guard.wait();
  assert.deepEqual(waits, [600]);

  guard.recordJobResult(incomplete);
  guard.recordJobResult(incomplete);
  const state = guard.getState();
  assert.equal(state.consecutiveTransientFailures, 2);
  assert.equal(state.circuitOpenUntil, now + 5_000);

  await guard.wait();
  assert.deepEqual(waits, [600, 5_000]);

  guard.recordJobResult({ status: "success", error_code: null });
  assert.equal(guard.getState().consecutiveTransientFailures, 0);
});
