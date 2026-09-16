import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrateGuardrails() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Running guardrails migration...\n");

  const statements = [
    // User guardrails — stores the user's identity, beliefs, and AI interaction preferences
    `CREATE TABLE IF NOT EXISTS user_guardrails (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Identity: who the user is (role, expertise, context)
      personal_context TEXT DEFAULT '',
      -- Beliefs: core values, worldview, principles
      beliefs TEXT DEFAULT '',
      -- Communication style: how AI should respond
      communication_style TEXT DEFAULT '',
      -- Topics to always emphasize (JSON array)
      topics_to_emphasize TEXT DEFAULT '[]',
      -- Topics to avoid (JSON array)
      topics_to_avoid TEXT DEFAULT '[]',
      -- Custom instructions: free-form additional directives
      custom_instructions TEXT DEFAULT '',
      -- System-managed: auto-learned preferences from interactions
      learned_context TEXT DEFAULT '{}',
      -- Evolution tracking
      interaction_count INTEGER DEFAULT 0,
      last_evolved_at TEXT,
      evolution_version INTEGER DEFAULT 0,
      -- Active toggle
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE INDEX IF NOT EXISTS idx_guardrails_user ON user_guardrails(user_id)`,
  ];

  for (const sql of statements) {
    try {
      await db.execute(sql);
      const preview = sql.trim().substring(0, 60);
      console.log(`  OK: ${preview}...`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("already exists")) {
        console.log(`  SKIP (exists): ${sql.trim().substring(0, 60)}...`);
      } else {
        console.error(`  FAIL: ${sql.trim().substring(0, 60)}...`);
        console.error(`  Error: ${msg}`);
      }
    }
  }

  console.log("\nGuardrails migration complete!");
}

migrateGuardrails().catch(console.error);
