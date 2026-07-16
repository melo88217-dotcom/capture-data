let cleaningBrowserCache = false;
let activeBrowserOperations = 0;

export function beginBrowserCacheCleanup() {
  if (cleaningBrowserCache) return false;
  cleaningBrowserCache = true;
  return true;
}

export function endBrowserCacheCleanup() {
  cleaningBrowserCache = false;
}

export function isBrowserCacheCleanupRunning() {
  return cleaningBrowserCache;
}

export function trackBrowserOperation(operation) {
  activeBrowserOperations += 1;
  return Promise.resolve(operation).finally(() => {
    activeBrowserOperations = Math.max(0, activeBrowserOperations - 1);
  });
}

export function isBrowserOperationRunning() {
  return activeBrowserOperations > 0;
}
