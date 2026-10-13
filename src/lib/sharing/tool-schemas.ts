/**
 * Input shapes for the sharing MCP tools, shared by the registrations
 * (`src/mcp/tools/sharing.ts`) and the documentation catalog
 * (`src/lib/mcp/catalog.ts`), so the two cannot drift.
 *
 * Written for an assistant translating plain speech: "share this with my work
 * account" is `share_note` with `recipient: "work"`.
 */

import { z } from "zod";

const noteId = z.string().min(1).describe("The note's id (from create_note, get_note, list_notes or search).");

export const shareNoteShape = {
  note_id: noteId,
  recipient: z
    .string()
    .min(1)
    .describe(
      'Who to share with: the name of a saved share recipient, as the user says it ("work", "my work account"), or that recipient\'s email. Only recipients the user saved in Settings → Sharing are accepted; list_note_shares returns them.'
    ),
  permission: z
    .enum(["view", "edit"])
    .default("view")
    .describe('"view" (default) lets them read the live note; "edit" also lets them change its title and text. Use "edit" only when the user asks for it.'),
};

export const unshareNoteShape = {
  note_id: noteId,
  recipient: z
    .string()
    .min(1)
    .describe('The saved recipient name ("work") or any email the note is shared with.'),
};

export const listNoteSharesShape = {
  note_id: z
    .string()
    .optional()
    .describe("Only this note's shares. Omit to list every note this account has shared."),
};

export const listSharedNotesShape = {
  limit: z.number().min(1).max(200).default(50).describe("Max results (default 50)"),
  include_archived: z.boolean().default(false).describe("Include notes the owner has archived"),
};
