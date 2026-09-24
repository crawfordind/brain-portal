/**
 * Date arithmetic for email quick actions ("Tomorrow", "Snooze 1h").
 *
 * Pure and dependency-free so it can be unit-tested with a fixed clock. All
 * "today" / "tomorrow at 9" questions are asked in the user's own timezone
 * (`notification_preferences.timezone`); an unknown zone falls back to UTC
 * rather than throwing inside an email send.
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function isDateOnly(value: string | null | undefined): boolean {
  return !!value && DATE_ONLY_RE.test(value.trim());
}

/** `YYYY-MM-DD` for `now` as seen from `tz`. */
export function todayInTimeZone(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(tz),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Hour (0-23) of `now` in `tz`. */
export function hourInTimeZone(now: Date, tz: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(tz),
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour) % 24;
}

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. -240 for EDT). */
function offsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(tz),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The instant at which the wall clock in `tz` reads `date` `hour`:00. */
export function zonedWallTimeToUtc(date: string, hour: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  // Two passes settle the answer across a DST boundary.
  let result = guess - offsetMinutes(new Date(guess), tz) * 60000;
  result = guess - offsetMinutes(new Date(result), tz) * 60000;
  return new Date(result);
}

/** SQLite's `datetime('now')` shape: `YYYY-MM-DD HH:MM:SS`, UTC. */
export function toSqliteDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Push a due date out by `days`, never landing in the past.
 *
 * - Date-only values stay date-only (the task panel only ever writes those),
 *   measured from the later of the current due date and the user's today. So
 *   "+1 day" on something overdue since last week means *tomorrow*, not
 *   "six days ago".
 * - Timed values move by whole days from the later of the due time and now.
 */
export function extendDueDate(
  current: string | null | undefined,
  days: number,
  now: Date,
  tz: string
): string {
  const today = todayInTimeZone(now, tz);

  if (!current || isDateOnly(current)) {
    const base = current && current.trim() > today ? current.trim() : today;
    return addDaysToDate(base, days);
  }

  const parsed = new Date(current.includes("T") || current.endsWith("Z") ? current : `${current.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) {
    return addDaysToDate(today, days);
  }
  const base = Math.max(parsed.getTime(), now.getTime());
  return new Date(base + days * 86_400_000).toISOString();
}

/** "Tomorrow at 9am" in the user's zone, as a UTC instant. */
export function tomorrowMorning(now: Date, tz: string, hour: number = 9): Date {
  return zonedWallTimeToUtc(addDaysToDate(todayInTimeZone(now, tz), 1), hour, tz);
}

/** Human label for a due date, e.g. "Fri, Sep 25". */
export function formatDueLabel(value: string | null | undefined, tz: string): string {
  if (!value) return "no date";
  if (isDateOnly(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(tz),
  });
}
