import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log("Adding heartbeat scheduler tables...");

  try {
    // Heartbeat tasks - the declarative manifest of what to check and when
    await db.execute(`
      CREATE TABLE IF NOT EXISTS heartbeat_tasks (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        check_type TEXT NOT NULL CHECK (check_type IN ('db_query', 'rule_eval', 'stale_check')),
        check_source TEXT NOT NULL,
        condition TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK (action_type IN ('create_notification', 'delegate_to_agent', 'enqueue_processing')),
        action_params TEXT DEFAULT '{}',
        schedule TEXT NOT NULL DEFAULT '30m',
        enabled INTEGER DEFAULT 1,
        owner TEXT NOT NULL DEFAULT 'user' CHECK (owner IN ('system', 'operator', 'user')),
        notify_channel TEXT DEFAULT 'in_app' CHECK (notify_channel IN ('in_app', 'email', 'both')),
        last_run_at TEXT,
        last_result TEXT,
        run_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, name)
      )
    `);
    console.log("Created heartbeat_tasks table");

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_user ON heartbeat_tasks(user_id)
    `);
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_enabled ON heartbeat_tasks(enabled, schedule)
    `);
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_owner ON heartbeat_tasks(owner)
    `);
    console.log("Created heartbeat_tasks indexes");

    // Heartbeat logs - full audit trail of every execution
    await db.execute(`
      CREATE TABLE IF NOT EXISTS heartbeat_logs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        heartbeat_task_id TEXT NOT NULL REFERENCES heartbeat_tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tick_time TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL CHECK (status IN ('ok', 'triggered', 'error', 'skipped')),
        items_evaluated INTEGER DEFAULT 0,
        items_dispatched INTEGER DEFAULT 0,
        action_taken TEXT,
        result_summary TEXT,
        error_message TEXT,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    console.log("Created heartbeat_logs table");

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_task ON heartbeat_logs(heartbeat_task_id, created_at DESC)
    `);
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_user ON heartbeat_logs(user_id, created_at DESC)
    `);
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_status ON heartbeat_logs(status, created_at DESC)
    `);
    console.log("Created heartbeat_logs indexes");

    console.log("\nMigration complete");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await db.close();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
