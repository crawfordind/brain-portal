/**
 * "Not a contact": an auto-created contact becomes a tag, against a real
 * in-memory database.
 *
 * The scenario: notes mention "Tuesday Market" and the extractor files it as
 * an org. The user says it is not a contact. Its notes and captures get the
 * tag, it leaves the contact lists, a later note that names it is tagged
 * instead of re-creating it, and Restore brings it back.
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
import {
  markNotContact,
  restoreContact,
  tagSlug,
  withTag,
} from "@/lib/crm/not-contact";
import { getNotContact, stillAContactSql } from "@/lib/crm/metadata";
import { StructureError } from "@/lib/crm/structure";
import { normalizeEntityKey, type EntityType } from "@/lib/entities/resolve";
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
    "note_tags",
    "tags",
    "captures",
    "notes",
    "users",
  ]) {
    await testDb.execute(`DELETE FROM ${t}`);
  }
  await testDb.execute(`INSERT INTO users (id, email) VALUES ('${USER}','owner@example.com')`);
  for (const id of ["n1", "n2", "n3"]) {
    await testDb.execute({
      sql: `INSERT INTO notes (id, user_id, title, slug) VALUES (?, ?, ?, ?)`,
      args: [id, USER, `Note ${id}`, id],
    });
  }
  await testDb.execute({
    sql: `INSERT INTO captures (id, user_id, content, tags) VALUES ('c1', ?, 'saw it', '["errand"]')`,
    args: [USER],
  });
});

async function mention(
  name: string,
  sourceId: string,
  sourceType = "note",
  type: EntityType = "org"
): Promise<string | undefined> {
  const key = normalizeEntityKey(name);
  const { entityIdsByKey } = await ingestExtractedEntities(
    { userId: USER, sourceType, sourceId },
    [{ name, key, type, aliases: [] }]
  );
  return entityIdsByKey.get(key);
}

async function entityNamed(name: string): Promise<Entity> {
  const rows = (
    await testDb.execute({
      sql: `SELECT * FROM entities WHERE canonical_name = ?`,
      args: [name],
    })
  ).rows;
  return { ...rows[0] } as unknown as Entity;
}

async function noteTags(noteId: string): Promise<string[]> {
  const rows = (
    await testDb.execute({
      sql: `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
            WHERE nt.note_id = ? ORDER BY t.name`,
      args: [noteId],
    })
  ).rows;
  return rows.map((r: Record<string, unknown>) => String(r.name));
}

async function captureTags(id: string): Promise<string[]> {
  const rows = (
    await testDb.execute({ sql: `SELECT tags FROM captures WHERE id = ?`, args: [id] })
  ).rows;
  return JSON.parse(String(rows[0].tags));
}

async function visibleContactIds(): Promise<string[]> {
  const rows = (
    await testDb.execute({
      sql: `SELECT id FROM entities WHERE user_id = ? AND ${stillAContactSql()}`,
      args: [USER],
    })
  ).rows;
  return rows.map((r: Record<string, unknown>) => String(r.id));
}

describe("markNotContact", () => {
  it("tags every note and capture that mentioned it and hides it from contacts", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    await mention("Tuesday Market", "n2");
    await mention("Tuesday Market", "c1", "capture");

    const result = await markNotContact(USER, id);

    expect(result.tag).toBe("Tuesday Market");
    expect(result.tagged).toBe(3);
    expect(await noteTags("n1")).toEqual(["Tuesday Market"]);
    expect(await noteTags("n2")).toEqual(["Tuesday Market"]);
    expect(await captureTags("c1")).toEqual(["errand", "Tuesday Market"]);
    expect(getNotContact(result.entity)?.tag).toBe("Tuesday Market");
    expect(await visibleContactIds()).not.toContain(id);
  });

  it("uses the tag name the user chose", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    const result = await markNotContact(USER, id, { tag: "  farmers   market " });
    expect(result.tag).toBe("farmers market");
    expect(await noteTags("n1")).toEqual(["farmers market"]);
  });

  it("tags a later note instead of re-creating the contact or logging touches", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    await markNotContact(USER, id);

    // Not handed back as a contact, so no touch point or co-occurrence edge
    // can be attached to it.
    expect(await mention("Tuesday Market", "n3")).toBeUndefined();
    expect(await noteTags("n3")).toEqual(["Tuesday Market"]);

    const rows = (
      await testDb.execute(`SELECT COUNT(*) AS n FROM entities WHERE user_id = '${USER}'`)
    ).rows;
    expect(Number(rows[0].n)).toBe(1);
  });

  it("does not tag the same note twice", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    await markNotContact(USER, id);
    await mention("Tuesday Market", "n1");
    expect(await noteTags("n1")).toEqual(["Tuesday Market"]);
    const usage = (await testDb.execute(`SELECT usage_count FROM tags`)).rows[0];
    expect(Number(usage.usage_count)).toBe(1);
  });

  it("refuses something with contact details saved", async () => {
    const id = (await mention("Northwind", "n1"))!;
    await testDb.execute({
      sql: `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
            VALUES (?, ?, 'email', 'owner@example.com', 'owner@example.com')`,
      args: [USER, id],
    });
    await expect(markNotContact(USER, id)).rejects.toBeInstanceOf(StructureError);
    expect(getNotContact(await entityNamed("Northwind"))).toBeNull();
  });

  it("refuses a venture", async () => {
    await testDb.execute({
      sql: `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, metadata)
            VALUES ('v1', ?, 'Northwind', 'northwind', 'org', '{"is_venture":true}')`,
      args: [USER],
    });
    await expect(markNotContact(USER, "v1")).rejects.toBeInstanceOf(StructureError);
  });

  it("only acts on the user's own rows", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    await expect(markNotContact("someone-else", id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("restoreContact", () => {
  it("puts it back in contacts and keeps the tags", async () => {
    const id = (await mention("Tuesday Market", "n1"))!;
    await markNotContact(USER, id);

    const restored = await restoreContact(USER, id);

    expect(getNotContact(restored)).toBeNull();
    expect(await visibleContactIds()).toContain(id);
    expect(await noteTags("n1")).toEqual(["Tuesday Market"]);
    // A contact again: later mentions attach to it as usual.
    expect(await mention("Tuesday Market", "n2")).toBe(id);
  });
});

describe("helpers", () => {
  it("slugs names, including ones with no ASCII left", () => {
    expect(tagSlug("Tuesday Market")).toBe("tuesday-market");
    expect(tagSlug("Café Zoë")).toBe("cafe-zoe");
    expect(tagSlug("東京 店")).toBe("東京-店");
  });

  it("adds a tag to a capture's list once, ignoring case", () => {
    expect(withTag('["a"]', "B")).toEqual(["a", "B"]);
    expect(withTag('["b"]', "B")).toBeNull();
    expect(withTag("not json", "B")).toEqual(["B"]);
  });
});
