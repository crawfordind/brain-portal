/**
 * Migration: Add MCP API Keys table
 *
 * Creates the mcp_api_keys table for authenticating MCP server connections.
 * Keys are SHA-256 hashed before storage. Each key is scoped to a user
 * with configurable permissions, rate limits, and expiration.
 *
 * Run: npx tsx scripts/migrate-add-mcp-api-keys.ts
 */

import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

async function migrate() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Creating mcp_api_keys table...");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT DEFAULT '["*"]',
      is_active BOOLEAN DEFAULT TRUE,
      rate_limit_per_minute INTEGER DEFAULT 60,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_hash ON mcp_api_keys(key_hash)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_user ON mcp_api_keys(user_id)`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_active ON mcp_api_keys(is_active, expires_at)`
  );

  console.log("mcp_api_keys table created successfully.");

  // Verify
  const result = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_api_keys'"
  );
  console.log(
    result.rows.length > 0
      ? "Verified: mcp_api_keys table exists."
      : "ERROR: Table was not created!"
  );
}

migrate().catch(console.error);
