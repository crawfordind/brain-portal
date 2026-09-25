/**
 * The sweeper's SQL, run against the real schema in an in-memory database.
 *
 * `sweep.test.ts` covers the decisions with a mocked client; this covers the
 * parts a mock cannot: that the candidate query, the timestamp comparisons
 * (including an ISO `updated_at` written by a non-SQL path), the upsert and
 * the real `enqueue` all actually work on SQLite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient, type Client, type InValue } from "@libsql/client";

let mem: Client;

vi.mock("@/lib/db/client", () => {
  const rows = async (sql: string, args: unknown[] = []) =>
    (await mem.execute({ sql, args: args as InValue[] })).rows as unknown[];
  return {
    db: {
      execute: (stmt: string | { sql: string; args?: unknown[] }) =>
        typeof stmt === "string"
          ? mem.execute(stmt)
          : mem.execute({ sql: stmt.sql, args: (stmt.args ?? []) as InValue[] }),
      batch: vi.fn(),
      close: vi.fn(),
    },
    query: rows,
    queryAll: rows,
    queryOne: async (sql: string, args: unknown[] = []) => (await rows(sql, args))[0] ?? null,
    mutate: async (sql: string, args: unknown[] = []) => (await rows(sql, args))[0] ?? null,
  };
});

import { schema } from "@/lib/db/schema";
import { sweepUnprocessedContent } from "@/lib/processing/sweep";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await db.execute(s);
  // The contacts job needs the CRM's interactions table to be worth queueing.
  await db.execute(`CREATE TABLE interactions (id TEXT PRIMARY KEY)`);
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'a@b.com')`);
  return db;
}

const BODY =
  "Had coffee with Dana Okonkwo from Northwind Farms about the bulk compost order. " +
  "She wants samples by Friday and a quote for forty pallets delivered monthly. " +
  "We also talked about their new greenhouse, the co-op pricing they got last spring, " +
  "and whether the trucks can reach the north field after the rains.";

async function insertNote(id: string, updatedAt: string, opts: { archived?: boolean } = {}) {
  await mem.execute({
    sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, is_archived, updated_at)
          VALUES (?, 'u1', ?, ?, ?, ?, ?, ?)`,
    args: [id, `Note ${id}`, id, `<p>${BODY}</p>`, BODY, opts.archived ? 1 : 0, updatedAt],
  });
}

async function queued(entityId: string): Promise<string[]> {
  const r = await mem.execute({
    sql: `SELECT operation FROM processing_queue WHERE entity_id = ? ORDER BY priority DESC, operation`,
    args: [entityId],
  });
  return r.rows.map((row) => String(row.operation));
}

describe("sweepUnprocessedContent against SQLite", () => {
  beforeEach(async () => {
    mem = await freshDb();
  });

  it("queues the full pipeline for a note nothing queued, once", async () => {
    await insertNote("n1", "2026-01-01 10:00:00");

    const first = await sweepUnprocessedContent();
    expect(first.notesQueued).toBe(1);
    expect(await queued("n1")).toEqual([
      "generate_embedding",
      "extract-interactions",
      "find_connections",
      "generate_summary",
      "generate_tags",
    ]);

    // Nothing changed: the second run finds nothing to do.
    const second = await sweepUnprocessedContent();
    expect(second.notesQueued).toBe(0);
    expect(second.unchanged).toBe(0);
  });

  it("re-runs after an edit, and not after a pin", async () => {
    await insertNote("n1", "2026-01-01 10:00:00");
    await sweepUnprocessedContent();
    await mem.execute(`UPDATE processing_queue SET status = 'completed'`);

    // A pin moves updated_at (here in ISO form, as a JS writer would stamp it)
    // without touching the text.
    await mem.execute(
      `UPDATE notes SET is_pinned = 1, updated_at = '2026-01-02T09:00:00.000Z' WHERE id = 'n1'`
    );
    const afterPin = await sweepUnprocessedContent();
    expect(afterPin.unchanged).toBe(1);
    expect(afterPin.jobsQueued).toBe(0);

    await mem.execute(
      `UPDATE notes SET content = content || '<p>Also called Sam.</p>', updated_at = '2026-01-03 09:00:00' WHERE id = 'n1'`
    );
    const afterEdit = await sweepUnprocessedContent();
    expect(afterEdit.notesQueued).toBe(1);
    expect(afterEdit.jobsQueued).toBe(5);
  });

  it("leaves a note that is still being edited, and archived notes, alone", async () => {
    await mem.execute({
      sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, updated_at)
            VALUES ('live', 'u1', 'Live', 'live', ?, ?, datetime('now'))`,
      args: [BODY, BODY],
    });
    await insertNote("old", "2026-01-01 10:00:00", { archived: true });

    const result = await sweepUnprocessedContent();
    expect(result.notesQueued).toBe(0);
  });

  it("reads captures for contacts", async () => {
    await mem.execute({
      sql: `INSERT INTO captures (id, user_id, content, capture_type, created_at)
            VALUES ('c1', 'u1', 'Met Dana Okonkwo at the expo, wants samples', 'thought', '2026-01-01 10:00:00')`,
      args: [],
    });
    const result = await sweepUnprocessedContent();
    expect(result.capturesQueued).toBe(1);
    expect(await queued("c1")).toEqual(["extract-interactions"]);
  });

  it("does not duplicate a job a route already queued", async () => {
    await insertNote("n1", "2026-01-01 10:00:00");
    await mem.execute(
      `INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier, priority)
       VALUES ('u1', 'note', 'n1', 'generate_embedding', 'embedding', 1)`
    );
    await sweepUnprocessedContent();
    const embeddings = (await queued("n1")).filter((op) => op === "generate_embedding");
    expect(embeddings).toHaveLength(1);
  });
});
