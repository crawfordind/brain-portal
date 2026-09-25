import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", async () =>
  (await import("../../helpers/db-mock")).createDbClientMock()
);

const mockExtractKnowledge = vi.fn();
vi.mock("@/lib/entities/extractor", () => ({
  extractKnowledge: (...a: unknown[]) => mockExtractKnowledge(...a),
}));

const mockIngest = vi.fn();
vi.mock("@/lib/entities/store", () => ({
  ingestExtractedEntities: (...a: unknown[]) => mockIngest(...a),
}));

const mockLog = vi.fn();
vi.mock("@/lib/crm/interactions", () => ({
  logInteraction: (...a: unknown[]) => mockLog(...a),
}));

import { queryOne } from "@/lib/db/client";
import {
  extractContactsFromSource,
  extractContactsFromText,
} from "@/lib/crm/auto-extract";

const DANA = { name: "Dana Okonkwo", key: "danaokonkwo", type: "person", aliases: [] };
const NORTHWIND = { name: "Northwind Farms", key: "northwind", type: "org", aliases: [] };

describe("extractContactsFromText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIngest.mockResolvedValue({
      result: { entitiesFound: 2, mentionsAdded: 2, edges: 1 },
      entityIdsByKey: new Map([
        ["danaokonkwo", "ent-dana"],
        ["northwind", "ent-nw"],
      ]),
    });
    mockLog.mockResolvedValue({ interaction: {}, deduped: false });
  });

  it("files new contacts and logs a touch against the row each one resolved to", async () => {
    mockExtractKnowledge.mockResolvedValue({
      entities: [DANA, NORTHWIND],
      touches: [
        { name: "Dana Okonkwo", channel: "meeting", direction: "out", summary: "Coffee about samples" },
      ],
    });

    const result = await extractContactsFromText({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      title: "Expo",
      text: "Had coffee with Dana Okonkwo from Northwind Farms.",
      referenceDay: "2026-09-24",
    });

    expect(mockExtractKnowledge).toHaveBeenCalledWith(
      expect.stringContaining("Had coffee with Dana"),
      "2026-09-24"
    );
    expect(mockIngest).toHaveBeenCalledWith(
      { userId: "u1", sourceType: "note", sourceId: "n1", occurredAt: "2026-09-24" },
      [DANA, NORTHWIND]
    );
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog).toHaveBeenCalledWith("u1", {
      entityId: "ent-dana",
      channel: "meeting",
      direction: "out",
      occurredAt: "2026-09-24T12:00:00.000Z",
      subject: "Coffee about samples",
      sourceType: "note",
      sourceId: "n1",
      externalId: "auto:ent-dana:2026-09-24",
      metadata: { extracted: true },
    });
    expect(result).toEqual({
      entitiesFound: 2,
      mentionsAdded: 2,
      touchesFound: 1,
      touchesLogged: 1,
    });
  });

  it("does not count a touch another source already recorded", async () => {
    mockExtractKnowledge.mockResolvedValue({
      entities: [DANA],
      touches: [{ name: "Dana Okonkwo", channel: "meeting" }],
    });
    mockLog.mockResolvedValue({ interaction: {}, deduped: true });

    const result = await extractContactsFromText({
      userId: "u1",
      sourceType: "capture",
      sourceId: "c1",
      text: "Met Dana Okonkwo again",
      referenceDay: "2026-09-24",
    });
    expect(result.touchesFound).toBe(1);
    expect(result.touchesLogged).toBe(0);
  });

  it("names the source in the subject when the model gave no summary", async () => {
    mockExtractKnowledge.mockResolvedValue({
      entities: [DANA],
      touches: [{ name: "Dana Okonkwo", channel: "call" }],
    });

    await extractContactsFromText({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      title: "Friday",
      text: "Called Dana Okonkwo.",
      referenceDay: "2026-09-24",
    });
    expect(mockLog.mock.calls[0][1].subject).toBe('Mentioned in "Friday"');
  });

  it("writes nothing when the text names nobody", async () => {
    mockExtractKnowledge.mockResolvedValue({ entities: [], touches: [] });
    const result = await extractContactsFromText({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Remember to water the plants on the balcony",
      referenceDay: "2026-09-24",
    });
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(result.touchesLogged).toBe(0);
  });

  it("lets a failed model call throw, so the queue retries instead of marking the note read", async () => {
    mockExtractKnowledge.mockRejectedValue(new Error("429 rate limited"));
    await expect(
      extractContactsFromText({
        userId: "u1",
        sourceType: "note",
        sourceId: "n1",
        text: "Met Dana Okonkwo",
        referenceDay: "2026-09-24",
      })
    ).rejects.toThrow(/429/);
  });
});

describe("extractContactsFromSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractKnowledge.mockResolvedValue({ entities: [], touches: [] });
  });

  it("dates a daily note by the day it is about", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      title: "Daily",
      content: "<p>Met Dana Okonkwo</p>",
      content_plain: "Met Dana Okonkwo",
      created_at: "2026-09-25 08:00:00",
      daily_date: "2026-09-24",
    });

    await extractContactsFromSource("u1", "note", "n1");
    expect(mockExtractKnowledge).toHaveBeenCalledWith(
      "Daily\n\nMet Dana Okonkwo",
      "2026-09-24"
    );
  });

  it("dates a capture by the user's own calendar day", async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({
        content: "Met Dana Okonkwo at the expo",
        captured_at: "2026-09-25 04:00:00",
        created_at: "2026-09-25 04:00:00",
      })
      .mockResolvedValueOnce({ timezone: "America/Los_Angeles" });

    await extractContactsFromSource("u1", "capture", "c1");
    expect(mockExtractKnowledge).toHaveBeenCalledWith(
      "Met Dana Okonkwo at the expo",
      "2026-09-24"
    );
  });

  it("returns null for a row deleted while it was queued", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);
    await expect(extractContactsFromSource("u1", "note", "gone")).resolves.toBeNull();
    expect(mockExtractKnowledge).not.toHaveBeenCalled();
  });
});
