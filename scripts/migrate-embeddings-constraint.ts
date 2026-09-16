import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrateEmbeddingsConstraint() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Updating embeddings table CHECK constraint...\n");

  try {
    // Step 1: Rename old table
    console.log("1. Renaming old embeddings table...");
    await db.execute("ALTER TABLE embeddings RENAME TO embeddings_old");
    console.log("✓ Renamed to embeddings_old");

    // Step 2: Create new table with updated constraint
    console.log("\n2. Creating new embeddings table with updated constraint...");
    await db.execute(`
      CREATE TABLE embeddings (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('note', 'capture', 'task_candidate')),
        entity_id TEXT NOT NULL,
        model TEXT DEFAULT 'text-embedding-3-small',
        embedding TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(entity_type, entity_id)
      )
    `);
    console.log("✓ New table created");

    // Step 3: Copy data from old to new
    console.log("\n3. Copying data from old table...");
    const result = await db.execute(`
      INSERT INTO embeddings (id, user_id, entity_type, entity_id, model, embedding, content_hash, created_at, updated_at)
      SELECT id, user_id, entity_type, entity_id, model, embedding, content_hash, created_at, updated_at
      FROM embeddings_old
    `);
    console.log(`✓ Copied ${result.rowsAffected} rows`);

    // Step 4: Recreate indexes
    console.log("\n4. Recreating indexes...");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id)");
    console.log("✓ Indexes created");

    // Step 5: Drop old table
    console.log("\n5. Dropping old table...");
    await db.execute("DROP TABLE embeddings_old");
    console.log("✓ Old table dropped");

    console.log("\n✅ Migration complete!");
    console.log("   Embeddings table now supports 'task_candidate' entity type");

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error("\nAttempting rollback...");

    try {
      // Try to restore old table if new one exists
      await db.execute("DROP TABLE IF EXISTS embeddings");
      await db.execute("ALTER TABLE embeddings_old RENAME TO embeddings");
      console.log("✓ Rollback successful - old table restored");
    } catch (rollbackError) {
      console.error("❌ Rollback failed:", rollbackError);
      console.error("\n⚠️  Database may be in inconsistent state - manual intervention required");
    }

    process.exit(1);
  }

  await db.close();
}

migrateEmbeddingsConstraint().catch(console.error);
