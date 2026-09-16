/**
 * Migration: Add insight quality-loop support
 *
 * Adds an explicit up/down feedback signal to insights so the app can learn
 * the user's taste and bias future ranking. Semantic-dedup embeddings are
 * stored in the existing `insights.metadata` JSON (no schema change needed).
 *
 * Run with: npx tsx scripts/migrate-add-insight-quality.ts
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

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

  console.log("Adding insight quality-loop support...\n");

  // 1. Add feedback column (nullable: 'up' | 'down' | NULL)
  console.log("  Adding insights.feedback column...");
  try {
    await db.execute(
      `ALTER TABLE insights ADD COLUMN feedback TEXT
         CHECK (feedback IN ('up', 'down'))`
    );
    console.log("    ✓ feedback column added");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate column") || msg.includes("already exists")) {
      console.log("    Already exists, skipping");
    } else {
      throw e;
    }
  }

  // 2. Index for feedback-aware ranking / learning queries
  console.log("  Creating index...");
  try {
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_insights_feedback
         ON insights(user_id, insight_type) WHERE feedback IS NOT NULL`
    );
    console.log("    ✓ idx_insights_feedback created");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to create index: ${msg}`);
  }

  console.log("\n✓ Insight quality migration complete.");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
