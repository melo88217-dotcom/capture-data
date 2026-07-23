export const VIDEO_METRICS = Object.freeze([
  Object.freeze({ column: "like_count", statusColumn: "like_count_status" }),
  Object.freeze({ column: "comment_count", statusColumn: "comment_count_status" }),
  Object.freeze({ column: "favorite_count", statusColumn: "favorite_count_status" })
]);

export function isImplausibleMetricChange(previousValue, currentValue) {
  if (previousValue == null || currentValue == null) return false;
  const previous = Number(previousValue);
  const current = Number(currentValue);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
  if (previous < 0 || current < 0) return false;
  const smaller = Math.min(previous, current);
  const larger = Math.max(previous, current);
  return larger - smaller >= 20 && smaller <= larger * 0.25;
}

export const isImplausibleMetricDrop = isImplausibleMetricChange;
