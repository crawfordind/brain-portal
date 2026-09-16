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

  let success = 0;
  let skipped = 0;
  let errors = 0;

  // 1. Create journal_entries table
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        entry_text TEXT NOT NULL,
        category TEXT DEFAULT 'general' CHECK (category IN ('general', 'personal', 'work', 'health', 'travel', 'purchase', 'project', 'learning', 'social', 'maintenance')),
        tags TEXT DEFAULT '[]',
        mood TEXT,
        location TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("✓ Created journal_entries table");
    success++;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("already exists")) {
      console.log("○ journal_entries table already exists");
      skipped++;
    } else {
      console.error("✗ Failed to create journal_entries table:", msg);
      errors++;
    }
  }

  // 2. Create monthly_journals table
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS monthly_journals (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        entry_count INTEGER DEFAULT 0,
        summary TEXT,
        categories TEXT DEFAULT '{}',
        highlights TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        compiled_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, year, month)
      )
    `);
    console.log("✓ Created monthly_journals table");
    success++;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("already exists")) {
      console.log("○ monthly_journals table already exists");
      skipped++;
    } else {
      console.error("✗ Failed to create monthly_journals table:", msg);
      errors++;
    }
  }

  // 3. Create indexes
  const indexes = [
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date ON journal_entries(user_id, date)",
      name: "idx_journal_entries_user_date",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_journal_entries_note ON journal_entries(note_id)",
      name: "idx_journal_entries_note",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_journal_entries_category ON journal_entries(category)",
      name: "idx_journal_entries_category",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_monthly_journals_user ON monthly_journals(user_id, year, month)",
      name: "idx_monthly_journals_user",
    },
  ];

  for (const idx of indexes) {
    try {
      await db.execute(idx.sql);
      console.log(`✓ Created index ${idx.name}`);
      success++;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`○ Index ${idx.name}: ${msg}`);
      skipped++;
    }
  }

  // 4. Update notes.note_type CHECK constraint to include 'journal' and 'monthly_journal'
  // SQLite doesn't support ALTER CHECK constraints, so we add the new types via migration note
  // The CHECK constraint is enforced at application level for existing tables
  console.log("○ Note: 'journal' and 'monthly_journal' note_type values enforced at application level");

  console.log(`\nJournal migration complete: ${success} success, ${skipped} skipped, ${errors} errors`);
  await db.close();
}

migrate().catch(console.error);
