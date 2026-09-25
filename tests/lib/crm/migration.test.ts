/**
 * Applies the real schema and the real Phase 0 migration to an in-memory
 * libsql database. This is the only place the CHECK rebuilds are actually
 * executed rather than reasoned about, so it covers acceptance criteria 2 and 3
 * from the design: the migration is idempotent, and the rebuild preserves rows
 * while accepting the widened vocabulary.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { schema } from "@/lib/db/schema";
import {
  applyCrmPhase0Migration,
  columnExists,
  ddlContains,
} from "@/lib/crm/schema";

/**
 * The base schema as it stood before this migration.
 *
 * `schema.ts` now admits the two queue operations this migration adds, because
 * the content sweeper queues `extract-interactions` on databases that never ran
 * it. Stripping them back out keeps these tests about what they always tested:
 * an older database being widened.
 */
function preCrmSchema(): string {
  const stripped = schema.replace(
    /,\s*'create-org-from-capture',\s*'extract-interactions'/,
    ""
  );
  if (stripped === schema) {
    throw new Error("Fixture drift: schema.ts no longer lists the CRM queue operations");
  }
  return stripped;
}

/**
 * Split the schema into executable statements.
 *
 * Trigger bodies contain their own semicolons between BEGIN and END, so they
 * are removed before splitting. The migration under test touches no triggers,
 * and FTS triggers would otherwise fire on fixture inserts for no benefit.
 */
function schemaStatements(base: string = preCrmSchema()): string[] {
  return base
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    // Strip line comments first. Dropping whole chunks that merely *begin*
    // with a comment would silently discard the statement underneath it.
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function freshDb(base?: string): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  for (const statement of schemaStatements(base)) {
    await db.execute(statement);
  }
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1','a@b.com')`);
  await db.execute(
    `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
     VALUES ('e1','u1','Northwind Farms','northwind','org'),
            ('e2','u1','Will','will','person'),
            ('v1','u1','Sable Labs','sablelabs','org')`
  );
  await db.execute(
    `INSERT INTO entity_edges
       (id, user_id, source_entity_id, target_entity_id, edge_type, co_occurrence_count, strength)
     VALUES ('edge1','u1','e2','e1','related', 3, 0.6)`
  );
  await db.execute(
    `INSERT INTO processing_queue (id, user_id, entity_type, entity_id, operation, tier)
     VALUES ('job1','u1','note','n1','generate_embedding','embedding')`
  );
  await db.execute(
    `INSERT INTO projects (id, user_id, name, slug) VALUES ('p1','u1','Farm Show','farm-show')`
  );
  return db;
}

