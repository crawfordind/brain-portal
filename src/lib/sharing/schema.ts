/**
 * Schema for account-to-account note sharing.
 *
 * Additive only: one new table and its indexes. Takes a client rather than
 * importing one, so `scripts/migrate.ts` and the in-memory tests run exactly
 * this code (same pattern as `agents/runtime/schema.ts`).
 *
 * Design notes:
 *
 *   - `recipient_email` is the identity of a share, and is UNIQUE per note, so
 *     sharing the same note with the same address twice updates the one row.
 *   - `recipient_user_id` is NULL until that address has an account. A share
 *     to an address that signs up (or is created by the operator) later starts
 *     working then, with no second step; the row is bound to the account the
 *     first time it is read.
 *   - Revoking is a DELETE. There is no "revoked" state to forget to check.
 *   - Both foreign keys cascade: deleting the note, the owner or the recipient
 *     removes the share.
 *   - `permission` has no CHECK, so adding a level later is not a table
 *     rebuild; the application validates it (`isNoteSharePermission`).
 */

import type { Client } from "@libsql/client";

export const NOTE_SHARES_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "note_shares",
    sql: `CREATE TABLE IF NOT EXISTS note_shares (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      recipient_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'view',
      created_via TEXT NOT NULL DEFAULT 'app',
      source_key_id TEXT,
      source_label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(note_id, recipient_email)
    )`,
  },
  {
    label: "idx_note_shares_recipient_user",
    sql: `CREATE INDEX IF NOT EXISTS idx_note_shares_recipient_user ON note_shares(recipient_user_id)`,
  },
  {
    label: "idx_note_shares_recipient_email",
    sql: `CREATE INDEX IF NOT EXISTS idx_note_shares_recipient_email ON note_shares(recipient_email)`,
  },
  {
    label: "idx_note_shares_owner",
    sql: `CREATE INDEX IF NOT EXISTS idx_note_shares_owner ON note_shares(owner_id, created_at DESC)`,
  },
];

export async function applyNoteSharingMigration(
  client: Pick<Client, "execute">,
  log: (message: string) => void = () => {}
): Promise<void> {
  for (const { label, sql } of NOTE_SHARES_STATEMENTS) {
    await client.execute(sql);
    log(`✓ ${label}`);
  }
}

/** True when an error means the table above has not been created yet. */
export function isMissingNoteSharesTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such table:\s*note_shares/i.test(message);
}
