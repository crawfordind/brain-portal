import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrateNotifications() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Running notification system migration...\n");

  const statements = [
    // Notifications table
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN (
        'reminder_due', 'task_overdue', 'task_due_soon',
        'daily_digest', 'weekly_report',
        'agent_complete', 'agent_failed',
        'insight_generated', 'streak_milestone',
        'project_stalled', 'system'
      )),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      is_read INTEGER DEFAULT 0,
      is_emailed INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      entity_type TEXT,
      entity_id TEXT,
      action_url TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      read_at TEXT,
      archived_at TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, type)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id)`,

    // Notification preferences table
    `CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_enabled INTEGER DEFAULT 1,
      email_reminders INTEGER DEFAULT 1,
      email_overdue_tasks INTEGER DEFAULT 1,
      email_daily_digest INTEGER DEFAULT 1,
      email_weekly_report INTEGER DEFAULT 1,
      email_agent_updates INTEGER DEFAULT 1,
      daily_digest_hour INTEGER DEFAULT 8,
      weekly_report_day INTEGER DEFAULT 1,
      quiet_hours_start INTEGER DEFAULT 22,
      quiet_hours_end INTEGER DEFAULT 7,
      timezone TEXT DEFAULT 'UTC',
      overdue_reminder_hours INTEGER DEFAULT 2,
      due_soon_hours INTEGER DEFAULT 24,
      ai_digest_enabled INTEGER DEFAULT 1,
      ai_weekly_enabled INTEGER DEFAULT 1,
      last_daily_digest TEXT,
      last_weekly_report TEXT,
      last_notification_check TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id)`,
  ];

  for (const sql of statements) {
    try {
      await db.execute(sql);
      const tableName = sql.match(/(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)?.[1];
      console.log(`  ✓ ${tableName}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${msg}`);
      console.error(`    SQL: ${sql.substring(0, 80)}...`);
    }
  }

  console.log("\nNotification system migration complete!");
}

migrateNotifications().catch(console.error);
