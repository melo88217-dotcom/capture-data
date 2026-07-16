import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { beginBrowserCacheCleanup, endBrowserCacheCleanup } from "./browserMaintenance.js";

const CACHE_ALLOWLIST = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "GPUPersistentCache"
];

let lastCleanedAt = null;

export async function getBrowserCacheStatus({ profileDir, captureRunning = () => false }) {
  const { totalBytes, reclaimableBytes } = await profileStats(profileDir);

  return {
    totalBytes,
    reclaimableBytes,
    captureRunning: Boolean(captureRunning()),
    lastCleanedAt
  };
}

export async function cleanBrowserCache({
  profileDir,
  captureRunning = () => false,
  prepareForCleanup = async () => {}
}) {
  if (!beginBrowserCacheCleanup()) {
    throw httpError("浏览器缓存正在清理，请稍后再试。", "CACHE_CLEANUP_RUNNING", 409);
  }

  try {
    if (captureRunning()) {
      throw httpError("当前有采集任务正在运行，请等待采集结束后再清理。", "CAPTURE_RUNNING", 409);
    }

    await prepareForCleanup();
    if (captureRunning()) {
      throw httpError("采集浏览器仍在运行，请稍后再试。", "CAPTURE_RUNNING", 409);
    }

    const beforeBytes = await sumAllowlist(profileDir);
    const failedPaths = [];

    const profileRealPath = await realpath(profileDir);
    for (const relativePath of CACHE_ALLOWLIST) {
      const target = safeTarget(profileDir, relativePath);
      await clearDirectory(target, profileRealPath, relativePath, failedPaths);
    }

    const afterBytes = await sumAllowlist(profileDir);
    lastCleanedAt = new Date().toISOString();

    return {
      success: failedPaths.length === 0,
      beforeBytes,
      afterBytes,
      releasedBytes: Math.max(0, beforeBytes - afterBytes),
      failedPaths,
      lastCleanedAt
    };
  } finally {
    endBrowserCacheCleanup();
  }
}

async function clearDirectory(target, profileRealPath, relativePath, failedPaths) {
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    failedPaths.push({ path: relativePath, error: error.message });
    return;
  }

  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    failedPaths.push({ path: relativePath, error: "目标不是可安全清理的普通目录" });
    return;
  }

  let targetRealPath;
  try {
    targetRealPath = await realpath(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    failedPaths.push({ path: relativePath, error: error.message });
    return;
  }
  const relation = path.relative(profileRealPath, targetRealPath);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    failedPaths.push({ path: relativePath, error: "缓存目录指向浏览器配置目录之外" });
    return;
  }

  const entries = await readdir(target, { withFileTypes: true }).catch((error) => {
    failedPaths.push({ path: relativePath, error: error.message });
    return [];
  });

  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      failedPaths.push({ path: `${relativePath}/${entry.name}`, error: "跳过符号链接" });
      continue;
    }
    try {
      await rm(child, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
    } catch (error) {
      failedPaths.push({ path: `${relativePath}/${entry.name}`, error: error.message });
    }
  }

  await mkdir(target, { recursive: true });
}

async function sumAllowlist(profileDir) {
  const sizes = await Promise.all(CACHE_ALLOWLIST.map((relativePath) => directorySize(safeTarget(profileDir, relativePath))));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function profileStats(profileDir) {
  const allowlist = new Set(CACHE_ALLOWLIST.map((relativePath) => safeTarget(profileDir, relativePath)));
  const limit = createLimiter(32);

  async function walk(target, insideAllowlist = false) {
    let stat;
    try {
      stat = await limit(() => lstat(target));
    } catch (error) {
      if (error.code === "ENOENT") return { totalBytes: 0, reclaimableBytes: 0 };
      throw error;
    }

    if (stat.isSymbolicLink()) return { totalBytes: 0, reclaimableBytes: 0 };
    const reclaimable = insideAllowlist || allowlist.has(target);
    if (!stat.isDirectory()) {
      return { totalBytes: stat.size, reclaimableBytes: reclaimable ? stat.size : 0 };
    }

    let entries;
    try {
      entries = await limit(() => readdir(target, { withFileTypes: true }));
    } catch (error) {
      if (error.code === "ENOENT") return { totalBytes: 0, reclaimableBytes: 0 };
      throw error;
    }
    const children = await Promise.all(
      entries.map((entry) =>
        entry.isSymbolicLink()
          ? { totalBytes: 0, reclaimableBytes: 0 }
          : walk(path.join(target, entry.name), reclaimable)
      )
    );
    return children.reduce(
      (totals, child) => ({
        totalBytes: totals.totalBytes + child.totalBytes,
        reclaimableBytes: totals.reclaimableBytes + child.reclaimableBytes
      }),
      { totalBytes: 0, reclaimableBytes: 0 }
    );
  }

  return walk(path.resolve(profileDir));
}

async function directorySize(target) {
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;

  const entries = await readdir(target, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map((entry) => (entry.isSymbolicLink() ? 0 : directorySize(path.join(target, entry.name))))
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

function safeTarget(profileDir, relativePath) {
  const root = path.resolve(profileDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("缓存目录超出浏览器配置目录");
  }
  return target;
}

function createLimiter(concurrency) {
  let active = 0;
  const waiting = [];

  return async function limit(operation) {
    if (active >= concurrency) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function httpError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
