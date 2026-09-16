import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryOne = vi.fn();
const mockMutate = vi.fn();
const mockDbExecute = vi.fn();
const mockQuery = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: { execute: (...a: unknown[]) => mockDbExecute(...a) },
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  mutate: (...a: unknown[]) => mockMutate(...a),
}));

const mockExtract = vi.fn();
vi.mock("@/lib/entities/extractor", () => ({
  extractEntities: (...a: unknown[]) => mockExtract(...a),
}));

import { ingestSourceEntities } from "@/lib/entities/store";

function sqlOf(call: unknown[]): string {
  const arg = call[0] as { sql: string };
  return arg.sql;
}

describe("ingestSourceEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]); // no verified contact channels by default
  });

  it("creates new entities, records mentions, and builds co-occurrence edges", async () => {
    mockExtract.mockResolvedValue([
      { name: "Northwind Farms", key: "northwind", type: "org", aliases: ["Northwind"] },
      { name: "William", key: "william", type: "person", aliases: [] },
    ]);
    // No existing entity for either key (entities lookup, then alias lookup).
    mockQueryOne.mockResolvedValue(null);
    // Each INSERT ... RETURNING id
    mockMutate
      .mockResolvedValueOnce({ id: "ent-hep" })
      .mockResolvedValueOnce({ id: "ent-will" });
    // recordMention INSERT OR IGNORE → newly inserted; other executes ok
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });

    const result = await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      title: "Meeting",
      text: "Met William at Northwind Farms.",
      occurredAt: "2026-01-04",
    });

    expect(result.entitiesFound).toBe(2);
    expect(result.mentionsAdded).toBe(2);
    // Two entities → exactly one unordered pair → one edge upsert.
    expect(result.edges).toBe(1);

    const edgeInsert = mockDbExecute.mock.calls.find((c) =>
      sqlOf(c).includes("INSERT INTO entity_edges")
    );
    expect(edgeInsert).toBeTruthy();
    expect(sqlOf(edgeInsert!)).toContain("ON CONFLICT");
  });

  it("is idempotent: re-ingesting the same source adds no new mentions", async () => {
    mockExtract.mockResolvedValue([
      { name: "Northwind Farms", key: "northwind", type: "org", aliases: [] },
    ]);
    // Entity already exists (found by normalized_key on first queryOne).
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-hep" }) // findEntityIdByKey: direct hit
      .mockResolvedValueOnce({
        canonical_name: "Northwind Farms",
        entity_type: "org",
        metadata: "{}",
      }); // current row
    // recordMention returns rowsAffected 0 (mention already exists); UPDATE also 0.
    mockDbExecute.mockResolvedValue({ rowsAffected: 0 });

    const result = await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Northwind Farms again.",
      occurredAt: "2026-01-04",
    });

    expect(result.entitiesFound).toBe(1);
    expect(result.mentionsAdded).toBe(0);
    // No mention_count bump should have been issued.
    const countBump = mockDbExecute.mock.calls.find((c) =>
      sqlOf(c).includes("mention_count = mention_count + 1")
    );
    expect(countBump).toBeFalsy();
  });

  it("returns zero when nothing is extracted", async () => {
    mockExtract.mockResolvedValue([]);
    const result = await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "nothing here",
    });
    expect(result).toEqual({ entitiesFound: 0, mentionsAdded: 0, edges: 0 });
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe("ingestSourceEntities - merge gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
  });

  it("merges an exact match, preserving previous behavior", async () => {
    mockExtract.mockResolvedValue([
      { name: "northwind farms", key: "northwind", type: "org", aliases: [] },
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-hep" })
      .mockResolvedValueOnce({
        canonical_name: "Northwind Farms",
        entity_type: "org",
        metadata: "{}",
      });
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });

    await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "northwind farms",
    });

    // No new entity row: it resolved onto the existing one.
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("flags rather than merges a suffix-manufactured collision", async () => {
    mockExtract.mockResolvedValue([
      { name: "Northwind Holdings", key: "northwind", type: "org", aliases: [] },
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-hep" })
      .mockResolvedValueOnce({
        canonical_name: "Northwind Farms",
        entity_type: "org",
        metadata: "{}",
      });
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });
    mockMutate.mockResolvedValue({ id: "ent-holdings" });

    await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Northwind Holdings",
    });

    // A separate row was created rather than fusing into Northwind Farms.
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const args = mockMutate.mock.calls[0][1] as unknown[];
    // Stores the strict key, since the loose key is taken by the existing row.
    expect(args[2]).toBe("northwindholdings");
    const metadata = JSON.parse(args[4] as string);
    expect(metadata.merge_candidate.target_entity_id).toBe("ent-hep");
    expect(metadata.merge_candidate.reason).toContain("business suffix");
  });

  it("separates rather than flagging when verified emails conflict", async () => {
    mockExtract.mockResolvedValue([
      { name: "Dana Smith", key: "amysmith", type: "person", aliases: [] },
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-dana" })
      .mockResolvedValueOnce({
        canonical_name: "Dana Smith",
        entity_type: "person",
        metadata: '{"resolution":"unresolved"}',
      });
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });
    mockMutate.mockResolvedValue({ id: "ent-dana-2" });

    await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Dana Smith",
    });

    const metadata = JSON.parse(mockMutate.mock.calls[0][1][4] as string);
    expect(metadata.merge_candidate.reason).toContain("unresolved");
  });

  it("does not rename a name-locked entity", async () => {
    mockExtract.mockResolvedValue([
      { name: "Cedar Line", key: "cedarline", type: "org", aliases: [] },
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-ws" })
      .mockResolvedValueOnce({
        canonical_name: "Cedar Line",
        entity_type: "org",
        metadata: '{"is_venture":true,"name_locked":true}',
      });
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });

    await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Cedar Line",
    });

    const update = mockDbExecute.mock.calls.find((c) =>
      sqlOf(c).includes("UPDATE entities SET canonical_name")
    );
    const args = (update![0] as { args: unknown[] }).args;
    expect(args[0]).toBe("Cedar Line");
  });

  it("flags a longer variant of a locked venture instead of renaming it", async () => {
    mockExtract.mockResolvedValue([
      { name: "Cedar Line Farms", key: "cedarline", type: "org", aliases: [] },
    ]);
    mockQueryOne
      .mockResolvedValueOnce({ id: "ent-ws" })
      .mockResolvedValueOnce({
        canonical_name: "Cedar Line",
        entity_type: "org",
        metadata: '{"is_venture":true,"name_locked":true}',
      });
    mockDbExecute.mockResolvedValue({ rowsAffected: 1 });
    mockMutate.mockResolvedValue({ id: "ent-wsf" });

    await ingestSourceEntities({
      userId: "u1",
      sourceType: "note",
      sourceId: "n1",
      text: "Cedar Line Farms",
    });

    const metadata = JSON.parse(mockMutate.mock.calls[0][1][4] as string);
    expect(metadata.merge_candidate.reason).toContain("name-locked");
  });
});