describe("applyCrmPhase0Migration", () => {
  let db: Client;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("applies every step on a fresh database", async () => {
    const steps = await applyCrmPhase0Migration(db);
    expect(steps.every((s) => s.status === "applied")).toBe(true);
  });

  it("is idempotent: a second run skips everything and changes nothing", async () => {
    await applyCrmPhase0Migration(db);
    const before = await db.execute(`SELECT * FROM entity_edges`);

    const steps = await applyCrmPhase0Migration(db);
    expect(steps.every((s) => s.status === "skipped")).toBe(true);

    const after = await db.execute(`SELECT * FROM entity_edges`);
    expect(after.rows.length).toBe(before.rows.length);
  });

  it("creates contact_channels with the inbound-resolver uniqueness", async () => {
    await applyCrmPhase0Migration(db);
    await db.execute(
      `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
       VALUES ('u1','e1','email','Dana@Northwind.com','dana@northwind.com')`
    );
    // The same address cannot be attached to a second entity.
    await expect(
      db.execute(
        `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
         VALUES ('u1','e2','email','dana@northwind.com','dana@northwind.com')`
      )
    ).rejects.toThrow();
  });

  it("creates interactions with a natural key that blocks duplicates", async () => {
    await applyCrmPhase0Migration(db);
    const insert = () =>
      db.execute(
        `INSERT INTO interactions (user_id, entity_id, channel, occurred_at, subject, dedup_key)
         VALUES ('u1','e1','meeting','2026-09-13T09:00:00Z','Meeting with Dana','meeting:e1:2026-09-13:meeting-with-dana')`
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("rejects an unknown interaction channel", async () => {
    await applyCrmPhase0Migration(db);
    await expect(
      db.execute(
        `INSERT INTO interactions (user_id, entity_id, channel, dedup_key)
         VALUES ('u1','e1','carrier-pigeon','k1')`
      )
    ).rejects.toThrow();
  });

  it("preserves entity_edges rows through the rebuild", async () => {
    await applyCrmPhase0Migration(db);
    const rows = await db.execute(`SELECT * FROM entity_edges WHERE id = 'edge1'`);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].co_occurrence_count).toBe(3);
    expect(rows.rows[0].strength).toBe(0.6);
    expect(rows.rows[0].metadata).toBe("{}");
  });

  it("accepts the new CRM role vocabulary after the rebuild", async () => {
    await applyCrmPhase0Migration(db);
    for (const role of [
      "partner",
      "collaborator",
      "customer_of",
      "member_of",
      "advisor_to",
      "investor_in",
      "employed_by",
      "reports_to",
      "contact_at",
    ]) {
      await db.execute({
        sql: `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
              VALUES ('u1','e2','v1',?)`,
        args: [role],
      });
    }
    const count = await db.execute(
      `SELECT COUNT(*) AS n FROM entity_edges WHERE source_entity_id = 'e2' AND target_entity_id = 'v1'`
    );
    expect(count.rows[0].n).toBe(9);
  });

  it("still rejects an edge_type outside the vocabulary", async () => {
    await applyCrmPhase0Migration(db);
    await expect(
      db.execute(
        `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
         VALUES ('u1','e2','v1','nemesis_of')`
      )
    ).rejects.toThrow();
  });

  it("keeps one part_of edge unique per pair, so a move cannot duplicate", async () => {
    await applyCrmPhase0Migration(db);
    const insert = () =>
      db.execute(
        `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
         VALUES ('u1','e1','v1','part_of')`
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it("preserves processing_queue rows and accepts the new operations", async () => {
    await applyCrmPhase0Migration(db);
    const existing = await db.execute(
      `SELECT * FROM processing_queue WHERE id = 'job1'`
    );
    expect(existing.rows.length).toBe(1);

    for (const op of ["create-org-from-capture", "extract-interactions"]) {
      await db.execute({
        sql: `INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier)
              VALUES ('u1','note','n2',?,'fast_llm')`,
        args: [op],
      });
    }
    expect(await ddlContains(db, "processing_queue", "extract-interactions")).toBe(
      true
    );
  });

  it("skips the queue rebuild on a database built from the current schema", async () => {
    const current = await freshDb(schema);
    const steps = await applyCrmPhase0Migration(current);
    expect(steps.find((s) => s.label === "processing_queue rebuild")?.status).toBe(
      "skipped"
    );
  });

  it("still rejects an unknown queue operation", async () => {
    await applyCrmPhase0Migration(db);
    await expect(
      db.execute(
        `INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier)
         VALUES ('u1','note','n3','mine-bitcoin','local')`
      )
    ).rejects.toThrow();
  });

  it("adds projects.venture_id without disturbing existing rows", async () => {
    await applyCrmPhase0Migration(db);
    expect(await columnExists(db, "projects", "venture_id")).toBe(true);
    const project = await db.execute(`SELECT * FROM projects WHERE id = 'p1'`);
    expect(project.rows[0].name).toBe("Farm Show");
    expect(project.rows[0].venture_id).toBeNull();

    await db.execute(`UPDATE projects SET venture_id = 'v1' WHERE id = 'p1'`);
    const moved = await db.execute(`SELECT venture_id FROM projects WHERE id = 'p1'`);
    expect(moved.rows[0].venture_id).toBe("v1");
  });
});
