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

  console.log("Adding chat tables...");

  const statements = [
    `CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'New Chat',
      agent_type TEXT NOT NULL DEFAULT 'general',
      context_type TEXT NOT NULL DEFAULT 'general'
        CHECK (context_type IN ('executive', 'project', 'note', 'task', 'general')),
      context_id TEXT,
      model TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations(user_id, updated_at DESC)`,

    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      agent_type TEXT,
      model_used TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at ASC)`,
  ];

  let successCount = 0;
  let skipCount = 0;

  for (const statement of statements) {
    try {
      await db.execute(statement);
      successCount++;
      const match = statement.match(
        /(?:CREATE\s+(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i
      );
      if (match) {
        console.log(`✓ ${match[1]}`);
      }
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        skipCount++;
        const match = statement.match(
          /(?:CREATE\s+(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i
        );
        if (match) {
          console.log(`○ ${match[1]} (exists)`);
        }
      } else {
        console.error("Migration failed:", error);
        process.exit(1);
      }
    }
  }

  console.log(`\nDone: ${successCount} created, ${skipCount} skipped`);
  await db.close();
}

migrate().catch(console.error);
