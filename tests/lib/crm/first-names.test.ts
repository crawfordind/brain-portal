/**
 * Editing a contact and telling people apart by first name, against a real
 * in-memory database.
 *
 * The scenario: a note mentions "Justin", the user edits him into "Justin
 * Smith" and later meets a second Justin. A note that says only "Justin" must
 * then ask which one rather than guess, and once answered must not ask again.
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

vi.mock("@/lib/entities/extractor", () => ({ extractEntities: vi.fn() }));

import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";
import { ingestExtractedEntities } from "@/lib/entities/store";
import { updateContact, ContactNameTakenError } from "@/lib/crm/edit";
import { decideMergeCandidate, resolveContact } from "@/lib/crm/merge";
import {
  getAbout,
  getAmbiguousMention,
  getMergeCandidate,
  getResolution,
  isNameLocked,
} from "@/lib/crm/metadata";
import { normalizeEntityKey } from "@/lib/entities/resolve";
import type { Entity } from "@/lib/db/schema";

const USER = "u1";

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

beforeEach(async () => {
  for (const t of [
    "interactions",
    "contact_channels",
    "entity_edges",
    "entity_aliases",
    "entity_mentions",
    "entities",
    "users",
  ]) {
    await testDb.execute(`DELETE FROM ${t}`);
  }
  await testDb.execute(`INSERT INTO users (id, email) VALUES ('${USER}','a@b.com')`);
});

/** Ingest one person mention from a note; returns the entity id it landed on. */
async function mention(name: string, noteId: string): Promise<string> {
  const key = normalizeEntityKey(name);
  const { entityIdsByKey } = await ingestExtractedEntities(
    { userId: USER, sourceType: "note", sourceId: noteId },
    [{ name, key, type: "person", aliases: [] }]
  );
  return entityIdsByKey.get(key)!;
}

async function entity(id: string): Promise<Entity | null> {
  const rows = (
    await testDb.execute({ sql: `SELECT * FROM entities WHERE id = ?`, args: [id] })
  ).rows;
  return rows[0] ? ({ ...rows[0] } as unknown as Entity) : null;
}

async function mentionsOf(id: string): Promise<string[]> {
  const rows = (
    await testDb.execute({
      sql: `SELECT source_id FROM entity_mentions WHERE entity_id = ? ORDER BY source_id`,
      args: [id],
    })
  ).rows;
  return rows.map((r) => String(r.source_id));
}

describe("updateContact", () => {
  it("gives a contact a full name, keeps the old one as an alias, and locks it", async () => {
    const id = await mention("Justin", "n1");
    const updated = await updateContact(USER, id, {
      name: "Justin Smith",
      about: "Runs the co-op",
    });

    expect(updated.canonical_name).toBe("Justin Smith");
    expect(updated.normalized_key).toBe("justinsmith");
    expect(isNameLocked(updated)).toBe(true);
    expect(getAbout(updated)).toBe("Runs the co-op");

    // A later note saying "Justin" still lands on him.
    expect(await mention("Justin", "n2")).toBe(id);
    expect(await mentionsOf(id)).toEqual(["n1", "n2"]);
  });

  it("refuses a name another contact already has", async () => {
    const a = await mention("Justin", "n1");
    await mention("Dana Okonkwo", "n2");
    await expect(updateContact(USER, a, { name: "Dana Okonkwo" })).rejects.toBeInstanceOf(
      ContactNameTakenError
    );
  });

  it("clears 'about' with an empty string and rejects an unknown type", async () => {
    const id = await mention("Justin", "n1");
    await updateContact(USER, id, { about: "x" });
    expect(getAbout(await updateContact(USER, id, { about: "" }))).toBeNull();
    await expect(updateContact(USER, id, { type: "robot" })).rejects.toThrow(/Type/);
  });
});

describe("first-name disambiguation", () => {
  it("attaches a first name to the only person who has it", async () => {
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
       VALUES ('s','${USER}','Justin Smith','justinsmith','person')`
    );
    expect(await mention("Justin", "n1")).toBe("s");
  });

  it("asks which one when two people share it, and remembers the answer", async () => {
    const smith = await mention("Justin", "n1");
    await updateContact(USER, smith, { name: "Justin Smith" });
    const lee = await mention("Justin Lee", "n2");
    expect(lee).not.toBe(smith);

    const placeholderId = await mention("Justin", "n3");
    expect([smith, lee]).not.toContain(placeholderId);
    const placeholder = (await entity(placeholderId))!;
    expect(getResolution(placeholder)).toBe("unresolved");
    expect(getAmbiguousMention(placeholder)?.candidate_ids.sort()).toEqual(
      [smith, lee].sort()
    );

    // Re-reading the same note while the question is open reuses it.
    expect(await mention("Justin", "n3")).toBe(placeholderId);

    await resolveContact(USER, placeholderId, { mergeIntoId: lee });
    expect(await entity(placeholderId)).toBeNull();
    expect(await mentionsOf(lee)).toEqual(["n2", "n3"]);

    // The answer sticks for that note, and does not leak to other notes.
    expect(await mention("Justin", "n3")).toBe(lee);
    const other = await mention("Justin", "n4");
    expect([smith, lee]).not.toContain(other);
  });

  it("can answer 'someone new' with a full name", async () => {
    await testDb.execute(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
       VALUES ('s','${USER}','Justin Smith','justinsmith','person'),
              ('l','${USER}','Justin Lee','justinlee','person')`
    );
    const placeholderId = await mention("Justin", "n1");
    await resolveContact(USER, placeholderId, { confirmedName: "Justin Brown" });

    const confirmed = (await entity(placeholderId))!;
    expect(confirmed.canonical_name).toBe("Justin Brown");
    expect(confirmed.normalized_key).toBe("justinbrown");
    expect(getResolution(confirmed)).toBe("confirmed");
    expect(getAmbiguousMention(confirmed)).toBeNull();
    expect(await mention("Justin", "n1")).toBe(placeholderId);
  });
});

describe("a full name next to an existing first-name-only contact", () => {
  it("is flagged, and 'same person' keeps the fuller name", async () => {
    const bare = await mention("Justin", "n1");
    const full = await mention("Justin Lee", "n2");
    expect(getMergeCandidate((await entity(full))!)?.target_entity_id).toBe(bare);

    const { entityId } = await decideMergeCandidate(USER, full, "same");
    expect(entityId).toBe(full);
    expect(await entity(bare)).toBeNull();
    const kept = (await entity(full))!;
    expect(kept.canonical_name).toBe("Justin Lee");
    expect(getMergeCandidate(kept)).toBeNull();
    expect(await mentionsOf(full)).toEqual(["n1", "n2"]);
  });

  it("'different people' keeps both and clears the flag", async () => {
    const bare = await mention("Justin", "n1");
    const full = await mention("Justin Lee", "n2");
    await decideMergeCandidate(USER, full, "different");
    expect(await entity(bare)).not.toBeNull();
    expect(getMergeCandidate((await entity(full))!)).toBeNull();
  });
});
