/**
 * Merge and resolution, against a real in-memory database.
 *
 * The merge gate leaves a review queue; these tests cover the only way to act
 * on it. The important assertions are the ones about what a merge must NOT
 * change: the venture recorded on a past interaction, and the fact that the
 * merge happened at all.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({
  db: testDb,
  query: async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r })),
  queryAll: async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r })),
  queryOne: async (sql: string, args: unknown[] = []) => {
    const rows = (await testDb.execute({ sql, args })).rows;
    return rows[0] ? { ...rows[0] } : null;
  },
  mutate: async (sql: string, args: unknown[] = []) => {
    const rows = (await testDb.execute({ sql, args })).rows;
    return rows[0] ? { ...rows[0] } : null;
  },
}));

import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";
import {
  mergeEntities,
  resolveContact,
  listMergeCandidates,
} from "@/lib/crm/merge";
import { logInteraction } from "@/lib/crm/interactions";
import { createVenture } from "@/lib/crm/structure";
import { getResolution, readEntityMetadata } from "@/lib/crm/metadata";

const USER = "u1";

const DATA_TABLES = [
  "interactions",
  "contact_channels",
  "entity_edges",
  "entity_aliases",
  "entity_mentions",
  "entities",
  "projects",
  "users",
];

beforeAll(async () => {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await testDb.execute(s);
  await applyCrmPhase0Migration(testDb);
});

async function reset() {
  for (const table of DATA_TABLES) await testDb.execute(`DELETE FROM ${table}`);
  await testDb.execute(`INSERT INTO users (id, email) VALUES ('${USER}','a@b.com')`);
}

async function makeEntity(
  id: string,
  name: string,
  key: string,
  type = "person",
  metadata = "{}",
  mentions = 0
) {
  await testDb.execute({
    sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, mention_count, metadata, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, '2026-01-01', '2026-06-01')`,
    args: [id, USER, name, key, type, mentions, metadata],
  });
}

describe("mergeEntities", () => {
  beforeEach(reset);

  it("moves mentions, interactions, channels and edges onto the winner", async () => {
    await makeEntity("w", "Dana Okonkwo", "amynorthwind", "person", "{}", 5);
    await makeEntity("l", "Dana H", "danah", "person", "{}", 3);
    await makeEntity("o", "Northwind", "northwind", "org");

    await testDb.execute(
      `INSERT INTO entity_mentions (user_id, entity_id, source_type, source_id)
       VALUES ('${USER}','l','note','n1')`
    );
    await testDb.execute(
      `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
       VALUES ('${USER}','l','email','Dana@h.com','dana@h.com')`
    );
    await testDb.execute(
      `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
       VALUES ('${USER}','l','o','works_with')`
    );
    await logInteraction(USER, {
      entityId: "l",
      channel: "call",
      subject: "intro",
      occurredAt: "2026-05-01T10:00:00Z",
    });

    const report = await mergeEntities(USER, "w", "l");

    expect(report.moved.mentions).toBe(1);
    expect(report.moved.interactions).toBe(1);
    expect(report.moved.channels).toBe(1);
    expect(report.moved.edges).toBe(1);

    const gone = await testDb.execute(`SELECT * FROM entities WHERE id = 'l'`);
    expect(gone.rows.length).toBe(0);

    for (const table of ["entity_mentions", "contact_channels", "interactions"]) {
      const rows = await testDb.execute(
        `SELECT entity_id FROM ${table} WHERE user_id = '${USER}'`
      );
      expect(rows.rows.every((r: Record<string, unknown>) => r.entity_id === "w")).toBe(true);
    }
  });

  it("records the loser's name as an alias, so the merge leaves a trace", async () => {
    await makeEntity("w", "Dana Okonkwo", "amynorthwind");
    await makeEntity("l", "Dana H", "danah");

    await mergeEntities(USER, "w", "l");

    const aliases = await testDb.execute(
      `SELECT * FROM entity_aliases WHERE entity_id = 'w'`
    );
    expect(aliases.rows.map((r: Record<string, unknown>) => r.alias)).toContain("Dana H");
    expect(aliases.rows.map((r: Record<string, unknown>) => r.normalized_key)).toContain("danah");
  });

  it("does not move the venture recorded on a past interaction", async () => {
    const { entity: venture } = await createVenture(USER, { name: "Cedar Line" });
    await makeEntity("w", "Dana Okonkwo", "amynorthwind");
    await makeEntity("l", "Dana H", "danah");

    const { interaction } = await logInteraction(USER, {
      entityId: "l",
      ventureId: venture.id,
      channel: "call",
      subject: "pricing",
      occurredAt: "2026-05-01T10:00:00Z",
    });

    await mergeEntities(USER, "w", "l");

    const after = await testDb.execute({
      sql: `SELECT entity_id, venture_id FROM interactions WHERE id = ?`,
      args: [interaction.id],
    });
    // The counterparty changed. The venture did not.
    expect(after.rows[0].entity_id).toBe("w");
    expect(after.rows[0].venture_id).toBe(venture.id);
  });

  it("carries mention counts and the earliest sighting onto the winner", async () => {
    await makeEntity("w", "Dana Okonkwo", "amynorthwind", "person", "{}", 5);
    await makeEntity("l", "Dana H", "danah", "person", "{}", 3);
    await testDb.execute(
      `UPDATE entities SET first_seen_at = '2025-03-01' WHERE id = 'l'`
    );

    await mergeEntities(USER, "w", "l");

    const winner = await testDb.execute(`SELECT * FROM entities WHERE id = 'w'`);
    expect(winner.rows[0].mention_count).toBe(8);
    expect(winner.rows[0].first_seen_at).toBe("2025-03-01");
  });

  it("clears the merge_candidate flag once a human has decided", async () => {
    await makeEntity(
      "w",
      "Northwind Farms",
      "northwind",
      "org",
      '{"merge_candidate":{"target_entity_id":"l","confidence":0.6,"reason":"suffix"}}'
    );
    await makeEntity("l", "Northwind Holdings", "northwindholdings", "org");

    await mergeEntities(USER, "w", "l");

    const winner = await testDb.execute(`SELECT * FROM entities WHERE id = 'w'`);
    expect(
      readEntityMetadata(winner.rows[0].metadata as string).merge_candidate
    ).toBeUndefined();
  });

  it("cannot face a duplicate channel, because the schema forbids one", async () => {
    // Worth asserting rather than assuming: UNIQUE(user_id, kind,
    // normalized_value) excludes entity_id, so one address can only ever sit on
    // one entity per user. That is what makes inbound resolution unambiguous,
    // and it is why the merge moves channels wholesale with no clash handling.
    await makeEntity("w", "Dana Okonkwo", "amynorthwind");
    await makeEntity("l", "Dana H", "danah");
    await testDb.execute({
      sql: `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
            VALUES (?, 'w', 'email', 'dana@h.com', 'dana@h.com')`,
      args: [USER],
    });
    await expect(
      testDb.execute({
        sql: `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
              VALUES (?, 'l', 'email', 'dana@h.com', 'dana@h.com')`,
        args: [USER],
      })
    ).rejects.toThrow();

    const report = await mergeEntities(USER, "w", "l");
    expect(report.moved.channels).toBe(0);
  });

  it("leaves no self-edge when both sides shared a neighbour", async () => {
    await makeEntity("w", "Dana Okonkwo", "amynorthwind");
    await makeEntity("l", "Dana H", "danah");
    await testDb.execute(
      `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
       VALUES ('${USER}','l','w','related')`
    );

    await mergeEntities(USER, "w", "l");

    const edges = await testDb.execute(`SELECT * FROM entity_edges`);
    expect(
      edges.rows.every((r: Record<string, unknown>) => r.source_entity_id !== r.target_entity_id)
    ).toBe(true);
  });

  it("refuses to merge a venture", async () => {
    const { entity: venture } = await createVenture(USER, { name: "Northwind Farms" });
    await makeEntity("l", "Northwind Farms Farms", "northwindfarmsfarms", "org");

    await expect(mergeEntities(USER, venture.id, "l")).rejects.toThrow(
      /Ventures cannot be merged/
    );
    await expect(mergeEntities(USER, "l", venture.id)).rejects.toThrow(
      /Ventures cannot be merged/
    );
  });

  it("refuses to merge an entity into itself, or an unknown one", async () => {
    await makeEntity("w", "Dana", "dana");
    await expect(mergeEntities(USER, "w", "w")).rejects.toThrow(/into itself/);
    await expect(mergeEntities(USER, "w", "nope")).rejects.toThrow(/not found/);
  });
});

describe("resolveContact", () => {
  beforeEach(reset);

  it("confirms an unresolved capture in place under a real name", async () => {
    await makeEntity(
      "r",
      "Rascal",
      "rascal",
      "person",
      '{"resolution":"unresolved","resolution_hint":{"met_at":"MycoFest 2026"}}'
    );

    const result = await resolveContact(USER, "r", {
      confirmedName: "Ross Calder",
    });

    expect(result.action).toBe("confirmed");
    const row = await testDb.execute(`SELECT * FROM entities WHERE id = 'r'`);
    expect(row.rows[0].canonical_name).toBe("Ross Calder");
    expect(row.rows[0].normalized_key).toBe("rosscalder");
    expect(getResolution(row.rows[0].metadata as string)).toBe("confirmed");
    expect(
      readEntityMetadata(row.rows[0].metadata as string).resolution_hint
    ).toBeUndefined();
  });

  it("confirms in place without renaming when no name is given", async () => {
    await makeEntity("r", "Rascal", "rascal", "person", '{"resolution":"unresolved"}');

    await resolveContact(USER, "r");

    const row = await testDb.execute(`SELECT * FROM entities WHERE id = 'r'`);
    expect(row.rows[0].canonical_name).toBe("Rascal");
    expect(getResolution(row.rows[0].metadata as string)).toBe("confirmed");
  });

  it("merges an unresolved capture into an existing contact", async () => {
    await makeEntity("known", "Matt Byrne", "mattbyrne");
    await makeEntity(
      "r",
      "Matt in Carlisle",
      "mattincarlisle",
      "person",
      '{"resolution":"unresolved"}'
    );
    await logInteraction(USER, {
      entityId: "r",
      channel: "event",
      subject: "MycoFest",
      occurredAt: "2026-05-01T10:00:00Z",
    });

    const result = await resolveContact(USER, "r", { mergeIntoId: "known" });

    expect(result.action).toBe("merged");
    expect(result.entityId).toBe("known");
    const touches = await testDb.execute(`SELECT entity_id FROM interactions`);
    expect(touches.rows[0].entity_id).toBe("known");
  });

  it("refuses a rename that would collide, and points at merging instead", async () => {
    await makeEntity("known", "Matt Byrne", "mattbyrne");
    await makeEntity("r", "Rascal", "rascal", "person", '{"resolution":"unresolved"}');

    await expect(
      resolveContact(USER, "r", { confirmedName: "Matt Byrne" })
    ).rejects.toThrow(/Merge into it instead/);
  });
});

describe("listMergeCandidates", () => {
  beforeEach(reset);

  it("returns flagged entities with the row they were flagged against", async () => {
    await makeEntity("target", "Northwind Farms", "northwind", "org");
    await makeEntity(
      "flagged",
      "Northwind Holdings",
      "northwindholdings",
      "org",
      '{"merge_candidate":{"target_entity_id":"target","confidence":0.6,"reason":"business suffix"}}'
    );

    const candidates = await listMergeCandidates(USER);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].entity.id).toBe("flagged");
    expect(candidates[0].targetName).toBe("Northwind Farms");
    expect(candidates[0].reason).toContain("business suffix");
  });

  it("returns nothing when no entity is flagged", async () => {
    await makeEntity("a", "Dana", "dana");
    expect(await listMergeCandidates(USER)).toEqual([]);
  });
});
