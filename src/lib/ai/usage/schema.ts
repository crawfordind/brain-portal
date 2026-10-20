/**
 * Schema for AI usage. Additive only: two tables. Takes a client rather than
 * importing one, so `scripts/migrate.ts` and the in-memory tests run exactly
 * this code (same pattern as `credentials/schema.ts`).
 *
 * - `ai_usage_events`: one row per model call, with the prompt as sent
 *   (trimmed). Pruned to the last 30 days and 500 rows per account.
 * - `ai_usage_totals`: the running total per (account, provider, model, whose
 *   key). Never pruned, so the totals outlive the event log.
 */

import type { Client } from "@libsql/client";

export const AI_USAGE_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "ai_usage_events",
    sql: `CREATE TABLE IF NOT EXISTS ai_usage_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      slot TEXT,
      purpose TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  },
  {
    label: "idx_ai_usage_events_user",
    sql: `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user ON ai_usage_events(user_id, created_at DESC)`,
  },
  {
    label: "ai_usage_totals",
    sql: `CREATE TABLE IF NOT EXISTS ai_usage_totals (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      source TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      first_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (user_id, provider, model, source)
    )`,
  },
];

export async function applyAiUsageMigration(
  client: Pick<Client, "execute">,
  log: (message: string) => void = () => {}
): Promise<void> {
  for (const { label, sql } of AI_USAGE_STATEMENTS) {
    await client.execute(sql);
    log(`✓ ${label}`);
  }
}

/** True when an error means the tables above have not been created yet. */
export function isMissingAiUsageTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*ai_usage_(events|totals)/i.test(message);
}
