import { describe, it, expect } from "vitest";
import { buildInteractionDedupKey, toDayBucket } from "@/lib/crm/dedup";

describe("buildInteractionDedupKey - externalId precedence", () => {
  it("uses the external id alone when present", () => {
    const key = buildInteractionDedupKey({
      channel: "email",
      occurredAt: "2026-09-13T14:00:00Z",
      entityId: "e1",
      subject: "Q2 order",
      externalId: "<CAF=abc123@mail.gmail.com>",
    });
    expect(key).toBe("email:<caf=abc123@mail.gmail.com>");
  });

  it("ignores subject and time changes once an external id is present", () => {
    const base = {
      channel: "email",
      externalId: "<msg-1@example.com>",
    };
    expect(
      buildInteractionDedupKey({
        ...base,
        occurredAt: "2026-09-13T14:00:00Z",
        subject: "Original",
      })
    ).toBe(
      buildInteractionDedupKey({
        ...base,
        occurredAt: "2026-09-14T09:30:00Z",
        subject: "Re: Original",
      })
    );
  });

  it("treats a blank external id as absent", () => {
    const withBlank = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T14:00:00Z",
      entityId: "e1",
      subject: "check in",
      externalId: "   ",
    });
    const without = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T14:00:00Z",
      entityId: "e1",
      subject: "check in",
    });
    expect(withBlank).toBe(without);
  });
});

describe("buildInteractionDedupKey - day bucketing", () => {
  it("collapses the four duplicate Dana Okonkwo captures into one key", () => {
    // The real failure: one meeting, captured four times minutes apart.
    const times = [
      "2026-09-13T09:02:11Z",
      "2026-09-13T09:04:48Z",
      "2026-09-13T09:11:03Z",
      "2026-09-13T17:45:00Z",
    ];
    const keys = new Set(
      times.map((occurredAt) =>
        buildInteractionDedupKey({
          channel: "meeting",
          occurredAt,
          entityId: "dana",
          subject: "Meeting with Dana Okonkwo",
        })
      )
    );
    expect(keys.size).toBe(1);
  });

  it("still admits two different conversations on the same day", () => {
    const a = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
      subject: "Q2 pricing",
    });
    const b = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T16:00:00Z",
      entityId: "dana",
      subject: "Farm Show logistics",
    });
    expect(a).not.toBe(b);
  });

  it("separates the same subject on different days", () => {
    const a = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
      subject: "weekly check in",
    });
    const b = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-20T09:00:00Z",
      entityId: "dana",
      subject: "weekly check in",
    });
    expect(a).not.toBe(b);
  });

  it("separates the same subject across different entities", () => {
    const a = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
      subject: "intro",
    });
    const b = buildInteractionDedupKey({
      channel: "call",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "will",
      subject: "intro",
    });
    expect(a).not.toBe(b);
  });

  it("separates the same conversation across different channels", () => {
    const shared = {
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
      subject: "intro",
    };
    expect(
      buildInteractionDedupKey({ ...shared, channel: "call" })
    ).not.toBe(buildInteractionDedupKey({ ...shared, channel: "email" }));
  });
});

describe("buildInteractionDedupKey - normalization and degradation", () => {
  it("is stable across subject punctuation and case noise", () => {
    const shared = {
      channel: "email",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
    };
    const a = buildInteractionDedupKey({ ...shared, subject: "Q2 Order!!" });
    const b = buildInteractionDedupKey({ ...shared, subject: "  q2   order  " });
    expect(a).toBe(b);
  });

  it("falls back to placeholders rather than dropping the interaction", () => {
    const key = buildInteractionDedupKey({
      channel: "",
      occurredAt: "",
      subject: "",
    });
    expect(key).toBe("other:unknown:undated:untitled");
  });

  it("is idempotent for identical input", () => {
    const input = {
      channel: "meeting",
      occurredAt: "2026-09-13T09:00:00Z",
      entityId: "dana",
      subject: "Meeting with Dana Okonkwo",
    };
    expect(buildInteractionDedupKey(input)).toBe(
      buildInteractionDedupKey({ ...input })
    );
  });
});

describe("toDayBucket", () => {
  it("takes the date portion of an ISO timestamp", () => {
    expect(toDayBucket("2026-09-13T23:59:59Z")).toBe("2026-09-13");
  });

  it("parses a non-ISO date string", () => {
    expect(toDayBucket("September 13, 2026 09:00:00 UTC")).toBe("2026-09-13");
  });

  it("degrades to 'undated' rather than throwing", () => {
    expect(toDayBucket("not a date")).toBe("undated");
    expect(toDayBucket("")).toBe("undated");
  });
});
