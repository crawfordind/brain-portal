/**
 * The Rolodex row's pure parts.
 *
 * These are the bits of a dense contact list that can be wrong without looking
 * wrong: a letter bucket that quietly swallows accented names, an avatar colour
 * that changes on every render, a status reducer that drops the one signal the
 * user had to act on. Fixed inputs, fixed clocks, no DOM.
 */

import { describe, it, expect } from "vitest";
import {
  AVATAR_TONE_COUNT,
  OTHER_SECTION_LETTER,
  avatarToneFor,
  contactStatuses,
  entityTypeLabel,
  groupContactsByLetter,
  initialsFor,
  lastTouchLabel,
  primaryChannelFor,
  primaryContactStatus,
  sectionLetterFor,
} from "@/lib/crm/contact-list";

describe("sectionLetterFor", () => {
  it("files a name under its first letter, uppercased", () => {
    expect(sectionLetterFor("dana Okonkwo")).toBe("D");
    expect(sectionLetterFor("Northwind Farms")).toBe("N");
  });

  it("folds diacritics so accented names are findable", () => {
    expect(sectionLetterFor("Ángela Ruiz")).toBe("A");
    expect(sectionLetterFor("Øyvind")).toBe(OTHER_SECTION_LETTER);
  });

  it("ignores leading whitespace", () => {
    expect(sectionLetterFor("   Zoe")).toBe("Z");
  });

  it("buckets digits, symbols and empty names under #", () => {
    expect(sectionLetterFor("3M")).toBe(OTHER_SECTION_LETTER);
    expect(sectionLetterFor("+44 7700 900000")).toBe(OTHER_SECTION_LETTER);
    expect(sectionLetterFor("")).toBe(OTHER_SECTION_LETTER);
  });
});

