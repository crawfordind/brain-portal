import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function fixTaskRecommendationsForeignKey() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Fixing task_recommendations foreign key constraint...\n");

  try {
    // Step 1: Rename old table
    console.log("1. Renaming task_recommendations table...");
    await db.execute("ALTER TABLE task_recommendations RENAME TO task_recommendations_old");
    console.log("✓ Renamed to task_recommendations_old");

    // Step 2: Create new table with corrected FK constraint
    console.log("\n2. Creating new task_recommendations table with correct FK...");
    await db.execute(`
      CREATE TABLE task_recommendations (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        -- Source information
        source_type TEXT NOT NULL CHECK (source_type IN ('note', 'daily_note', 'capture')),
        source_id TEXT NOT NULL,
        source_text TEXT NOT NULL,

        -- Recommendation details
        recommended_task TEXT NOT NULL,
        confidence REAL DEFAULT 0.7,
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        reasoning TEXT,

        -- User feedback
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dismissed', 'expired')),
        user_feedback TEXT,
        feedback_at TEXT,

        -- If accepted, link to created task
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

        -- Embedding for similarity search (CORRECTED: now points to embeddings, not embeddings_old)
        source_embedding_id TEXT REFERENCES embeddings(id) ON DELETE SET NULL,

        -- Expiration
        expires_at TEXT DEFAULT (datetime('now', '+30 days')),

        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}'
      )
    `);
    console.log("✓ New table created with correct FK");

    // Step 3: Count rows before migration
    console.log("\n3. Verifying data before copy...");
    const countBefore = await db.execute("SELECT COUNT(*) as count FROM task_recommendations_old");
    const rowsBefore = (countBefore.rows[0] as any).count;
    console.log(`✓ Found ${rowsBefore} rows in original table`);

    // Step 4: Copy all data from old to new
    console.log("\n4. Copying data from old table...");
    const result = await db.execute(`
      INSERT INTO task_recommendations (
        id, user_id, source_type, source_id, source_text,
        recommended_task, confidence, priority, reasoning,
        status, user_feedback, feedback_at, task_id,
        source_embedding_id, expires_at, created_at, updated_at, metadata
      )
      SELECT
        id, user_id, source_type, source_id, source_text,
        recommended_task, confidence, priority, reasoning,
        status, user_feedback, feedback_at, task_id,
        source_embedding_id, expires_at, created_at, updated_at, metadata
      FROM task_recommendations_old
    `);
    console.log(`✓ Copied ${result.rowsAffected} rows`);

    // Step 5: Verify all data was copied
    console.log("\n5. Verifying data after copy...");
    const countAfter = await db.execute("SELECT COUNT(*) as count FROM task_recommendations");
    const rowsAfter = (countAfter.rows[0] as any).count;
    console.log(`✓ New table has ${rowsAfter} rows`);

    if (rowsBefore !== rowsAfter) {
      throw new Error(
        `Data mismatch! Original had ${rowsBefore} rows but new table has ${rowsAfter} rows. Aborting.`
      );
    }
    console.log("✓ All data successfully copied - no data loss");

    // Step 6: Recreate indexes
    console.log("\n6. Recreating indexes...");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_task_rec_user ON task_recommendations(user_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_task_rec_status ON task_recommendations(user_id, status, expires_at)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_task_rec_source ON task_recommendations(source_type, source_id)");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_task_rec_feedback ON task_recommendations(user_id, created_at) WHERE user_feedback IS NOT NULL");
    await db.execute("CREATE INDEX IF NOT EXISTS idx_task_rec_cleanup ON task_recommendations(status, created_at)");
    console.log("✓ Indexes created");

    // Step 7: Drop old table
    console.log("\n7. Dropping old table...");
    await db.execute("DROP TABLE task_recommendations_old");
    console.log("✓ Old table dropped");

    // Step 8: Verify the FK constraint
    console.log("\n8. Verifying foreign key constraint...");
    const fks = await db.execute("PRAGMA foreign_key_list(task_recommendations)");
    const embeddingFk = fks.rows.find((row: any) => row.from === "source_embedding_id");
    console.log("FK constraint:", embeddingFk);

    if (embeddingFk && (embeddingFk as any).table === "embeddings") {
      console.log("✓ FK now correctly points to embeddings table");
    } else {
      console.warn("⚠️  FK constraint may not be correct");
    }

    console.log("\n✅ Migration complete!");
    console.log("   task_recommendations.source_embedding_id now correctly references embeddings(id)");

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    console.error("\nAttempting rollback...");

    try {
      // Try to restore old table if new one exists
      await db.execute("DROP TABLE IF EXISTS task_recommendations");
      await db.execute("ALTER TABLE task_recommendations_old RENAME TO task_recommendations");
      console.log("✓ Rollback successful - old table restored");
    } catch (rollbackError) {
      console.error("❌ Rollback failed:", rollbackError);
      console.error("\n⚠️  Database may be in inconsistent state - manual intervention required");
    }

    process.exit(1);
  }

  await db.close();
}

fixTaskRecommendationsForeignKey().catch(console.error);
