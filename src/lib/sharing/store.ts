/**
 * Account-to-account note sharing: every read and write of `note_shares`.
 *
 * Used by the API routes and by the MCP tools (which run outside Next.js), so
 * it imports only the shared DB client and pure modules. Every function takes
 * the acting user's id and checks ownership itself; callers cannot forget to.
 */

import { db, query, queryOne } from "@/lib/db/client";
import { claimPendingShares } from "./access";
import {
  MAX_SHARES_PER_NOTE,
  isNoteSharePermission,
  isValidEmail,
  normalizeEmail,
  parseSavedRecipients,
  validateSavedRecipients,
  type NoteSharePermission,
  type SavedRecipient,
} from "./types";

export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "ShareError";
  }
}

export interface NoteShare {
  id: string;
  note_id: string;
  recipient_email: string;
  recipient_user_id: string | null;
  /** The recipient account's display name, when it exists. */
  recipient_name: string | null;
  /** False while the address has no account on this instance. */
  recipient_has_account: boolean;
  permission: NoteSharePermission;
  created_via: string;
  source_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedWithMeNote {
  share_id: string;
  note_id: string;
  title: string;
  excerpt: string;
  note_type: string;
  is_archived: boolean;
  word_count: number;
  permission: NoteSharePermission;
  owner_email: string;
  owner_name: string | null;
  shared_at: string;
  updated_at: string;
}

export interface ShareOrigin {
  /** `app` for the web UI, `mcp` for an MCP key. */
  via: "app" | "mcp";
  keyId?: string | null;
  keyName?: string | null;
}

const SHARE_COLUMNS = `ns.id, ns.note_id, ns.recipient_email, ns.recipient_user_id,
  ns.permission, ns.created_via, ns.source_label, ns.created_at, ns.updated_at,
  u.display_name as recipient_name,
  COALESCE(ns.recipient_user_id, u.id) as resolved_user_id`;

interface ShareRow extends Omit<NoteShare, "recipient_has_account" | "permission"> {
  permission: string;
  resolved_user_id: string | null;
}

function toShare(row: ShareRow): NoteShare {
  return {
    id: row.id,
    note_id: row.note_id,
    recipient_email: row.recipient_email,
    recipient_user_id: row.recipient_user_id,
    recipient_name: row.recipient_name ?? null,
    recipient_has_account: !!row.resolved_user_id,
    permission: isNoteSharePermission(row.permission) ? row.permission : "view",
    created_via: row.created_via,
    source_label: row.source_label,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * The owner's note by id or slug (agents sometimes pass the slug they were
 * shown). Everything after this uses the resolved id.
 */
async function requireOwnedNote(ownerId: string, noteIdOrSlug: string) {
  const note = await queryOne<{ id: string; title: string; user_id: string }>(
    `SELECT id, title, user_id FROM notes
     WHERE user_id = ? AND (id = ? OR slug = ?)
     ORDER BY (id = ?) DESC
     LIMIT 1`,
    [ownerId, noteIdOrSlug, noteIdOrSlug, noteIdOrSlug]
  );
  if (!note) throw new ShareError("Note not found", 404);
  return note;
}

/** Shares on one note, for its owner. */
export async function listNoteShares(ownerId: string, noteIdOrSlug: string): Promise<NoteShare[]> {
  const { id: noteId } = await requireOwnedNote(ownerId, noteIdOrSlug);
  const rows = await query<ShareRow>(
    `SELECT ${SHARE_COLUMNS}
     FROM note_shares ns
     LEFT JOIN users u ON u.id = ns.recipient_user_id
        OR (ns.recipient_user_id IS NULL AND lower(u.email) = ns.recipient_email)
     WHERE ns.note_id = ? AND ns.owner_id = ?
     ORDER BY ns.created_at ASC`,
    [noteId, ownerId]
  );
  return rows.map(toShare);
}

/** Every share this user has made, newest first, with the note's title. */
export async function listOutgoingShares(
  ownerId: string,
  limit = 100
): Promise<Array<NoteShare & { note_title: string }>> {
  const rows = await query<ShareRow & { note_title: string }>(
    `SELECT ${SHARE_COLUMNS}, n.title as note_title
     FROM note_shares ns
     JOIN notes n ON n.id = ns.note_id
     LEFT JOIN users u ON u.id = ns.recipient_user_id
        OR (ns.recipient_user_id IS NULL AND lower(u.email) = ns.recipient_email)
     WHERE ns.owner_id = ?
     ORDER BY ns.created_at DESC
     LIMIT ?`,
    [ownerId, limit]
  );
  return rows.map((r) => ({ ...toShare(r), note_title: r.note_title }));
}

/**
 * Share a note with another account, or change the permission of an existing
 * share with the same address. Idempotent: sharing twice is one row.
 */
export async function shareNote(input: {
  ownerId: string;
  noteId: string;
  email: string;
  permission?: NoteSharePermission;
  origin: ShareOrigin;
}): Promise<{ share: NoteShare; created: boolean; noteTitle: string }> {
  const permission = input.permission ?? "view";
  if (!isNoteSharePermission(permission)) throw new ShareError("permission must be 'view' or 'edit'");
  if (!isValidEmail(input.email)) throw new ShareError("A valid email address is required");
  const email = normalizeEmail(input.email);

  const note = await requireOwnedNote(input.ownerId, input.noteId);

  const owner = await queryOne<{ email: string; display_name: string | null }>(
    "SELECT email, display_name FROM users WHERE id = ?",
    [input.ownerId]
  );
  if (owner && normalizeEmail(owner.email) === email) {
    throw new ShareError("That's your own account — you already have this note");
  }

  const recipient = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = ?",
    [email]
  );
  if (recipient?.id === input.ownerId) {
    throw new ShareError("That's your own account — you already have this note");
  }

  const existing = await queryOne<{ id: string; permission: string }>(
    "SELECT id, permission FROM note_shares WHERE note_id = ? AND recipient_email = ?",
    [note.id, email]
  );

  if (!existing) {
    const count = await queryOne<{ n: number }>(
      "SELECT COUNT(*) as n FROM note_shares WHERE note_id = ?",
      [note.id]
    );
    if ((count?.n ?? 0) >= MAX_SHARES_PER_NOTE) {
      throw new ShareError(`A note can be shared with at most ${MAX_SHARES_PER_NOTE} accounts`, 409);
    }
  }

  // ON CONFLICT rather than check-then-insert: two quick clicks, or an agent
  // retrying a call, must not produce two rows or a constraint error.
  await db.execute({
    sql: `INSERT INTO note_shares
            (note_id, owner_id, recipient_email, recipient_user_id, permission,
             created_via, source_key_id, source_label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(note_id, recipient_email) DO UPDATE SET
            permission = excluded.permission,
            recipient_user_id = COALESCE(note_shares.recipient_user_id, excluded.recipient_user_id),
            updated_at = datetime('now')`,
    args: [
      note.id,
      input.ownerId,
      email,
      recipient?.id ?? null,
      permission,
      input.origin.via,
      input.origin.keyId ?? null,
      input.origin.keyName ?? null,
    ],
  });

  const share = (await listNoteShares(input.ownerId, note.id)).find((s) => s.recipient_email === email);
  if (!share) throw new Error("Share was written but could not be read back");

  const created = !existing;
  if (created && recipient) {
    await notifyRecipient({
      recipientId: recipient.id,
      noteId: note.id,
      noteTitle: note.title,
      ownerLabel: owner?.display_name || owner?.email || "Someone",
      permission,
    });
  }

  return { share, created, noteTitle: note.title };
}

/** Change one share's permission. */
export async function updateSharePermission(
  ownerId: string,
  noteIdOrSlug: string,
  shareId: string,
  permission: unknown
): Promise<NoteShare> {
  if (!isNoteSharePermission(permission)) throw new ShareError("permission must be 'view' or 'edit'");
  const { id: noteId } = await requireOwnedNote(ownerId, noteIdOrSlug);
  const result = await db.execute({
    sql: `UPDATE note_shares SET permission = ?, updated_at = datetime('now')
          WHERE id = ? AND note_id = ? AND owner_id = ?`,
    args: [permission, shareId, noteId, ownerId],
  });
  if (result.rowsAffected === 0) throw new ShareError("Share not found", 404);
  const share = (await listNoteShares(ownerId, noteId)).find((s) => s.id === shareId);
  if (!share) throw new ShareError("Share not found", 404);
  return share;
}

/**
 * Revoke by share id or by address. Returns how many shares were removed;
 * revoking something already revoked is 0, not an error, so it is safe to retry.
 */
export async function revokeShare(
  ownerId: string,
  noteIdOrSlug: string,
  target: { shareId: string } | { email: string }
): Promise<number> {
  const { id: noteId } = await requireOwnedNote(ownerId, noteIdOrSlug);
  const result =
    "shareId" in target
      ? await db.execute({
          sql: "DELETE FROM note_shares WHERE id = ? AND note_id = ? AND owner_id = ?",
          args: [target.shareId, noteId, ownerId],
        })
      : await db.execute({
          sql: "DELETE FROM note_shares WHERE recipient_email = ? AND note_id = ? AND owner_id = ?",
          args: [normalizeEmail(target.email), noteId, ownerId],
        });
  return result.rowsAffected;
}

/** Notes other accounts have shared with this user, most recently changed first. */
export async function listSharedWithMe(
  userId: string,
  options: { limit?: number; includeArchived?: boolean } = {}
): Promise<SharedWithMeNote[]> {
  await claimPendingShares(userId);
  const rows = await query<{
    share_id: string;
    note_id: string;
    title: string;
    content_plain: string | null;
    note_type: string;
    is_archived: number;
    word_count: number | null;
    permission: string;
    owner_email: string;
    owner_name: string | null;
    shared_at: string;
    updated_at: string;
  }>(
    `SELECT ns.id as share_id, n.id as note_id, n.title, n.content_plain, n.note_type,
            n.is_archived, n.word_count, ns.permission,
            u.email as owner_email, u.display_name as owner_name,
            ns.created_at as shared_at, n.updated_at
     FROM note_shares ns
     JOIN notes n ON n.id = ns.note_id
     JOIN users u ON u.id = n.user_id
     WHERE ns.recipient_user_id = ?
       ${options.includeArchived ? "" : "AND n.is_archived = 0"}
     ORDER BY n.updated_at DESC
     LIMIT ?`,
    [userId, Math.min(Math.max(options.limit ?? 50, 1), 200)]
  );
  return rows.map((r) => ({
    share_id: r.share_id,
    note_id: r.note_id,
    title: r.title,
    excerpt: (r.content_plain ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    note_type: r.note_type,
    is_archived: !!r.is_archived,
    word_count: r.word_count ?? 0,
    permission: isNoteSharePermission(r.permission) ? r.permission : "view",
    owner_email: r.owner_email,
    owner_name: r.owner_name,
    shared_at: r.shared_at,
    updated_at: r.updated_at,
  }));
}

/** The recipient removes a note from their own "Shared with me". */
export async function leaveShare(userId: string, noteId: string): Promise<number> {
  await claimPendingShares(userId);
  const result = await db.execute({
    sql: "DELETE FROM note_shares WHERE note_id = ? AND recipient_user_id = ?",
    args: [noteId, userId],
  });
  return result.rowsAffected;
}

// ─── Saved recipients ("work" → work@example.com) ─────────────

export async function getSavedRecipients(userId: string): Promise<SavedRecipient[]> {
  const row = await queryOne<{ preferences: string | null }>(
    "SELECT preferences FROM users WHERE id = ?",
    [userId]
  );
  return parseSavedRecipients(row?.preferences);
}

/**
 * Replace the saved recipient list. Read-modify-write on the JSON column that
 * touches only `sharing.recipients`; the blob holds unrelated settings.
 */
export async function setSavedRecipients(userId: string, input: unknown): Promise<SavedRecipient[]> {
  const row = await queryOne<{ preferences: string | null; email: string }>(
    "SELECT preferences, email FROM users WHERE id = ?",
    [userId]
  );
  if (!row) throw new ShareError("User not found", 404);

  const validation = validateSavedRecipients(input, row.email);
  if (!validation.ok) throw new ShareError(validation.error);

  let blob: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.preferences || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      blob = parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt preferences must not block saving recipients.
  }
  const sharing =
    blob.sharing && typeof blob.sharing === "object" && !Array.isArray(blob.sharing)
      ? (blob.sharing as Record<string, unknown>)
      : {};
  blob.sharing = { ...sharing, recipients: validation.recipients };

  await db.execute({
    sql: "UPDATE users SET preferences = ?, updated_at = datetime('now') WHERE id = ?",
    args: [JSON.stringify(blob), userId],
  });
  return validation.recipients;
}

// ─── Notification ─────────────────────────────────────────────

/**
 * Tell the recipient in-app. Written directly rather than through the
 * notification engine, which pulls in system health, email and the agent
 * runtime: the MCP process shares this module and should not load all that to
 * insert one row. A failure here never fails the share itself.
 */
async function notifyRecipient(input: {
  recipientId: string;
  noteId: string;
  noteTitle: string;
  ownerLabel: string;
  permission: NoteSharePermission;
}): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO notifications (user_id, type, title, body, priority, entity_type, entity_id, action_url, metadata)
            VALUES (?, 'system', ?, ?, 'low', 'note', ?, ?, ?)`,
      args: [
        input.recipientId,
        `${input.ownerLabel} shared a note with you`,
        `"${input.noteTitle}" · ${input.permission === "edit" ? "can edit" : "view only"}`,
        input.noteId,
        `/notes/${input.noteId}`,
        JSON.stringify({ kind: "note_shared", permission: input.permission }),
      ],
    });
  } catch (error) {
    console.error("[SHARING] Failed to notify recipient:", error);
  }
}
