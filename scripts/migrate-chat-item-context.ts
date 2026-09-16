/**
 * Migration: allow `item` as a chat context type.
 *
 * "Ask about this" pins a conversation to a single note / capture / task /
 * reminder / insight. `chat_conversations.context_type` is guarded by a CHECK
 * constraint that predates that, so inserting one fails outright.
 *
 * SQLite cannot alter a CHECK in place, so the table is rebuilt. Two details
 * matter, and Turso permits only one of the pragmas that would normally handle
 * them:
 *
 *  - The rename direction is chosen so `legacy_alter_table` is never needed.
 *    Turso's SQL layer rejects that pragma outright (`SQL_PARSE_ERROR: SQL not
 *    allowed statement`), which is why this migration used to abort halfway and
 *    leave the CHECK un-widened. Renaming the *new* table onto the real name
 *    means no other table's foreign key mentions the name being renamed, so
 *    there is nothing for SQLite to rewrite.
 *  - `foreign_keys=OFF` for the swap, so dropping the old table doesn't
 *    cascade-delete every message. That pragma *is* allowed, but it is session
 *    state on a pooled HTTP connection, so it is not trusted on its own:
 *    `chat_messages` is copied to a plain backup table first and any rows a
 *    cascade did remove are restored afterwards.
 *
 * Idempotent: it inspects the stored DDL first and exits if `item` is already
 * permitted.
 *
 * Run with: npx tsx scripts/migrate-chat-item-context.ts
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

  console.log("Allowing 'item' as a chat context type...\n");

  const existing = await db.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_conversations'",
    args: [],
  });

  if (existing.rows.length === 0) {
    console.log("  chat_conversations does not exist yet — schema.ts will create it correctly.");
    console.log("\nDone.");
    return;
  }

  const ddl = String(existing.rows[0].sql ?? "");
  if (ddl.includes("'item'")) {
    console.log("  Already allows 'item'. Nothing to do.");
    console.log("\nDone.");
    return;
  }

  console.log("  Rebuilding chat_conversations with the widened CHECK...");

  const countOf = async (table: string) =>
    Number((await db.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);

  const messagesBefore = await countOf("chat_messages");

  await db.execute("PRAGMA foreign_keys = OFF");

  try {
    // A plain copy: no foreign key, so nothing can cascade it away.
    await db.execute("DROP TABLE IF EXISTS chat_messages_migration_backup");
    await db.execute(
      "CREATE TABLE chat_messages_migration_backup AS SELECT * FROM chat_messages"
    );

    await db.execute("DROP TABLE IF EXISTS chat_conversations_new");
    await db.execute(`
      CREATE TABLE chat_conversations_new (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT DEFAULT 'New Chat',
        agent_type TEXT NOT NULL DEFAULT 'general',
        context_type TEXT NOT NULL DEFAULT 'general'
          CHECK (context_type IN ('executive', 'project', 'note', 'task', 'item', 'general')),
        context_id TEXT,
        model TEXT,
        message_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    await db.execute(`
      INSERT INTO chat_conversations_new
        (id, user_id, title, agent_type, context_type, context_id, model, message_count, created_at, updated_at)
      SELECT id, user_id, title, agent_type, context_type, context_id, model, message_count, created_at, updated_at
      FROM chat_conversations
    `);

    console.log(`  Copied ${await countOf("chat_conversations_new")} conversation(s).`);

    await db.execute("DROP TABLE chat_conversations");
    await db.execute("ALTER TABLE chat_conversations_new RENAME TO chat_conversations");

    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations(user_id, updated_at DESC)"
    );

    // Restore anything a cascade took with the dropped table.
    const messagesAfter = await countOf("chat_messages");
    if (messagesAfter < messagesBefore) {
      await db.execute(
        "INSERT OR IGNORE INTO chat_messages SELECT * FROM chat_messages_migration_backup"
      );
      console.log(
        `  Restored ${(await countOf("chat_messages")) - messagesAfter} message(s) lost to the cascade.`
      );
    }

    const restored = await countOf("chat_messages");
    if (restored !== messagesBefore) {
      console.error(
        `\n  ABORT: chat_messages holds ${restored} row(s), expected ${messagesBefore}. ` +
          `The copy is still in chat_messages_migration_backup.`
      );
      process.exit(1);
    }
    console.log(`  ${restored} message(s) intact.`);

    await db.execute("DROP TABLE chat_messages_migration_backup");
  } finally {
    await db.execute("PRAGMA foreign_keys = ON");
  }

  const check = await db.execute("PRAGMA foreign_key_check");
  if (check.rows.length > 0) {
    console.error(`\n  WARNING: ${check.rows.length} foreign key violation(s) after rebuild.`);
    process.exit(1);
  }

  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
