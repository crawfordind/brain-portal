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

  // Create the reminders table
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT,
        remind_at TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'dismissed', 'snoozed')),
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        tags TEXT DEFAULT '[]',
        recurrence_rule TEXT,
        snoozed_until TEXT,
        triggered_at TEXT,
        dismissed_at TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("Created reminders table");
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      console.log("reminders table already exists, skipping");
    } else {
      console.error("Failed to create reminders table:", error);
      await db.close();
      process.exit(1);
    }
  }

  // Create indexes
  const indexes = [
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)",
      name: "idx_reminders_user",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)",
      name: "idx_reminders_status",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at)",
      name: "idx_reminders_remind_at",
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id)",
      name: "idx_reminders_project",
    },
  ];

  for (const idx of indexes) {
    try {
      await db.execute(idx.sql);
      console.log(`Created index ${idx.name}`);
    } catch (error: any) {
      console.log(`Index ${idx.name}: ${error.message}`);
    }
  }

  console.log("\nReminders migration complete");
  await db.close();
}

migrate().catch(console.error);
