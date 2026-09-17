/**
 * The hand-runnable SQL in scripts/sql/crm-phase-0.sql must produce exactly the
 * same schema as `applyCrmPhase0Migration`. Two artifacts describing one
 * migration will drift the moment someone edits only the TypeScript, and the
 * SQL is the one that gets pasted into a production console.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createClient, type Client } from "@libsql/client";
import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";

/** A database in the state production was in before the migration. */
async function preMigrationDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await db.execute(s);
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1','a@b.com')`);
  await db.execute(
    `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type)
     VALUES ('e1','u1','Northwind','northwind','org'), ('e2','u1','Will','will','person')`
  );
  await db.execute(
    `INSERT INTO entity_edges (id, user_id, source_entity_id, target_entity_id, edge_type, co_occurrence_count)
     VALUES ('edge1','u1','e2','e1','related', 4)`
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

/**
 * Split the .sql file into executable statements, dropping comment lines.
 * Comments are stripped rather than whole chunks that begin with one, which
 * would silently discard the statement underneath.
 */
function sqlFileStatements(
  file = "scripts/sql/crm-phase-0.sql"
): string[] {
  return readFileSync(file, "utf8")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalized description of the schema, for comparison. */
async function describeSchema(db: Client) {
  const objects = await db.execute(
    `SELECT name, type, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
  );
  const shape: Record<string, unknown> = {};
  for (const row of objects.rows) {
    const name = row.name as string;
    shape[`${row.type}:${name}`] = String(row.sql ?? "").replace(/\s+/g, " ").trim();
  }
  for (const table of [
    "contact_channels",
    "interactions",
    "entity_edges",
    "processing_queue",
    "projects",
  ]) {
    const info = await db.execute(`PRAGMA table_info(${table})`);
    shape[`columns:${table}`] = info.rows.map((r) => `${r.name}:${r.type}`).join(",");
  }
  return shape;
}

describe("scripts/sql/crm-phase-0.sql", () => {
  it("produces the same schema as the migration module", async () => {
    const viaScript = await preMigrationDb();
    await applyCrmPhase0Migration(viaScript);

    const viaSql = await preMigrationDb();
    for (const statement of sqlFileStatements()) {
      await viaSql.execute(statement);
    }

    expect(await describeSchema(viaSql)).toEqual(await describeSchema(viaScript));
  });

  it("preserves existing rows through both table rebuilds", async () => {
    const db = await preMigrationDb();
    for (const statement of sqlFileStatements()) await db.execute(statement);

    const edge = await db.execute(`SELECT * FROM entity_edges WHERE id = 'edge1'`);
    expect(edge.rows[0].co_occurrence_count).toBe(4);
    expect(edge.rows[0].metadata).toBe("{}");

    const job = await db.execute(`SELECT * FROM processing_queue WHERE id = 'job1'`);
    expect(job.rows.length).toBe(1);

    const project = await db.execute(`SELECT * FROM projects WHERE id = 'p1'`);
    expect(project.rows[0].name).toBe("Farm Show");
    expect(project.rows[0].venture_id).toBeNull();
  });

  it("accepts the CRM role vocabulary afterwards", async () => {
    const db = await preMigrationDb();
    for (const statement of sqlFileStatements()) await db.execute(statement);

    await db.execute(
      `INSERT INTO entity_edges (user_id, source_entity_id, target_entity_id, edge_type)
       VALUES ('u1','e2','e1','partner')`
    );
    await db.execute(
      `INSERT INTO contact_channels (user_id, entity_id, kind, value, normalized_value)
       VALUES ('u1','e2','email','Will@x.com','will@x.com')`
    );
    await db.execute(`UPDATE projects SET venture_id = 'e1' WHERE id = 'p1'`);

    const moved = await db.execute(`SELECT venture_id FROM projects WHERE id = 'p1'`);
    expect(moved.rows[0].venture_id).toBe("e1");
  });

  it("ends with a verification query reporting OK for every check", async () => {
    const db = await preMigrationDb();
    const statements = sqlFileStatements();
    for (const statement of statements) await db.execute(statement);

    // The last statement in the file is the five-row verification SELECT.
    const verify = await db.execute(statements[statements.length - 1]);
    expect(verify.rows.length).toBe(5);
    for (const row of verify.rows) {
      expect(row.status, `${row.check_name} should be OK`).toBe("OK");
    }
  });
});

describe("scripts/sql/crm-phase-0-flat.sql", () => {
  const FLAT = "scripts/sql/crm-phase-0-flat.sql";

  it("is one statement per line, with no comments", () => {
    const raw = readFileSync(FLAT, "utf8").trimEnd();
    // Split on either line ending and trim each line. A Windows checkout
    // leaves a trailing \r, so slicing the last character below removed *that*
    // rather than the semicolon, and this assertion failed for every
    // contributor on Windows regardless of the file's contents.
    const lines = raw.split(/\r?\n/).map((line) => line.trimEnd());
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line).not.toMatch(/^\s*--/);
      // Exactly one terminating semicolon, at the end.
      expect(line.endsWith(";")).toBe(true);
      expect(line.slice(0, -1)).not.toContain(";");
    }
    // Every statement survives being executed line by line, which is what a
    // line-oriented shell does.
    expect(lines.length).toBeGreaterThan(15);
  });

  it("produces the same schema as the migration module", async () => {
    const viaScript = await preMigrationDb();
    await applyCrmPhase0Migration(viaScript);

    const viaFlat = await preMigrationDb();
    for (const line of readFileSync(FLAT, "utf8").trimEnd().split("\n")) {
      await viaFlat.execute(line.trim());
    }

    expect(await describeSchema(viaFlat)).toEqual(await describeSchema(viaScript));
  });

  it("matches the readable version statement for statement", () => {
    const readable = sqlFileStatements()
      // The readable file ends with a verification SELECT the flat one omits.
      .filter((s) => !s.startsWith("SELECT"))
      .map((s) => s.replace(/\s+/g, " ").trim());
    const flat = readFileSync(FLAT, "utf8")
      .trimEnd()
      .split("\n")
      .map((l) => l.trim().replace(/;$/, ""));

    expect(flat).toEqual(readable);
  });

  it("preserves existing rows through both rebuilds", async () => {
    const db = await preMigrationDb();
    for (const line of readFileSync(FLAT, "utf8").trimEnd().split("\n")) {
      await db.execute(line.trim());
    }

    const edge = await db.execute(`SELECT * FROM entity_edges WHERE id = 'edge1'`);
    expect(edge.rows[0].co_occurrence_count).toBe(4);
    const job = await db.execute(`SELECT * FROM processing_queue WHERE id = 'job1'`);
    expect(job.rows.length).toBe(1);
    const project = await db.execute(`SELECT * FROM projects WHERE id = 'p1'`);
    expect(project.rows[0].name).toBe("Farm Show");
  });
});
