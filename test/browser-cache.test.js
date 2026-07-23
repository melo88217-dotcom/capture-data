import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setImmediate, setTimeout as delay } from "node:timers/promises";

import { cleanBrowserCache, getBrowserCacheStatus } from "../src/backend/services/browserCache.js";
import {
  isBrowserOperationRunning,
  runExclusiveBrowserOperation
} from "../src/backend/services/browserMaintenance.js";

async function makeFile(root, relativePath, size) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.alloc(size, 1));
}

test("browser cache status counts only the safe cache allowlist", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "browser-cache-status-"));
  await makeFile(profileDir, "Default/Cache/page.bin", 120);
  await makeFile(profileDir, "Default/Code Cache/code.bin", 80);
  await makeFile(profileDir, "Default/Cookies", 60);

  const status = await getBrowserCacheStatus({ profileDir, captureRunning: () => false });

  assert.equal(status.totalBytes, 260);
  assert.equal(status.reclaimableBytes, 200);
  assert.equal(status.captureRunning, false);
});

test("browser cache cleanup removes cache and preserves login data", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "browser-cache-clean-"));
  await makeFile(profileDir, "Default/Cache/page.bin", 120);
  await makeFile(profileDir, "Default/Code Cache/code.bin", 80);
  await makeFile(profileDir, "Default/Cookies", 60);
  await makeFile(profileDir, "Default/Local Storage/session.bin", 40);

  let prepared = false;
  const result = await cleanBrowserCache({
    profileDir,
    captureRunning: () => false,
    prepareForCleanup: async () => {
      prepared = true;
    }
  });

  assert.equal(result.success, true);
  assert.equal(prepared, true);
  assert.equal(result.beforeBytes, 200);
  assert.equal(result.releasedBytes, 200);
  assert.deepEqual(await readFile(path.join(profileDir, "Default/Cookies")), Buffer.alloc(60, 1));
  assert.deepEqual(
    await readFile(path.join(profileDir, "Default/Local Storage/session.bin")),
    Buffer.alloc(40, 1)
  );
});

test("browser cache cleanup refuses to run during capture", async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "browser-cache-running-"));
  await makeFile(profileDir, "Default/Cache/page.bin", 120);

  await assert.rejects(
    cleanBrowserCache({ profileDir, captureRunning: () => true }),
    (error) => error.code === "CAPTURE_RUNNING" && error.statusCode === 409
  );
  assert.equal((await readFile(path.join(profileDir, "Default/Cache/page.bin"))).length, 120);
});

test("browser operation remains active until the underlying collector settles", async () => {
  let finish;
  const collector = new Promise((resolve) => {
    finish = resolve;
  });
  const tracked = runExclusiveBrowserOperation(() => collector);

  assert.equal(isBrowserOperationRunning(), true);
  finish();
  await tracked;
  assert.equal(isBrowserOperationRunning(), false);
});

test("browser operations are serialized so collectors cannot navigate the shared page concurrently", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = runExclusiveBrowserOperation(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = runExclusiveBrowserOperation(async () => {
    events.push("second:start");
    events.push("second:end");
  });

  await setImmediate();
  assert.deepEqual(events, ["first:start"]);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("queued wait does not consume runtime timeout and timeout keeps the browser slot locked", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let releaseSecond;
  const secondGate = new Promise((resolve) => {
    releaseSecond = resolve;
  });
  let secondStarted = false;
  let thirdStarted = false;

  const first = runExclusiveBrowserOperation(() => firstGate);
  const second = runExclusiveBrowserOperation(
    () => {
      secondStarted = true;
      return secondGate;
    },
    (operation) => Promise.race([
      operation,
      delay(20).then(() => {
        throw new Error("collector timeout");
      })
    ])
  );
  const secondOutcome = second.then(
    () => ({ error: null }),
    (error) => ({ error })
  );

  await delay(40);
  assert.equal(secondStarted, false);
  releaseFirst();
  await first;
  const outcome = await secondOutcome;
  assert.match(outcome.error.message, /collector timeout/);
  assert.equal(secondStarted, true);
  assert.equal(isBrowserOperationRunning(), true);

  const third = runExclusiveBrowserOperation(() => {
    thirdStarted = true;
  });
  await setImmediate();
  assert.equal(thirdStarted, false);

  releaseSecond();
  await third;
  assert.equal(thirdStarted, true);
  assert.equal(isBrowserOperationRunning(), false);
});
