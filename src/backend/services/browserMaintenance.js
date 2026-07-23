let cleaningBrowserCache = false;
let activeBrowserOperations = 0;
let browserOperationTail = Promise.resolve();

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

function trackBrowserOperation(operation) {
  activeBrowserOperations += 1;
  return Promise.resolve(operation).finally(() => {
    activeBrowserOperations = Math.max(0, activeBrowserOperations - 1);
  });
}

export function runExclusiveBrowserOperation(operationFactory, resultFactory = (operation) => operation) {
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const operation = browserOperationTail.then(() => {
    let underlying;
    try {
      underlying = Promise.resolve(operationFactory());
    } catch (error) {
      rejectResult(error);
      throw error;
    }
    Promise.resolve()
      .then(() => resultFactory(underlying))
      .then(resolveResult, rejectResult);
    return underlying;
  });
  operation.catch(rejectResult);
  browserOperationTail = trackBrowserOperation(operation).catch(() => {});
  return result;
}

export function isBrowserOperationRunning() {
  return activeBrowserOperations > 0;
}
