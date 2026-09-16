/**
 * Migration: CRM Phase 0
 *
 * Thin CLI over `applyCrmPhase0Migration`. The DDL and the idempotency guards
 * live in `src/lib/crm/schema.ts` so they can be exercised against an in-memory
 * database by tests rather than only against production.
 *
 * Run with: npx tsx scripts/migrate-add-crm-phase-0.ts
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";

dotenv.config({ path: ".env.local" });

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("CRM Phase 0 migration\n");
  const steps = await applyCrmPhase0Migration(db, (m) => console.log(m));

  const applied = steps.filter((s) => s.status === "applied").length;
  const skipped = steps.length - applied;
  console.log(`\n✓ Complete. ${applied} applied, ${skipped} already in place.`);
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
