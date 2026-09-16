import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Migration: Update notes.note_type CHECK constraint
 *
 * SQLite doesn't support ALTER CHECK constraints, so we must recreate the table.
 * Old constraint: note_type IN ('note', 'daily', 'weekly', 'insight')
 * New constraint: note_type IN ('note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal')
 */
async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Starting note_type CHECK constraint migration...\n");

  try {
    // Check current constraint by trying to see the table schema
    const tableInfo = await db.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='notes'`
    );
    const createSql = tableInfo.rows[0]?.sql as string;

    if (!createSql) {
      console.error("✗ Could not find notes table");
      process.exit(1);
    }

    console.log("Current table definition:");
    console.log(createSql.substring(0, 200) + "...\n");

    // Check if the constraint already includes journal types
    if (createSql.includes("'journal'") && createSql.includes("'monthly_journal'")) {
      console.log("○ CHECK constraint already includes journal types. Nothing to do.");
      await db.close();
      return;
    }

    console.log("Updating CHECK constraint to include 'journal' and 'monthly_journal'...\n");

    // Use a batch transaction for atomicity
    await db.executeMultiple(`
      PRAGMA foreign_keys=OFF;

      CREATE TABLE notes_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        content_plain TEXT,
        note_type TEXT DEFAULT 'note' CHECK (note_type IN ('note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal')),
        is_pinned INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        word_count INTEGER DEFAULT 0,
        frontmatter TEXT DEFAULT '{}',
        metadata TEXT DEFAULT '{}',
        summary TEXT,
        auto_tags TEXT DEFAULT '[]',
        processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
        share_token TEXT,
        shared_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, slug)
      );

      INSERT INTO notes_new SELECT
        id, user_id, project_id, title, slug, content, content_plain,
        note_type, is_pinned, is_archived, word_count, frontmatter, metadata,
        summary, auto_tags, processing_status, share_token, shared_at,
        created_at, updated_at
      FROM notes;

      DROP TABLE notes;

      ALTER TABLE notes_new RENAME TO notes;

      CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
      CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type);
      CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_share_token ON notes(share_token) WHERE share_token IS NOT NULL;

      PRAGMA foreign_keys=ON;
    `);

    // Verify the migration
    const newTableInfo = await db.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='notes'`
    );
    const newSql = newTableInfo.rows[0]?.sql as string;

    if (newSql?.includes("'journal'") && newSql?.includes("'monthly_journal'")) {
      console.log("✓ Successfully updated note_type CHECK constraint");
      console.log("\nNew constraint: note_type IN ('note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal')");
    } else {
      console.error("✗ Migration may have failed - constraint not found in new table definition");
      console.log("New table SQL:", newSql);
    }

    // Verify row count
    const count = await db.execute(`SELECT COUNT(*) as cnt FROM notes`);
    console.log(`\nNotes table row count: ${count.rows[0]?.cnt}`);

  } catch (error) {
    console.error("✗ Migration failed:", error);
    process.exit(1);
  }

  await db.close();
  console.log("\nMigration complete.");
}

migrate().catch(console.error);
