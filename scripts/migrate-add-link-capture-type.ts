import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrateAddLinkCaptureType() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding 'link' to captures table capture_type enum...\n");

  try {
    // Step 1: Rename old table
    console.log("1. Renaming old captures table...");
    await db.execute("ALTER TABLE captures RENAME TO captures_old");
    console.log("✓ Renamed to captures_old");

    // Step 2: Create new table with updated constraint
    console.log("\n2. Creating new captures table with 'link' type...");
    await db.execute(`
      CREATE TABLE captures (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        daily_note_id TEXT REFERENCES daily_notes(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        capture_type TEXT DEFAULT 'thought' CHECK (capture_type IN ('thought', 'idea', 'followup', 'task', 'quote', 'reference', 'link')),
        captured_at TEXT DEFAULT (datetime('now')),
        processed INTEGER DEFAULT 0,
        linked_notes TEXT DEFAULT '[]',
        linked_projects TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("✓ New table created with 'link' capture type");

    // Step 3: Copy data from old to new
    console.log("\n3. Copying data from old table...");
    const result = await db.execute(`
      INSERT INTO captures (id, user_id, daily_note_id, content, capture_type, captured_at, processed, linked_notes, linked_projects, tags, metadata, created_at)
      SELECT id, user_id, daily_note_id, content, capture_type, captured_at, processed, linked_notes, linked_projects, tags, metadata, created_at
      FROM captures_old
    `);
    console.log(`✓ Copied ${result.rowsAffected} rows`);

    // Step 4: Recreate indexes
    console.log("\n4. Recreating indexes...");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(user_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_captures_daily ON captures(daily_note_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_captures_date ON captures(captured_at)");
    console.log("✓ Indexes created");

    // Step 5: Drop old table
    console.log("\n5. Dropping old table...");
    await db.execute("DROP TABLE captures_old");
    console.log("✓ Old table dropped");

    console.log("\n✅ Migration complete!");
    console.log("   Captures table now supports 'link' capture type");
    console.log("   Available types: 'thought', 'idea', 'followup', 'task', 'quote', 'reference', 'link'");

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error("\nAttempting rollback...");

    try {
      // Try to restore old table if new one exists
      await db.execute("DROP TABLE IF EXISTS captures");
      await db.execute("ALTER TABLE captures_old RENAME TO captures");
      console.log("✓ Rollback successful - old table restored");
    } catch (rollbackError) {
      console.error("❌ Rollback failed:", rollbackError);
      console.error("\n⚠️  Database may be in inconsistent state - manual intervention required");
    }

    process.exit(1);
  }

  await db.close();
}

migrateAddLinkCaptureType().catch(console.error);
