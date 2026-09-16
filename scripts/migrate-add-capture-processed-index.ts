/**
 * Migration: Add composite index on captures(user_id, processed, captured_at)
 *
 * The captures table is frequently queried with WHERE user_id = ? AND processed = FALSE
 * (stream API, inbox counts, captures list) but only has a single-column user_id index.
 * This composite index covers those queries and includes captured_at for ORDER BY.
 *
 * Also adds a composite index on insights(user_id, is_dismissed, is_actioned) to cover
 * the common "active insights" filter pattern.
 *
 * Run with: npx tsx scripts/migrate-add-capture-processed-index.ts
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

  console.log("Adding performance indexes...\n");

  // 1. Composite index for captures(user_id, processed, captured_at)
  console.log("  Creating idx_captures_user_processed...");
  try {
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_captures_user_processed
      ON captures(user_id, processed, captured_at DESC)
    `);
    console.log("  ✓ idx_captures_user_processed created");
  } catch (err) {
    console.error("  ✗ Failed:", err);
  }

  // 2. Composite index for insights(user_id, is_dismissed, is_actioned)
  console.log("  Creating idx_insights_user_status...");
  try {
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_insights_user_status
      ON insights(user_id, is_dismissed, is_actioned)
    `);
    console.log("  ✓ idx_insights_user_status created");
  } catch (err) {
    console.error("  ✗ Failed:", err);
  }

  console.log("\nDone!");
  process.exit(0);
}

migrate();