describe("groupContactsByLetter", () => {
  const named = (name: string) => ({ name });
  const byName = (contact: { name: string }) => contact.name;

  it("sorts alphabetically regardless of incoming order", () => {
    const sections = groupContactsByLetter(
      [named("Zoe"), named("Dana"), named("Alice")],
      byName
    );
    expect(sections.map((s) => s.letter)).toEqual(["A", "D", "Z"]);
  });

  it("keeps contacts that share a letter in one section, in order", () => {
    const sections = groupContactsByLetter(
      [named("Dara"), named("Dana"), named("Alice")],
      byName
    );
    expect(sections).toHaveLength(2);
    expect(sections[1]?.letter).toBe("D");
    expect(sections[1]?.contacts.map(byName)).toEqual(["Dana", "Dara"]);
  });

  it("puts the # bucket last, not first", () => {
    const sections = groupContactsByLetter(
      [named("3M"), named("Alice"), named("Zoe")],
      byName
    );
    expect(sections.map((s) => s.letter)).toEqual(["A", "Z", "#"]);
  });

  it("sorts case-insensitively, so casing does not split a letter", () => {
    const sections = groupContactsByLetter(
      [named("apple"), named("Ant"), named("Zoe")],
      byName
    );
    expect(sections[0]?.letter).toBe("A");
    expect(sections[0]?.contacts.map(byName)).toEqual(["Ant", "apple"]);
  });

  it("emits no sections for an empty list", () => {
    expect(groupContactsByLetter([], byName)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [named("Zoe"), named("Alice")];
    groupContactsByLetter(input, byName);
    expect(input.map(byName)).toEqual(["Zoe", "Alice"]);
  });
});

describe("initialsFor", () => {
  it("takes one initial from each end of a name", () => {
    expect(initialsFor("Dana Okonkwo")).toBe("DO");
    expect(initialsFor("Mary Jane Watson")).toBe("MW");
  });

  it("takes a single character from a single word", () => {
    expect(initialsFor("Northwind")).toBe("N");
  });

  it("ignores a legal suffix, which says nothing about which company it is", () => {
    expect(initialsFor("Northwind Farms Ltd")).toBe("NF");
    expect(initialsFor("Field Tech AI GmbH")).toBe("FA");
  });

  it("falls back to the suffix when it is the only word left", () => {
    expect(initialsFor("Ltd")).toBe("L");
  });

  it("folds diacritics and ignores punctuation", () => {
    expect(initialsFor("Ángela Ruiz")).toBe("AR");
    expect(initialsFor("O'Brien & Sons")).toBe("OB");
  });

  it("never returns an empty string", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
    expect(initialsFor("!!!")).toBe("?");
  });

  it("returns at most two characters", () => {
    for (const name of ["Dana Okonkwo", "N", "a b c d e", "3M Company"]) {
      expect(initialsFor(name).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("avatarToneFor", () => {
  it("is stable for the same seed", () => {
    expect(avatarToneFor("ent_123")).toBe(avatarToneFor("ent_123"));
  });

  it("stays inside the palette", () => {
    for (let i = 0; i < 200; i++) {
      const tone = avatarToneFor(`ent_${i}`);
      expect(tone).toBeGreaterThanOrEqual(1);
      expect(tone).toBeLessThanOrEqual(AVATAR_TONE_COUNT);
    }
  });

  it("uses the whole palette rather than collapsing onto one tone", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(avatarToneFor(`ent_${i}`));
    expect(seen.size).toBe(AVATAR_TONE_COUNT);
  });

  it("handles an empty seed without throwing", () => {
    expect(avatarToneFor("")).toBeGreaterThanOrEqual(1);
  });
});

describe("primaryChannelFor", () => {
  const email = { kind: "email", value: "d@example.com", is_primary: 0 };
  const phone = { kind: "phone", value: "+44 7700 900000", is_primary: 0 };
  const url = { kind: "url", value: "https://example.com", is_primary: 0 };

  it("returns null when there is nothing to show", () => {
    expect(primaryChannelFor([])).toBeNull();
  });

  it("prefers the channel flagged primary, whatever its kind", () => {
    expect(
      primaryChannelFor([email, { ...phone, is_primary: 1 }])
    ).toMatchObject({ kind: "phone" });
  });

  it("prefers email over phone when nothing is flagged", () => {
    expect(primaryChannelFor([phone, email])).toMatchObject({ kind: "email" });
  });

  it("prefers phone over anything else", () => {
    expect(primaryChannelFor([url, phone])).toMatchObject({ kind: "phone" });
  });

  it("falls back to the first channel when no kind is preferred", () => {
    expect(primaryChannelFor([url])).toMatchObject({ kind: "url" });
  });
});

describe("lastTouchLabel", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("says nothing when there is no touch", () => {
    expect(lastTouchLabel(null, now)).toBeNull();
    expect(lastTouchLabel(undefined, now)).toBeNull();
    expect(lastTouchLabel("not a date", now)).toBeNull();
  });

  it("reads a zoneless SQLite timestamp as UTC, not as local time", () => {
    // `interactions.occurred_at` comes out of SQLite as "YYYY-MM-DD HH:MM:SS"
    // with no zone marker, and is UTC. Read as local it skews by the viewer's
    // offset, which is enough to file a touch on the wrong day.
    const label = lastTouchLabel("2026-09-11 11:00:00", now);
    expect(label).not.toBeNull();
    expect(label).toBe(lastTouchLabel("2026-09-11T11:00:00Z", now));
  });

  it("counts calendar days, not rolling 24-hour windows", () => {
    expect(lastTouchLabel(isoDaysBefore(now, 1), now)).toBe("yesterday");
    expect(lastTouchLabel(isoDaysBefore(now, 3), now)).toBe("3d");
    expect(lastTouchLabel(isoDaysBefore(now, 6), now)).toBe("6d");
  });

  it("switches units as the gap grows", () => {
    expect(lastTouchLabel(isoDaysBefore(now, 7), now)).toBe("1w");
    expect(lastTouchLabel(isoDaysBefore(now, 29), now)).toBe("4w");
    expect(lastTouchLabel(isoDaysBefore(now, 30), now)).toBe("1mo");
    expect(lastTouchLabel(isoDaysBefore(now, 364), now)).toBe("12mo");
    expect(lastTouchLabel(isoDaysBefore(now, 365), now)).toBe("1y");
    expect(lastTouchLabel(isoDaysBefore(now, 900), now)).toBe("2y");
  });

  it("treats a future timestamp as today rather than a negative age", () => {
    expect(lastTouchLabel("2026-09-19T09:00:00Z", now)).toBe("today");
  });
});

describe("entityTypeLabel", () => {
  it("names the two types the list is mostly made of", () => {
    expect(entityTypeLabel("person")).toBe("Person");
    expect(entityTypeLabel("org")).toBe("Organisation");
  });

  it("capitalises anything else rather than dropping it", () => {
    expect(entityTypeLabel("product")).toBe("Product");
    expect(entityTypeLabel("")).toBe("Contact");
  });
});

describe("contactStatuses", () => {
  const clean = {
    resolution: "confirmed" as const,
    needsReview: false,
    compartments: ["public"],
  };

  it("says nothing about a contact with nothing pending", () => {
    expect(contactStatuses(clean)).toEqual([]);
    expect(primaryContactStatus(clean)).toBeNull();
  });

  it("does not treat the default compartment as a restriction", () => {
    expect(contactStatuses({ ...clean, compartments: [] })).toEqual([]);
    expect(contactStatuses({ ...clean, compartments: ["Public"] })).toEqual([]);
  });

  it("reports a non-public compartment, and names it", () => {
    const [status] = contactStatuses({
      ...clean,
      compartments: ["public", "legal"],
    });
    expect(status?.kind).toBe("restricted");
    expect(status?.detail).toBe("legal");
  });

  it("keeps every signal when a contact is in more than one state", () => {
    const statuses = contactStatuses({
      resolution: "unresolved",
      needsReview: true,
      compartments: ["legal", "hr"],
    });
    expect(statuses.map((s) => s.kind)).toEqual([
      "unresolved",
      "duplicate",
      "restricted",
    ]);
    expect(statuses[2]?.detail).toBe("legal, hr");
  });

  it("leads with the most consequential state", () => {
    expect(
      primaryContactStatus({
        resolution: "unresolved",
        needsReview: true,
        compartments: ["legal"],
      })?.kind
    ).toBe("unresolved");

    expect(
      primaryContactStatus({ ...clean, needsReview: true })?.kind
    ).toBe("duplicate");
  });

  it("gives every status a label, so none renders as a bare icon", () => {
    const statuses = contactStatuses({
      resolution: "unresolved",
      needsReview: true,
      compartments: ["legal"],
    });
    for (const status of statuses) {
      expect(status.label.length).toBeGreaterThan(0);
    }
  });
});

/** `days` local calendar days before `from`, as an ISO string. */
function isoDaysBefore(from: Date, days: number): string {
  const when = new Date(from.getTime());
  when.setDate(when.getDate() - days);
  return when.toISOString();
}
