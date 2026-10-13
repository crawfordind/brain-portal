/**
 * Who may see or change a note, decided in one place.
 *
 * A note is reachable three ways: the viewer owns it, it sits in a project the
 * viewer collaborates on, or its owner shared it with the viewer's account.
 * Every reader (the note API, the MCP `get_note` tool) asks this module rather
 * than writing its own join, so the three routes cannot drift apart.
 *
 * Owned notes always win a lookup. Slugs are unique per user, not globally,
 * so before this a slug shared by the viewer's own note and a collaborator's
 * note could open either one.
 */

import { db, queryOne } from "@/lib/db/client";
import type { Note } from "@/lib/db/schema";
import { isMissingNoteSharesTable } from "./schema";
import {
  isNoteSharePermission,
  roleForPermission,
  strongestRole,
  type NoteAccessVia,
  type NoteRole,
  type NoteSharePermission,
} from "./types";

export type AccessibleNote = Note & { project_name: string | null };

export interface NoteAccess {
  note: AccessibleNote;
  role: NoteRole;
  via: NoteAccessVia;
  /** Present when an account share applies, whether or not it is the strongest grant. */
  share: { permission: NoteSharePermission; ownerEmail: string; ownerName: string | null } | null;
}

interface SharedRow extends AccessibleNote {
  project_role: string | null;
  share_permission: string | null;
  owner_email: string | null;
  owner_name: string | null;
}

/**
 * Match a share row to a viewer: bound to their account, or still addressed to
 * their email and not yet bound to anyone.
 */
export const SHARE_RECIPIENT_MATCH = `(ns.recipient_user_id = ?
  OR (ns.recipient_user_id IS NULL AND ns.recipient_email = (SELECT lower(email) FROM users WHERE id = ?)))`;

/**
 * Bind any shares addressed to this user's email to their account.
 *
 * Idempotent and cheap (indexed on email). Run before reading shares so that
 * a share sent before the account existed behaves exactly like any other from
 * the first read on, including if the user later changes address.
 */
export async function claimPendingShares(userId: string): Promise<void> {
  try {
    await db.execute({
      sql: `UPDATE note_shares
            SET recipient_user_id = ?, updated_at = datetime('now')
            WHERE recipient_user_id IS NULL
              AND recipient_email = (SELECT lower(email) FROM users WHERE id = ?)`,
      args: [userId, userId],
    });
  } catch (error) {
    if (!isMissingNoteSharesTable(error)) throw error;
  }
}

/**
 * Resolve a note by id or slug for a viewer, with the role they hold on it.
 * Returns null when the note does not exist *or* the viewer has no access —
 * the two are deliberately indistinguishable.
 */
export async function getNoteAccess(idOrSlug: string, userId: string): Promise<NoteAccess | null> {
  if (!idOrSlug) return null;

  const owned = await queryOne<AccessibleNote>(
    `SELECT n.*, p.name as project_name
     FROM notes n
     LEFT JOIN projects p ON n.project_id = p.id
     WHERE n.user_id = ? AND (n.id = ? OR n.slug = ?)
     ORDER BY (n.id = ?) DESC
     LIMIT 1`,
    [userId, idOrSlug, idOrSlug, idOrSlug]
  );
  if (owned) return { note: owned, role: "owner", via: "owner", share: null };

  await claimPendingShares(userId);

  let row: SharedRow | null;
  try {
    row = await queryOne<SharedRow>(sharedLookupSql(true), sharedLookupArgs(idOrSlug, userId, true));
  } catch (error) {
    // A database that has not run the sharing migration yet still serves
    // project collaborators exactly as before, rather than failing every read.
    if (!isMissingNoteSharesTable(error)) throw error;
    row = await queryOne<SharedRow>(sharedLookupSql(false), sharedLookupArgs(idOrSlug, userId, false));
  }
  if (!row) return null;

  const projectGrant =
    row.project_role === "editor" || row.project_role === "viewer"
      ? { role: row.project_role as NoteRole, via: "project" as const }
      : null;
  const sharePermission = isNoteSharePermission(row.share_permission) ? row.share_permission : null;
  const shareGrant = sharePermission
    ? { role: roleForPermission(sharePermission), via: "share" as const }
    : null;

  const best = strongestRole(projectGrant, shareGrant);
  if (!best) return null;

  const { project_role, share_permission, owner_email, owner_name, ...note } = row;
  void project_role;
  void share_permission;

  return {
    note: note as AccessibleNote,
    role: best.role,
    via: best.via,
    share: sharePermission
      ? { permission: sharePermission, ownerEmail: owner_email ?? "", ownerName: owner_name }
      : null,
  };
}

function sharedLookupSql(withShares: boolean): string {
  const share = withShares
    ? `(SELECT ns.permission FROM note_shares ns
         WHERE ns.note_id = n.id AND ${SHARE_RECIPIENT_MATCH}
         LIMIT 1)`
    : "NULL";
  return `SELECT * FROM (
      SELECT n.*, p.name as project_name,
             (SELECT pc.role FROM project_collaborators pc
               WHERE pc.project_id = n.project_id AND pc.user_id = ? AND pc.status = 'accepted'
               LIMIT 1) as project_role,
             ${share} as share_permission,
             u.email as owner_email,
             u.display_name as owner_name
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      LEFT JOIN users u ON u.id = n.user_id
      WHERE (n.id = ? OR n.slug = ?) AND n.user_id != ?
    )
    WHERE project_role IS NOT NULL OR share_permission IS NOT NULL
    ORDER BY (id = ?) DESC, updated_at DESC
    LIMIT 1`;
}

function sharedLookupArgs(idOrSlug: string, userId: string, withShares: boolean): string[] {
  return [
    userId,
    ...(withShares ? [userId, userId] : []),
    idOrSlug,
    idOrSlug,
    userId,
    idOrSlug,
  ];
}

/**
 * The fields a non-owner must never receive. `share_token` is the owner's
 * public link: a viewer who could read it could publish the note to anyone.
 */
export function redactForViewer<T extends Partial<Note>>(note: T, role: NoteRole): T {
  if (role === "owner") return note;
  const copy = { ...note };
  if ("share_token" in copy) copy.share_token = null;
  if ("shared_at" in copy) copy.shared_at = null;
  return copy;
}
