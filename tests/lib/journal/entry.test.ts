import { describe, it, expect } from "vitest";
import {
  buildEntryAppend,
  categorizeEntry,
  formatEntryTime,
  isCheckConstraintError,
  isValidClientId,
  isValidJournalDate,
  journalDay,
  journalNoteSeed,
  normalizeCategory,
  normalizeTags,
} from "@/lib/journal/entry";

describe("journal entry rules", () => {
  it("accepts only real calendar dates", () => {
    expect(isValidJournalDate("2026-10-22")).toBe(true);
    expect(isValidJournalDate("2024-02-29")).toBe(true);
    expect(isValidJournalDate("2026-02-30")).toBe(false);
    expect(isValidJournalDate("2026-1-5")).toBe(false);
    expect(isValidJournalDate("tomorrow")).toBe(false);
    expect(isValidJournalDate(null)).toBe(false);
  });

  it("maps categories onto the CHECK list", () => {
    expect(normalizeCategory("Health")).toBe("health");
    expect(normalizeCategory("gardening")).toBe("general");
    expect(normalizeCategory(42)).toBe("general");
  });

  it("cleans tags", () => {
    expect(normalizeTags(["Garden", "garden", " ", 3, "x".repeat(60)])).toEqual(["garden", "x".repeat(40)]);
    expect(normalizeTags("garden")).toEqual([]);
  });

  it("checks client ids", () => {
    expect(isValidClientId("0b6b2c1e-5c8a-4a40-9f3c-2d0b8f1a7e11")).toBe(true);
    expect(isValidClientId("short")).toBe(false);
    expect(isValidClientId("has spaces in it")).toBe(false);
  });

  it("finds the day and time in the writer's zone", () => {
    const instant = new Date("2026-10-23T02:30:00Z");
    expect(journalDay(instant, "America/New_York")).toBe("2026-10-22");
    expect(journalDay(instant, "Not/AZone")).toBe("2026-10-23");
    expect(formatEntryTime(instant, "America/New_York")).toBe("10:30 PM");
    expect(formatEntryTime(instant, null)).toBe("2:30 AM");
  });

  it("titles the day's note without a timezone shift", () => {
    expect(journalNoteSeed("2026-10-22")).toMatchObject({
      slug: "journal-2026-10-22",
      title: "Journal - Thursday, October 22, 2026",
    });
  });

  it("builds both dialects of the append, escaping HTML", () => {
    const a = buildEntryAppend("a <b>\n\nsecond\nline", "9:00 AM");
    expect(a.markdown).toBe("\n### 9:00 AM\na <b>\n\nsecond\nline\n");
    expect(a.html).toBe("<h3>9:00 AM</h3><p>a &lt;b&gt;</p><p>second<br>line</p>");
  });

  it("recognises a CHECK failure", () => {
    expect(isCheckConstraintError(new Error("SQLITE_CONSTRAINT: CHECK constraint failed: note_type IN (...)"))).toBe(true);
    expect(isCheckConstraintError(new Error("UNIQUE constraint failed: notes.user_id, notes.slug"))).toBe(false);
  });

  it("categorizes by rule", () => {
    expect(categorizeEntry("Today I planted garlic, feeling happy")).toMatchObject({
      category: "maintenance",
      mood: "good",
    });
    expect(categorizeEntry("today i went to the market").title).toBe("Went to the market");
  });
});
