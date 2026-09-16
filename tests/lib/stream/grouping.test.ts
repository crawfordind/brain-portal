import { describe, it, expect } from "vitest";
import {
  bucketFor,
  groupStream,
  parseDbTimestamp,
  shortTimeLabel,
  BUCKET_ORDER,
} from "@/lib/stream/grouping";

/** Fixed clock: a Tuesday afternoon, local time. */
const NOW = new Date(2026, 8, 15, 14, 0, 0); // 15 Sep 2026, 14:00 local

const at = (date: Date) => ({ updatedAt: date.toISOString() });
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("parseDbTimestamp", () => {
  it("reads SQLite's zoneless datetime('now') as UTC, not local", () => {
    // This is the bug: `new Date("2026-09-15 12:00:00")` is local time in V8,
    // so east of Greenwich the row appeared to be from the future.
    const parsed = parseDbTimestamp("2026-09-15 12:00:00");

    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("leaves an explicit Z alone", () => {
    expect(parseDbTimestamp("2026-09-15T12:00:00Z")!.toISOString()).toBe(
      "2026-09-15T12:00:00.000Z"
    );
  });

  it("leaves an explicit numeric offset alone", () => {
    expect(parseDbTimestamp("2026-09-15T12:00:00+02:00")!.toISOString()).toBe(
      "2026-09-15T10:00:00.000Z"
    );
  });

  it("returns null for absent or unparseable input rather than Invalid Date", () => {
    expect(parseDbTimestamp(null)).toBeNull();
    expect(parseDbTimestamp(undefined)).toBeNull();
    expect(parseDbTimestamp("")).toBeNull();
    expect(parseDbTimestamp("   ")).toBeNull();
    expect(parseDbTimestamp("not a date")).toBeNull();
  });
});

describe("bucketFor", () => {
  it("puts the last hour in 'now'", () => {
    expect(bucketFor(minutesAgo(2), NOW)).toBe("now");
    expect(bucketFor(minutesAgo(59), NOW)).toBe("now");
  });

  it("puts anything older than an hour but still today in 'today'", () => {
    expect(bucketFor(minutesAgo(61), NOW)).toBe("today");
    expect(bucketFor(hoursAgo(13), NOW)).toBe("today"); // 01:00 same day
  });

  it("uses calendar days rather than a rolling 24 hours", () => {
    // 14 hours before NOW. A 24-hour window would still call this "today";
    // the calendar says otherwise, and so do people.
    const lateLastNight = new Date(2026, 8, 14, 23, 50, 0);
    expect(bucketFor(lateLastNight, NOW)).toBe("yesterday");

    // The following morning it is still yesterday, not "this week".
    const nextMorning = new Date(2026, 8, 15, 9, 0, 0);
    expect(bucketFor(lateLastNight, nextMorning)).toBe("yesterday");
  });

  it("lets recency win over the calendar across midnight", () => {
    // Written at 23:50, read at 00:10 — twenty minutes is twenty minutes, and
    // labelling it "Yesterday" would be technically true and useless.
    const lateLastNight = new Date(2026, 8, 14, 23, 50, 0);
    const justAfterMidnight = new Date(2026, 8, 15, 0, 10, 0);

    expect(bucketFor(lateLastNight, justAfterMidnight)).toBe("now");
  });

  it("covers the seven days behind today with 'week'", () => {
    expect(bucketFor(daysAgo(3), NOW)).toBe("week");
    expect(bucketFor(daysAgo(7), NOW)).toBe("week");
  });

  it("drops everything older into 'earlier'", () => {
    expect(bucketFor(daysAgo(30), NOW)).toBe("earlier");
    expect(bucketFor(new Date(2020, 0, 1), NOW)).toBe("earlier");
  });

  it("treats a future timestamp as 'now' rather than 'earlier'", () => {
    // Clock skew between the app server and the database must not file a row
    // under "Earlier" at the bottom of the feed.
    const skewed = new Date(NOW.getTime() + 5 * 60_000);
    expect(bucketFor(skewed, NOW)).toBe("now");
  });
});

describe("shortTimeLabel", () => {
  it("says 'now' inside the first minute, and for a skewed future stamp", () => {
    expect(shortTimeLabel(minutesAgo(0), NOW)).toBe("now");
    expect(shortTimeLabel(new Date(NOW.getTime() + 30_000), NOW)).toBe("now");
  });

  it("counts minutes for the first hour", () => {
    expect(shortTimeLabel(minutesAgo(1), NOW)).toBe("1m");
    expect(shortTimeLabel(minutesAgo(45), NOW)).toBe("45m");
    expect(shortTimeLabel(minutesAgo(59), NOW)).toBe("59m");
  });

  it("switches to a clock time for today and yesterday", () => {
    expect(shortTimeLabel(new Date(2026, 8, 15, 10, 4, 0), NOW)).toBe("10:04");
    expect(shortTimeLabel(new Date(2026, 8, 14, 9, 30, 0), NOW)).toBe("09:30");
  });

  it("switches to a date once the day heading stops disambiguating", () => {
    // Locale formatting varies by environment, so assert the shape, not the
    // exact punctuation.
    const label = shortTimeLabel(new Date(2026, 8, 2, 12, 0, 0), NOW);
    expect(label).not.toMatch(/^\d{2}:\d{2}$/);
    expect(label).toMatch(/2/);
  });

  it("includes the year only when it differs from the current one", () => {
    const thisYear = shortTimeLabel(new Date(2026, 0, 5, 12, 0, 0), NOW);
    const lastYear = shortTimeLabel(new Date(2024, 0, 5, 12, 0, 0), NOW);

    expect(thisYear).not.toMatch(/2026/);
    expect(lastYear).toMatch(/2024/);
  });
});

describe("groupStream", () => {
  it("emits groups newest-first and drops empty buckets", () => {
    const result = groupStream(
      [at(minutesAgo(5)), at(hoursAgo(6)), at(daysAgo(30))],
      { now: NOW }
    );

    expect(result.groups.map((g) => g.key)).toEqual(["now", "today", "earlier"]);
    expect(result.groups.map((g) => g.label)).toEqual([
      "Now",
      "Earlier today",
      "Earlier",
    ]);
  });

  it("preserves input order within a bucket", () => {
    const first = { updatedAt: minutesAgo(5).toISOString(), id: "a" };
    const second = { updatedAt: minutesAgo(20).toISOString(), id: "b" };

    const result = groupStream([first, second], { now: NOW });

    expect(result.groups[0].entries.map((e) => e.item.id)).toEqual(["a", "b"]);
  });

  it("never emits a bucket outside the known order", () => {
    const result = groupStream(
      BUCKET_ORDER.map(() => at(minutesAgo(5))),
      { now: NOW }
    );

    for (const group of result.groups) {
      expect(BUCKET_ORDER).toContain(group.key);
    }
  });

  it("keeps a row with an unparseable timestamp instead of dropping it", () => {
    const result = groupStream([{ updatedAt: "nonsense", id: "x" }], {
      now: NOW,
    });

    const all = result.groups.flatMap((g) => g.entries.map((e) => e.item.id));
    expect(all).toEqual(["x"]);
    expect(result.groups[0].key).toBe("earlier");
  });

  it("marks entries newer than the last visit", () => {
    const lastVisitAt = hoursAgo(3);

    const result = groupStream([at(minutesAgo(5)), at(hoursAgo(10))], {
      now: NOW,
      lastVisitAt,
    });

    expect(result.newCount).toBe(1);
    expect(result.groups[0].entries[0].isNew).toBe(true);
    expect(result.groups[1].entries[0].isNew).toBe(false);
  });

  it("draws no divider on a first visit — nothing to divide from", () => {
    const result = groupStream([at(minutesAgo(5)), at(hoursAgo(10))], {
      now: NOW,
      lastVisitAt: null,
    });

    expect(result.newCount).toBe(0);
    expect(result.showDivider).toBe(false);
  });

  it("draws no divider when everything is new", () => {
    const result = groupStream([at(minutesAgo(5)), at(minutesAgo(9))], {
      now: NOW,
      lastVisitAt: hoursAgo(3),
    });

    expect(result.newCount).toBe(2);
    expect(result.showDivider).toBe(false);
  });

  it("draws no divider when nothing is new", () => {
    const result = groupStream([at(daysAgo(4)), at(daysAgo(5))], {
      now: NOW,
      lastVisitAt: hoursAgo(1),
    });

    expect(result.newCount).toBe(0);
    expect(result.showDivider).toBe(false);
  });

  it("draws the divider only when new and old both exist", () => {
    const result = groupStream([at(minutesAgo(5)), at(daysAgo(4))], {
      now: NOW,
      lastVisitAt: hoursAgo(3),
    });

    expect(result.showDivider).toBe(true);
  });

  it("handles an empty feed", () => {
    const result = groupStream([], { now: NOW });

    expect(result.groups).toEqual([]);
    expect(result.newCount).toBe(0);
    expect(result.showDivider).toBe(false);
  });
});
