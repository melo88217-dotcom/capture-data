import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanBrowserCache, getBrowserCacheStatus } from "../src/backend/services/browserCache.js";
import { isBrowserOperationRunning, trackBrowserOperation } from "../src/backend/services/browserMaintenance.js";

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
  const tracked = trackBrowserOperation(collector);

  assert.equal(isBrowserOperationRunning(), true);
  finish();
  await tracked;
  assert.equal(isBrowserOperationRunning(), false);
});
