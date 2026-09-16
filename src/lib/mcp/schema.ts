/**
 * Schema bootstrap for the `mcp_api_keys` table.
 *
 * The table is also created by the main `scripts/migrate.ts`, but Vercel
 * builds run the migration during `prebuild` — older deployments may
 * have shipped before the table was added to that script. To avoid
 * surfacing "no such table: mcp_api_keys" to the user, the API routes
 * call `ensureMcpKeysTable()` once per process before touching it.
 *
 * After the first successful call we set a module-scoped flag so we
 * don't pay the round-trip on every request.
 */

import { db } from "@/lib/db/client";

let ensured = false;
let inflight: Promise<void> | null = null;

async function bootstrap(): Promise<void> {
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
  ensured = true;
}

export async function ensureMcpKeysTable(): Promise<void> {
  if (ensured) return;
  if (!inflight) {
    inflight = bootstrap().finally(() => {
      inflight = null;
    });
  }
  await inflight;
}
