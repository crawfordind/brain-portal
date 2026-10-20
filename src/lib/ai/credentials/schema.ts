/**
 * Schema for personal AI provider keys.
 *
 * Additive only: one table. Takes a client rather than importing one, so
 * `scripts/migrate.ts`, the standalone MCP server and the in-memory tests all
 * run exactly this code (same pattern as `sharing/schema.ts`).
 *
 * - One row per (user, provider). Saving a key again replaces it.
 * - `encrypted_key` is never the key: see `crypto.ts`. `key_hint` ("sk-ant-…a1b2")
 *   is what Settings shows.
 * - `status` / `last_error` record the last test or real call, so Settings can
 *   say "OpenAI rejected this key" instead of leaving the person to wonder why
 *   nothing works.
 * - Deleting the user deletes their keys.
 */

import type { Client } from "@libsql/client";

export const USER_AI_KEYS_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "user_ai_keys",
    sql: `CREATE TABLE IF NOT EXISTS user_ai_keys (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_hint TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider)
    )`,
  },
];

/**
 * Columns added after the table first shipped. `refresh_lock_until` is a
 * short lease that serializes refreshing a ChatGPT sign-in: its refresh token
 * works once, so two server instances refreshing together would lock the
 * person out.
 */
export const USER_AI_KEYS_COLUMNS: Array<{ label: string; sql: string }> = [
  { label: "user_ai_keys.refresh_lock_until", sql: "ALTER TABLE user_ai_keys ADD COLUMN refresh_lock_until TEXT" },
];

export async function applyUserAiKeysMigration(
  client: Pick<Client, "execute">,
  log: (message: string) => void = () => {}
): Promise<void> {
  for (const { label, sql } of USER_AI_KEYS_STATEMENTS) {
    await client.execute(sql);
    log(`✓ ${label}`);
  }
  for (const { label, sql } of USER_AI_KEYS_COLUMNS) {
    try {
      await client.execute(sql);
      log(`✓ ${label}`);
    } catch (error) {
      if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error;
      log(`✓ ${label} (already there)`);
    }
  }
}

/** True when an error means the table above has not been created yet. */
export function isMissingUserAiKeysTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*user_ai_keys/i.test(message);
}
