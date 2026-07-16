import test from "node:test";
import assert from "node:assert/strict";

import { nextScheduledAt } from "../src/backend/utils/time.js";

function account(overrides = {}) {
  return {
    is_active: 1,
    capture_frequency: "daily",
    preferred_capture_time: "10:15",
    last_captured_at: null,
    ...overrides
  };
}

test("daily capture is scheduled at the account's configured time", () => {
  const now = new Date(2026, 6, 10, 9, 50, 0);
  const scheduled = nextScheduledAt(account(), now);

  assert.deepEqual(scheduled, new Date(2026, 6, 10, 10, 15, 0));
});

test("daily capture catches up once after startup when today's time has passed", () => {
  const now = new Date(2026, 6, 10, 10, 30, 0);
  const scheduled = nextScheduledAt(account(), now);

  assert.deepEqual(scheduled, now);
});

test("daily capture waits until tomorrow after it has already run today", () => {
  const now = new Date(2026, 6, 10, 10, 30, 0);
  const scheduled = nextScheduledAt(account({ last_captured_at: new Date(2026, 6, 10, 10, 16, 0).toISOString() }), now);

  assert.deepEqual(scheduled, new Date(2026, 6, 11, 10, 15, 0));
});

test("daily capture does not retry a failed scheduled attempt again that day", () => {
  const now = new Date(2026, 6, 10, 10, 30, 0);
  const scheduled = nextScheduledAt(account({ last_scheduled_at: new Date(2026, 6, 10, 10, 15, 0).toISOString() }), now);

  assert.deepEqual(scheduled, new Date(2026, 6, 11, 10, 15, 0));
});
