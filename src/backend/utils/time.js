export function nowIso() {
  return new Date().toISOString();
}

export function startOfWeek(date = new Date()) {
  const current = new Date(date);
  const day = current.getDay() || 7;
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - day + 1);
  return current;
}

export function endOfWeek(date = new Date()) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function shouldSchedule(account, now = new Date()) {
  if (!account.is_active || account.capture_frequency === "manual") return false;

  const last = lastAttemptAt(account);
  const diffMs = last ? now.getTime() - last.getTime() : Number.POSITIVE_INFINITY;
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (account.capture_frequency === "hourly") return diffMs >= hourMs;
  if (account.capture_frequency === "six_hours") return diffMs >= 6 * hourMs;
  if (account.capture_frequency === "daily") return isDailyDue(last, now, account.preferred_capture_time);
  if (account.capture_frequency === "weekly") {
    return diffMs >= 7 * dayMs && isTimeReached(now, account.preferred_capture_time);
  }
  return false;
}

export function nextScheduledAt(account, now = new Date()) {
  if (!account.is_active || account.capture_frequency === "manual") return null;

  const last = lastAttemptAt(account);
  const hourMs = 60 * 60 * 1000;

  if (account.capture_frequency === "hourly") {
    return last ? new Date(Math.max(now.getTime(), last.getTime() + hourMs)) : now;
  }
  if (account.capture_frequency === "six_hours") {
    return last ? new Date(Math.max(now.getTime(), last.getTime() + 6 * hourMs)) : now;
  }
  if (account.capture_frequency === "daily") return nextDailyAt(last, now, account.preferred_capture_time);
  if (account.capture_frequency === "weekly") return nextWeeklyAt(last, now, account.preferred_capture_time);
  return null;
}

function isDailyDue(last, now, preferredTime) {
  if (!isTimeReached(now, preferredTime)) return false;
  if (!last) return true;
  return localDateKey(last) !== localDateKey(now);
}

function nextDailyAt(last, now, preferredTime) {
  const target = targetTime(now, preferredTime);
  if (last && localDateKey(last) === localDateKey(now)) {
    target.setDate(target.getDate() + 1);
    return target;
  }
  return now >= target ? now : target;
}

function nextWeeklyAt(last, now, preferredTime) {
  const target = targetTime(startOfWeek(now), preferredTime);
  if (now < target) return target;
  if (!last || last < target) return now;
  target.setDate(target.getDate() + 7);
  return target;
}

function isTimeReached(now, preferredTime = "09:00") {
  const target = targetTime(now, preferredTime);
  return now.getTime() >= target.getTime();
}

function targetTime(date, preferredTime = "09:00") {
  const [hour, minute] = String(preferredTime || "09:00").split(":").map(Number);
  const target = new Date(date);
  target.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  return target;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lastAttemptAt(account) {
  const dates = [account.last_captured_at, account.last_scheduled_at]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((value) => value.getTime())));
}
