/**
 * Time buckets for the stream, and the "since you were last here" boundary.
 *
 * One flat list sorted by `updated_at` is the weakest available ranking for a
 * second brain: it renders a thought from three minutes ago and a note from
 * March identically, so the only way to tell them apart is to read the relative
 * timestamp on every row. Sticky bucket headings do that work once per group
 * instead of once per row, which is the cheapest scannability win available.
 *
 * Pure, so it can be unit-tested against fixed clocks rather than whatever
 * today happens to be. See docs/plans/2026-09-14-stream-dashboard-v2-design.md,
 * R22.
 */

export type StreamBucketKey = "now" | "today" | "yesterday" | "week" | "earlier";

export const BUCKET_LABELS: Record<StreamBucketKey, string> = {
  now: "Now",
  today: "Earlier today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

/** Bucket order, newest first — also the order groups are emitted in. */
export const BUCKET_ORDER: readonly StreamBucketKey[] = [
  "now",
  "today",
  "yesterday",
  "week",
  "earlier",
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Parse a timestamp as it actually comes out of this database.
 *
 * SQLite's `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` with no zone marker,
 * and it is UTC by definition. `new Date()` reads that shape as **local time**,
 * so every such timestamp was being skewed by the viewer's UTC offset — enough
 * to put a row in the wrong bucket, and enough for "5 hours ago" to read as
 * "in 3 hours" east of Greenwich. `CrmPulseCard` already normalises this; the
 * stream card did not.
 *
 * Values that already carry a `Z` or a `±HH:MM` offset are left alone, so rows
 * written from JS as ISO strings parse correctly too.
 *
 * Returns null rather than an Invalid Date, so callers have one thing to check.
 */
export function parseDbTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.replace(" ", "T")}Z`;

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Which bucket a timestamp belongs to, relative to `now`.
 *
 * "Today" and "yesterday" are calendar comparisons in the viewer's own
 * timezone, not 24-hour windows: something written at 23:50 is "yesterday" at
 * 00:10, which is how people actually talk about it.
 *
 * A timestamp in the future — clock skew, or a row stamped by a server slightly
 * ahead — is treated as `now` rather than falling through to `earlier`.
 */
export function bucketFor(when: Date, now: Date): StreamBucketKey {
  const age = now.getTime() - when.getTime();

  if (age < HOUR_MS) return "now";

  const startOfToday = startOfDay(now);
  if (when.getTime() >= startOfToday.getTime()) return "today";

  const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);
  if (when.getTime() >= startOfYesterday.getTime()) return "yesterday";

  // "This week" is the seven days behind today's start, so the label never
  // covers a span that includes today or yesterday.
  if (when.getTime() >= startOfToday.getTime() - 7 * DAY_MS) return "week";

  return "earlier";
}

function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * A timestamp short enough to sit at the end of a 40px row.
 *
 * Bucket headings already carry the day, so the row only has to disambiguate
 * *within* the day: minutes while that is still the interesting unit, then a
 * clock time, then a date once the year's calendar is the frame. The long
 * "about 4 hours ago" phrasing stays on the comfortable card, where there is
 * room for it.
 */
export function shortTimeLabel(when: Date, now: Date): string {
  const age = now.getTime() - when.getTime();

  // Clock skew reads as "now" rather than a negative age.
  if (age < 60_000) return "now";
  if (age < HOUR_MS) return `${Math.floor(age / 60_000)}m`;

  const startOfToday = startOfDay(now);
  const startOfYesterday = new Date(startOfToday.getTime() - DAY_MS);

  if (when.getTime() >= startOfYesterday.getTime()) {
    return `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  }

  const sameYear = when.getFullYear() === now.getFullYear();
  return when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export interface GroupedEntry<T> {
  item: T;
  /** Changed since the viewer's previous visit. */
  isNew: boolean;
}

export interface StreamGroup<T> {
  key: StreamBucketKey;
  label: string;
  entries: GroupedEntry<T>[];
}

export interface GroupedStream<T> {
  groups: StreamGroup<T>[];
  /** How many entries are newer than `lastVisitAt`. */
  newCount: number;
  /**
   * Whether a "since you were last here" divider is worth drawing: there has to
   * be something new *and* something old, or the line separates nothing. A
   * first-ever visit has no previous visit and therefore no divider.
   */
  showDivider: boolean;
}

export interface GroupOptions {
  now: Date;
  /** The previous visit, or null on a first visit. */
  lastVisitAt?: Date | null;
}

/**
 * Bucket a feed into time groups, newest first.
 *
 * Input is assumed sorted newest-first — that is what `/api/stream` returns —
 * and order within a bucket is preserved. Empty buckets are dropped rather than
 * rendered as a heading over nothing. Rows whose timestamp will not parse are
 * kept in `earlier` instead of vanishing, because silently dropping a row the
 * user wrote is worse than filing it badly.
 */
export function groupStream<T extends { updatedAt: string }>(
  items: T[],
  { now, lastVisitAt = null }: GroupOptions
): GroupedStream<T> {
  const byBucket = new Map<StreamBucketKey, GroupedEntry<T>[]>();
  let newCount = 0;

  for (const item of items) {
    const when = parseDbTimestamp(item.updatedAt);
    const key = when ? bucketFor(when, now) : "earlier";

    const isNew =
      !!lastVisitAt && !!when && when.getTime() > lastVisitAt.getTime();
    if (isNew) newCount += 1;

    const entries = byBucket.get(key);
    if (entries) entries.push({ item, isNew });
    else byBucket.set(key, [{ item, isNew }]);
  }

  const groups: StreamGroup<T>[] = [];
  for (const key of BUCKET_ORDER) {
    const entries = byBucket.get(key);
    if (entries?.length) {
      groups.push({ key, label: BUCKET_LABELS[key], entries });
    }
  }

  return {
    groups,
    newCount,
    showDivider: newCount > 0 && newCount < items.length,
  };
}
