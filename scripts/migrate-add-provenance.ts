/**
 * Migration: record who wrote each row, and which operation produced it.
 *
 * Adds four nullable columns to `notes`, `captures`, `tasks` and `reminders`:
 *
 *   source_actor   'human' | 'mcp_key' | 'agent' | 'skill' | 'import'
 *   source_key_id  mcp_api_keys.id, with no foreign key (see below)
 *   source_label   the writer's name at write time
 *   source_run_id  the one operation this row came out of
 *
 * Nothing is backfilled and nothing needs to be: every existing row has NULL
 * in all four, and `normalizeActor` reads NULL as "human", which is both the
 * correct default and true of nearly every row written so far.
 *
 * `source_key_id` carries no REFERENCES clause on purpose. Revoking a key must
 * not cascade away the history of everything it ever wrote, and `source_label`
 * exists so a revoked key's rows still read "Claude Desktop" rather than a
 * dead id.
 *
 * Idempotent: a duplicate column is reported and skipped, so re-running is
 * safe. `npm run db:migrate` applies the same statements.
 *
 * Run with: npx tsx scripts/migrate-add-provenance.ts
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const TABLES = ["notes", "captures", "tasks", "reminders"] as const;
const COLUMNS = [
  "source_actor",
  "source_key_id",
  "source_label",
  "source_run_id",
] as const;

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding provenance columns...\n");

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const table of TABLES) {
    for (const column of COLUMNS) {
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
        console.log(`  ✓ ${table}.${column}`);
        added++;
      } catch (error: unknown) {
        const message = (error as Error).message ?? "";
        if (message.includes("duplicate column name")) {
          console.log(`  ○ ${table}.${column} (exists)`);
          skipped++;
        } else {
          console.error(`  ✗ ${table}.${column}:`, message.substring(0, 120));
          failed++;
        }
      }
    }

    // "Everything from this run" is the query the collapsed stream row makes;
    // without this it is a full scan of the table per run.
    try {
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_${table}_run ON ${table}(user_id, source_run_id)`
      );
      console.log(`  ✓ idx_${table}_run`);
    } catch (error: unknown) {
      console.error(
        `  ✗ idx_${table}_run:`,
        ((error as Error).message ?? "").substring(0, 120)
      );
      failed++;
    }
  }

  console.log(`\nAdded: ${added}  Skipped: ${skipped}  Failed: ${failed}`);
  await db.close();

  if (failed > 0) process.exit(1);
  console.log("Done.");
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
