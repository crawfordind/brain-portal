import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrateAddLinkScrapeOperation() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding 'link-scrape-and-embed' to processing_queue operations...\n");

  try {
    // Step 1: Rename old table
    console.log("1. Renaming old processing_queue table...");
    await db.execute("ALTER TABLE processing_queue RENAME TO processing_queue_old");
    console.log("✓ Renamed to processing_queue_old");

    // Step 2: Create new table with updated constraint
    console.log("\n2. Creating new processing_queue table with 'link-scrape-and-embed' operation...");
    await db.execute(`
      CREATE TABLE processing_queue (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN (
          'generate_embedding', 'generate_summary', 'generate_tags',
          'find_connections', 'analyze_capture', 'recompute_all',
          'scan_for_tasks', 'link-scrape-and-embed',
          'extract_metadata', 'generate_thumbnail', 'extract_text', 'generate_description'
        )),
        tier TEXT NOT NULL CHECK (tier IN ('local', 'embedding', 'fast_llm', 'full_llm')),
        priority INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_message TEXT,
        scheduled_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        metadata TEXT DEFAULT '{}'
      )
    `);
    console.log("✓ New table created with 'link-scrape-and-embed' operation");

    // Step 3: Copy data from old to new
    console.log("\n3. Copying data from old table...");
    const result = await db.execute(`
      INSERT INTO processing_queue (
        id, user_id, entity_type, entity_id, operation, tier, priority, status,
        attempts, max_attempts, error_message, scheduled_at, started_at, completed_at, metadata
      )
      SELECT
        id, user_id, entity_type, entity_id, operation, tier, priority, status,
        attempts, max_attempts, error_message, scheduled_at, started_at, completed_at, metadata
      FROM processing_queue_old
    `);
    console.log(`✓ Copied ${result.rowsAffected} rows`);

    // Step 4: Recreate indexes
    console.log("\n4. Recreating indexes...");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_processing_queue_user ON processing_queue(user_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_processing_queue_entity ON processing_queue(entity_type, entity_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue(status, scheduled_at)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_processing_queue_operation ON processing_queue(operation, status)");
    console.log("✓ Indexes created");

    // Step 5: Drop old table
    console.log("\n5. Dropping old table...");
    await db.execute("DROP TABLE processing_queue_old");
    console.log("✓ Old table dropped");

    console.log("\n✅ Migration complete!");
    console.log("   Processing queue now supports 'link-scrape-and-embed' operation");
    console.log("   Available operations:");
    console.log("     - generate_embedding");
    console.log("     - generate_summary");
    console.log("     - generate_tags");
    console.log("     - find_connections");
    console.log("     - analyze_capture");
    console.log("     - recompute_all");
    console.log("     - scan_for_tasks");
    console.log("     - link-scrape-and-embed");
    console.log("     - extract_metadata");
    console.log("     - generate_thumbnail");
    console.log("     - extract_text");
    console.log("     - generate_description");

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error("\nAttempting rollback...");

    try {
      // Try to restore old table if new one exists
      await db.execute("DROP TABLE IF EXISTS processing_queue");
      await db.execute("ALTER TABLE processing_queue_old RENAME TO processing_queue");
      console.log("✓ Rollback successful - old table restored");
    } catch (rollbackError) {
      console.error("❌ Rollback failed:", rollbackError);
      console.error("\n⚠️  Database may be in inconsistent state - manual intervention required");
    }

    process.exit(1);
  }

  await db.close();
}

migrateAddLinkScrapeOperation().catch(console.error);
