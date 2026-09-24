import { describe, it, expect } from "vitest";
import {
  extendDueDate,
  formatDueLabel,
  safeTimeZone,
  todayInTimeZone,
  tomorrowMorning,
  toSqliteDateTime,
  zonedWallTimeToUtc,
} from "@/lib/email/when";

// 2026-09-24 02:30 UTC is still the 23rd in New York.
const LATE_EVENING_NY = new Date("2026-09-24T02:30:00Z");

describe("todayInTimeZone", () => {
  it("answers in the user's zone, not UTC", () => {
    expect(todayInTimeZone(LATE_EVENING_NY, "UTC")).toBe("2026-09-24");
    expect(todayInTimeZone(LATE_EVENING_NY, "America/New_York")).toBe("2026-09-23");
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(todayInTimeZone(LATE_EVENING_NY, "Mars/Olympus")).toBe("2026-09-24");
  });
});

describe("extendDueDate", () => {
  it("moves an overdue date-only task to tomorrow, not to overdue-plus-one", () => {
    expect(extendDueDate("2026-09-01", 1, LATE_EVENING_NY, "America/New_York")).toBe("2026-09-24");
    expect(extendDueDate("2026-09-01", 7, LATE_EVENING_NY, "America/New_York")).toBe("2026-09-30");
  });

  it("pushes a future date-only task from its own date", () => {
    expect(extendDueDate("2026-10-01", 1, LATE_EVENING_NY, "UTC")).toBe("2026-10-02");
  });

  it("keeps timed values timed", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(extendDueDate("2026-09-20T09:00:00.000Z", 1, now, "UTC")).toBe("2026-09-25T12:00:00.000Z");
    expect(extendDueDate("2026-09-30T09:00:00.000Z", 1, now, "UTC")).toBe("2026-10-01T09:00:00.000Z");
  });

  it("handles a missing due date", () => {
    expect(extendDueDate(null, 1, LATE_EVENING_NY, "UTC")).toBe("2026-09-25");
  });
});

describe("zoned wall time", () => {
  it("converts 9am New York (EDT) to 13:00 UTC", () => {
    expect(zonedWallTimeToUtc("2026-09-25", 9, "America/New_York").toISOString()).toBe("2026-09-25T13:00:00.000Z");
  });

  it("respects standard time after the DST change", () => {
    expect(zonedWallTimeToUtc("2026-12-01", 9, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("computes tomorrow morning from the user's today", () => {
    expect(tomorrowMorning(LATE_EVENING_NY, "America/New_York").toISOString()).toBe("2026-09-24T13:00:00.000Z");
  });

  it("formats for SQLite comparisons", () => {
    expect(toSqliteDateTime(new Date("2026-09-24T13:00:00.000Z"))).toBe("2026-09-24 13:00:00");
  });
});

describe("formatDueLabel", () => {
  it("does not shift a date-only value by the viewer's offset", () => {
    expect(formatDueLabel("2026-09-25", "Pacific/Honolulu")).toBe("Fri, Sep 25");
  });
});
