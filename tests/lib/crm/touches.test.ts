import { describe, it, expect } from "vitest";
import {
  autoTouchExternalId,
  isValidDay,
  localDay,
  normalizeTouches,
  shouldExtractContacts,
  touchOccurredAt,
  type TouchCandidateEntity,
} from "@/lib/crm/touches";
import { buildInteractionDedupKey } from "@/lib/crm/dedup";

const entities: TouchCandidateEntity[] = [
  { key: "danaokonkwo", name: "Dana Okonkwo", type: "person" },
  { key: "northwind", name: "Northwind Farms", type: "org" },
  { key: "portland", name: "Portland", type: "place" },
];

const REF = "2026-09-24";

describe("normalizeTouches", () => {
  it("keeps a touch with a known person and fills in the source's day", () => {
    const out = normalizeTouches(
      [{ name: "Dana Okonkwo", channel: "meeting", direction: "out", summary: "Coffee about the bulk order" }],
      { entities, referenceDay: REF }
    );
    expect(out).toEqual([
      {
        key: "danaokonkwo",
        channel: "meeting",
        direction: "out",
        day: REF,
        summary: "Coffee about the bulk order",
      },
    ]);
  });

  it("matches a name variant onto the extracted entity's key", () => {
    // "Northwind" and "Northwind Farms" normalize to one key.
    const out = normalizeTouches([{ name: "Northwind", channel: "call" }], {
      entities,
      referenceDay: REF,
    });
    expect(out.map((t) => t.key)).toEqual(["northwind"]);
  });

  it("drops a touch with a place: only people and organizations are contacts", () => {
    expect(
      normalizeTouches([{ name: "Portland", channel: "event" }], { entities, referenceDay: REF })
    ).toEqual([]);
  });

  it("drops a name the extractor did not also return as an entity", () => {
    expect(
      normalizeTouches([{ name: "Someone Else", channel: "call" }], { entities, referenceDay: REF })
    ).toEqual([]);
  });

  it("drops a future-dated touch, which is a plan rather than something that happened", () => {
    expect(
      normalizeTouches([{ name: "Dana Okonkwo", date: "2026-09-29" }], { entities, referenceDay: REF })
    ).toEqual([]);
  });

  it("keeps a past date the model resolved from 'yesterday'", () => {
    const [t] = normalizeTouches([{ name: "Dana Okonkwo", date: "2026-09-23" }], {
      entities,
      referenceDay: REF,
    });
    expect(t.day).toBe("2026-09-23");
  });

  it("falls back to the source's day for an impossible or malformed date", () => {
    const out = normalizeTouches(
      [
        { name: "Dana Okonkwo", date: "2026-02-30" },
        { name: "Northwind Farms", date: "last Tuesday" },
      ],
      { entities, referenceDay: REF }
    );
    expect(out.map((t) => t.day)).toEqual([REF, REF]);
  });

  it("records one touch per contact per source", () => {
    const out = normalizeTouches(
      [
        { name: "Dana Okonkwo", channel: "meeting" },
        { name: "Dana", channel: "email" },
        { name: "dana okonkwo", channel: "call" },
      ],
      { entities, referenceDay: REF }
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("meeting");
  });

  it("coerces unknown channels to 'other' and never emits the hand-logged 'note' channel", () => {
    const out = normalizeTouches(
      [
        { name: "Dana Okonkwo", channel: "carrier pigeon" },
        { name: "Northwind Farms", channel: "note" },
      ],
      { entities, referenceDay: REF }
    );
    expect(out.map((t) => t.channel)).toEqual(["other", "other"]);
  });

  it("treats anything but an explicit 'in' as outbound", () => {
    const out = normalizeTouches(
      [
        { name: "Dana Okonkwo", direction: "in" },
        { name: "Northwind Farms", direction: "sideways" },
      ],
      { entities, referenceDay: REF }
    );
    expect(out.map((t) => t.direction)).toEqual(["in", "out"]);
  });

  it("caps summary length and blanks an empty one", () => {
    const out = normalizeTouches(
      [
        { name: "Dana Okonkwo", summary: "x".repeat(400) },
        { name: "Northwind Farms", summary: "   " },
      ],
      { entities, referenceDay: REF }
    );
    expect(out[0].summary!.length).toBeLessThanOrEqual(140);
    expect(out[1].summary).toBeNull();
  });

  it("tolerates garbage from the model", () => {
    expect(normalizeTouches(null, { entities, referenceDay: REF })).toEqual([]);
    expect(normalizeTouches("touches", { entities, referenceDay: REF })).toEqual([]);
    expect(
      normalizeTouches([null, 3, { name: 42 }], { entities, referenceDay: REF })
    ).toEqual([]);
  });

  it("respects the per-source cap", () => {
    const many: TouchCandidateEntity[] = Array.from({ length: 20 }, (_, i) => ({
      key: `person${String.fromCharCode(97 + i)}x`,
      name: `Person ${String.fromCharCode(65 + i)}x`,
      type: "person",
    }));
    const out = normalizeTouches(
      many.map((e) => ({ name: e.name })),
      { entities: many, referenceDay: REF, max: 5 }
    );
    expect(out).toHaveLength(5);
  });
});

describe("auto touch dedup key", () => {
  it("collapses one meeting described by several sources into one key, whatever the summary", () => {
    const a = buildInteractionDedupKey({
      channel: "meeting",
      occurredAt: touchOccurredAt("2026-09-24"),
      entityId: "ent-1",
      subject: "Coffee with Dana",
      externalId: autoTouchExternalId("ent-1", "2026-09-24"),
    });
    const b = buildInteractionDedupKey({
      channel: "meeting",
      occurredAt: touchOccurredAt("2026-09-24"),
      entityId: "ent-1",
      subject: "Discussed the bulk order",
      externalId: autoTouchExternalId("ent-1", "2026-09-24"),
    });
    expect(a).toBe(b);
  });

  it("keeps a call and a meeting on the same day apart", () => {
    const ext = autoTouchExternalId("ent-1", "2026-09-24");
    const meeting = buildInteractionDedupKey({ channel: "meeting", occurredAt: "", externalId: ext });
    const call = buildInteractionDedupKey({ channel: "call", occurredAt: "", externalId: ext });
    expect(meeting).not.toBe(call);
  });

  it("stores the touch at midday UTC on its day", () => {
    expect(touchOccurredAt("2026-09-24")).toBe("2026-09-24T12:00:00.000Z");
  });
});

describe("isValidDay", () => {
  it("accepts real days and rejects impossible or malformed ones", () => {
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2026-02-29")).toBe(false);
    expect(isValidDay("2026-9-4")).toBe(false);
    expect(isValidDay("yesterday")).toBe(false);
  });
});

describe("localDay", () => {
  it("uses the user's zone, so an evening note is not filed under tomorrow", () => {
    // 9pm on the 24th in Los Angeles is already the 25th in UTC.
    const instant = new Date("2026-09-25T04:00:00Z");
    expect(localDay(instant, "America/Los_Angeles")).toBe("2026-09-24");
    expect(localDay(instant, null)).toBe("2026-09-25");
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(localDay(new Date("2026-09-25T04:00:00Z"), "Mars/Olympus_Mons")).toBe("2026-09-25");
  });
});

describe("shouldExtractContacts", () => {
  it("reads what the user wrote, however it arrived", () => {
    expect(shouldExtractContacts({ entityType: "note", noteType: "note", sourceActor: null })).toBe(true);
    expect(shouldExtractContacts({ entityType: "note", noteType: "daily", sourceActor: "human" })).toBe(true);
    expect(shouldExtractContacts({ entityType: "note", noteType: "journal", sourceActor: "mcp_key" })).toBe(true);
    expect(shouldExtractContacts({ entityType: "capture", captureType: "thought", sourceActor: "import" })).toBe(true);
  });

  it("skips agent and skill output, which names people the user never spoke to", () => {
    expect(shouldExtractContacts({ entityType: "note", noteType: "note", sourceActor: "agent" })).toBe(false);
    expect(shouldExtractContacts({ entityType: "capture", captureType: "thought", sourceActor: "skill" })).toBe(false);
  });

  it("skips notes the app generated about other notes, which would double-count their touches", () => {
    for (const noteType of ["weekly", "insight", "monthly_journal"]) {
      expect(shouldExtractContacts({ entityType: "note", noteType })).toBe(false);
    }
  });

  it("skips link captures, whose text is a URL", () => {
    expect(shouldExtractContacts({ entityType: "capture", captureType: "link" })).toBe(false);
  });
});
