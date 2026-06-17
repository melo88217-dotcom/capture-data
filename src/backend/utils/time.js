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

  const last = account.last_captured_at ? new Date(account.last_captured_at) : null;
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

function isDailyDue(last, now, preferredTime) {
  if (!isTimeReached(now, preferredTime)) return false;
  if (!last) return true;
  return localDateKey(last) !== localDateKey(now);
}

function isTimeReached(now, preferredTime = "09:00") {
  const [hour, minute] = String(preferredTime || "09:00").split(":").map(Number);
  const target = new Date(now);
  target.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0);
  return now.getTime() >= target.getTime();
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
