/**
 * MCP Tools: sharing notes between accounts.
 *
 * "Share this note with my work account" is `share_note` with
 * `recipient: "work"`. The recipient must be one the user saved in
 * Settings → Sharing. That list is the security boundary: it is written only
 * from a signed-in browser session, never by an MCP key, so an agent that has
 * been talked into it cannot send the user's notes to an address of someone
 * else's choosing. Revoking has no such restriction — taking access away is
 * always safe.
 *
 * The other direction is here too: a key on the receiving account can list
 * what has been shared with it (`list_shared_notes`) and read those notes with
 * `get_note`.
 *
 * Same `src/lib/sharing/*` modules as the web app; no SQL of its own.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, type ToolContext } from "../guard";
import { absoluteUrl } from "@/lib/app-url";
import {
  getSavedRecipients,
  listNoteShares,
  listOutgoingShares,
  listSharedWithMe,
  revokeShare,
  shareNote,
  ShareError,
} from "@/lib/sharing/store";
import { isMissingNoteSharesTable } from "@/lib/sharing/schema";
import { isValidEmail, resolveSavedRecipient } from "@/lib/sharing/types";
import {
  listNoteSharesShape,
  listSharedNotesShape,
  shareNoteShape,
  unshareNoteShape,
} from "@/lib/sharing/tool-schemas";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function failFrom(error: unknown) {
  if (error instanceof ShareError) return fail(error.message);
  if (isMissingNoteSharesTable(error)) {
    return fail("Sharing between accounts isn't set up on this server yet. The operator must run `npm run db:migrate`.");
  }
  throw error;
}

export function registerSharingTools(server: McpServer, ctx: ToolContext) {
  // ─── Share Note ────────────────────────────────────────
  server.tool(
    "share_note",
    'Share a note with another of the user\'s accounts or a saved contact, e.g. "share this with my work account". The recipient sees the live note under "Shared with me" and can read it from their own MCP connection. Only recipients saved in Settings → Sharing are accepted. Sharing again with the same recipient just updates the permission.',
    shareNoteShape,
    async (params) => {
      const guard = ctx.guard("notes:share");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      const saved = await getSavedRecipients(userId);
      const resolved = resolveSavedRecipient(saved, params.recipient);
      if (!resolved.ok) return fail(resolved.error);

      try {
        const user = ctx.getUser();
        const { share, created, noteTitle } = await shareNote({
          ownerId: userId,
          noteId: params.note_id,
          email: resolved.recipient.email,
          permission: params.permission,
          origin: { via: "mcp", keyId: user.keyId, keyName: user.keyName },
        });
        const who = `${resolved.recipient.label} (${resolved.recipient.email})`;
        const access = share.permission === "edit" ? "can view and edit" : "can view";
        return json({
          success: true,
          created,
          note_id: share.note_id,
          note_title: noteTitle,
          shared_with: resolved.recipient,
          permission: share.permission,
          recipient_has_account: share.recipient_has_account,
          open_url: absoluteUrl(`/notes/${share.note_id}`),
          message: share.recipient_has_account
            ? `"${noteTitle}" is shared with ${who}, who ${access} it now.`
            : `"${noteTitle}" is shared with ${who}. That address has no account on this server yet; the note appears for it as soon as the account exists.`,
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Unshare Note ──────────────────────────────────────
  server.tool(
    "unshare_note",
    "Stop sharing a note with an account. Access ends immediately. Unsharing something not shared is not an error.",
    unshareNoteShape,
    async (params) => {
      const guard = ctx.guard("notes:share");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      // A saved name, or any address — revoking is never restricted.
      const saved = await getSavedRecipients(userId);
      const resolved = resolveSavedRecipient(saved, params.recipient);
      const email = resolved.ok
        ? resolved.recipient.email
        : isValidEmail(params.recipient)
          ? params.recipient
          : null;
      if (!email) return fail(resolved.ok ? "No recipient given." : resolved.error);

      try {
        const removed = await revokeShare(userId, params.note_id, { email });
        return json({
          success: true,
          removed,
          message: removed
            ? `No longer shared with ${email}.`
            : `The note was not shared with ${email}; nothing changed.`,
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── List Note Shares ──────────────────────────────────
  server.tool(
    "list_note_shares",
    "Who this account has shared notes with — for one note or all of them — plus the saved share recipients that share_note accepts.",
    listNoteSharesShape,
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);
      const userId = guard.userId;

      try {
        const recipients = await getSavedRecipients(userId);
        const shares = params.note_id
          ? await listNoteShares(userId, params.note_id)
          : await listOutgoingShares(userId);
        return json({ saved_recipients: recipients, count: shares.length, shares });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── List Shared Notes ─────────────────────────────────
  server.tool(
    "list_shared_notes",
    "Notes other accounts have shared with this account (for example, notes shared from the user's personal account to their work account). Read one with get_note.",
    listSharedNotesShape,
    async (params) => {
      const guard = ctx.guard("notes:read");
      if (!guard.ok) return errorResult(guard);

      try {
        const notes = await listSharedWithMe(guard.userId, {
          limit: params.limit,
          includeArchived: params.include_archived,
        });
        return json({ count: notes.length, notes });
      } catch (error) {
        if (isMissingNoteSharesTable(error)) return json({ count: 0, notes: [] });
        return failFrom(error);
      }
    }
  );
}
