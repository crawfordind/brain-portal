/**
 * Schema for whiteboards. Additive only: two new tables and their indexes.
 * Takes a client rather than importing one, so `scripts/migrate.ts` and the
 * in-memory tests run exactly this code (same pattern as `sharing/schema.ts`).
 *
 * Design notes:
 *
 *   - One board per project and one per note, enforced by partial UNIQUE
 *     indexes on `scope`. Both foreign keys cascade, so deleting the note or
 *     project deletes its board, and the board's items with it.
 *   - `user_id` is the owner of the project or note, not whoever created the
 *     board: a collaborator opening a project's board for the first time
 *     must not end up owning it.
 *   - `version` is bumped by every write; each item records the version that
 *     last wrote it (`rev`). A client asks for `rev > n` to see what changed
 *     since it last looked, which is how an agent's stickies appear on an open
 *     canvas without a reload.
 *   - Items carry the same four provenance columns as notes and tasks, so a
 *     sticky an MCP key wrote says so.
 *   - `kind`, `color` and `ref_type` have no CHECK, so adding one later is not
 *     a table rebuild; `normalizeItemInput` validates them.
 */

import type { Client } from "@libsql/client";

export const WHITEBOARD_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "whiteboards",
    sql: `CREATE TABLE IF NOT EXISTS whiteboards (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope TEXT NOT NULL CHECK (scope IN ('project', 'note')),
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    label: "idx_whiteboards_project",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_whiteboards_project ON whiteboards(project_id) WHERE scope = 'project'`,
  },
  {
    label: "idx_whiteboards_note",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_whiteboards_note ON whiteboards(note_id) WHERE scope = 'note'`,
  },
  {
    label: "idx_whiteboards_user",
    sql: `CREATE INDEX IF NOT EXISTS idx_whiteboards_user ON whiteboards(user_id, updated_at DESC)`,
  },
  {
    label: "whiteboard_items",
    sql: `CREATE TABLE IF NOT EXISTS whiteboard_items (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      w REAL NOT NULL DEFAULT 0,
      h REAL NOT NULL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'yellow',
      props TEXT NOT NULL DEFAULT '{}',
      from_item_id TEXT,
      to_item_id TEXT,
      ref_type TEXT,
      ref_id TEXT,
      rev INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      source_actor TEXT,
      source_key_id TEXT,
      source_label TEXT,
      source_run_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    label: "idx_whiteboard_items_board",
    sql: `CREATE INDEX IF NOT EXISTS idx_whiteboard_items_board ON whiteboard_items(board_id, rev)`,
  },
  {
    label: "idx_whiteboard_items_ref",
    sql: `CREATE INDEX IF NOT EXISTS idx_whiteboard_items_ref ON whiteboard_items(ref_type, ref_id)`,
  },
];

export async function applyWhiteboardMigration(
  client: Pick<Client, "execute">,
  log: (message: string) => void = () => {}
): Promise<void> {
  for (const { label, sql } of WHITEBOARD_STATEMENTS) {
    await client.execute(sql);
    log(`✓ ${label}`);
  }
}

/** True when an error means the tables above have not been created yet. */
export function isMissingWhiteboardTables(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*whiteboard/i.test(message);
}
