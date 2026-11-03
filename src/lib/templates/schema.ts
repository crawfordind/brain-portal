/**
 * Schema for note templates. Additive only: one table and its indexes.
 * Takes a client rather than importing one, so `scripts/migrate.ts` and the
 * tests run exactly this code (same pattern as `whiteboards/schema.ts`).
 *
 *   - Templates belong to an account (`user_id`). `project_id` is optional and
 *     only says which project a template is for (it is offered first there);
 *     deleting the project keeps the template as a general one.
 *   - `source` and `metadata.source_note_ids` record where a template came
 *     from (typed, saved from a note, drafted by AI from a description or from
 *     notes, built from a series' shared headings).
 */

import type { Client } from "@libsql/client";

export const TEMPLATE_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "note_templates",
    sql: `CREATE TABLE IF NOT EXISTS note_templates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      title_pattern TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      metadata TEXT NOT NULL DEFAULT '{}',
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    label: "idx_note_templates_user",
    sql: `CREATE INDEX IF NOT EXISTS idx_note_templates_user ON note_templates(user_id, updated_at DESC)`,
  },
  {
    label: "idx_note_templates_project",
    sql: `CREATE INDEX IF NOT EXISTS idx_note_templates_project ON note_templates(project_id)`,
  },
];

export async function applyTemplateMigration(
  client: Pick<Client, "execute">,
  log: (message: string) => void = () => {}
): Promise<void> {
  for (const { label, sql } of TEMPLATE_STATEMENTS) {
    await client.execute(sql);
    log(`✓ ${label}`);
  }
}

/** True when an error means the table above has not been created yet. */
export function isMissingTemplateTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*note_templates/i.test(message);
}
