/**
 * Input shapes for the whiteboard MCP tools, shared by the registrations
 * (`src/mcp/tools/whiteboards.ts`) and the documentation catalog
 * (`src/lib/mcp/catalog.ts`), so the two cannot drift.
 *
 * Written for an assistant translating plain speech: "put these ideas on the
 * project board, grouped by theme" is one `add_whiteboard_items` call with
 * frames and stickies, no coordinates needed.
 */

import { z } from "zod";
import { BOARD_COLORS, CARD_REF_TYPES, ITEM_KINDS, SHAPES } from "./types";

const target = {
  board_id: z.string().optional().describe("The whiteboard's id (from list_whiteboards or get_whiteboard)."),
  project_id: z.string().optional().describe("Or: the project whose whiteboard this is."),
  note_id: z.string().optional().describe("Or: the note (id or slug) whose whiteboard this is."),
};

const color = z.enum(BOARD_COLORS).optional().describe("Named colour. Stickies default to yellow.");

export const listWhiteboardsShape = {
  project_id: z
    .string()
    .optional()
    .describe("Only this project's boards: its own and those of its notes."),
  limit: z.number().min(1).max(200).default(50).describe("Max results (default 50)"),
};

export const getWhiteboardShape = {
  ...target,
  include_items: z
    .boolean()
    .default(true)
    .describe("Also return every item with its position. The outline alone is enough to read the board."),
};

export const newItemShape = z.object({
  kind: z
    .enum(ITEM_KINDS)
    .describe(
      "sticky (an idea), text (a heading or label), shape (a box/ellipse/diamond with words), frame (a titled area that groups what is inside it), card (a live link to a note or task), connector (an arrow between two items). ink is drawn by hand in the app."
    ),
  text: z.string().max(5000).optional().describe("The words. For a frame, its title. For a connector, its label."),
  color,
  frame: z
    .string()
    .optional()
    .describe("Put this item inside a frame: an existing frame's id or exact title, or the `ref` of a frame in this same call."),
  ref: z
    .string()
    .optional()
    .describe("A name for this item within this call, so a connector (from/to) or another item (frame) can point at it."),
  x: z.number().optional().describe("Board position. Omit to let the board place it without overlapping anything."),
  y: z.number().optional(),
  w: z.number().optional().describe("Width. Omit for the kind's default."),
  h: z.number().optional(),
  shape: z.enum(SHAPES).optional().describe("Shapes only. Default rect."),
  font_size: z.number().min(8).max(160).optional(),
  ref_type: z.enum(CARD_REF_TYPES).optional().describe("Cards only: what the card shows."),
  ref_id: z.string().optional().describe("Cards only: the note or task id."),
  from: z.string().optional().describe("Connectors only: an item id or a `ref` from this call."),
  to: z.string().optional().describe("Connectors only: an item id or a `ref` from this call."),
  arrow: z.boolean().optional().describe("Connectors only: arrowhead at the `to` end (default true)."),
});

export const addWhiteboardItemsShape = {
  ...target,
  items: z
    .array(newItemShape)
    .min(1)
    .max(500)
    .describe("Items to add. Frames in the list are made first, so other items can go into them by ref."),
};

export const updateWhiteboardItemsShape = {
  board_id: z.string().describe("The whiteboard's id."),
  items: z
    .array(
      z.object({
        id: z.string().describe("The item's id (from get_whiteboard)."),
        text: z.string().max(5000).optional(),
        color,
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
        z: z.number().optional().describe("Stacking order; higher is on top."),
      })
    )
    .min(1)
    .max(500)
    .describe("Only the fields given change."),
};

export const deleteWhiteboardItemsShape = {
  board_id: z.string().describe("The whiteboard's id."),
  item_ids: z
    .array(z.string())
    .min(1)
    .max(500)
    .describe("Items to remove. Connectors attached to them go too. Deleting a card never deletes its note or task."),
};

export const organizeWhiteboardShape = {
  board_id: z.string().describe("The whiteboard's id."),
  groups: z
    .array(
      z.object({
        title: z.string().min(1).max(120).describe("The theme, shown as the frame's title."),
        item_ids: z.array(z.string()).min(1).describe("Items that belong to it."),
        color,
      })
    )
    .optional()
    .describe(
      "Group these items into new titled frames, one per group. Omit to tidy instead: line up what is inside each frame and the loose items beside them."
    ),
};

export const convertWhiteboardItemsShape = {
  board_id: z.string().describe("The whiteboard's id."),
  to: z
    .enum(["tasks", "note"])
    .describe(
      "tasks: each listed sticky/text/shape becomes a real task in the board's project, and the sticky becomes a live card for that task. note: the whole board is written out as a note (frames become headings)."
    ),
  item_ids: z.array(z.string()).max(500).optional().describe("tasks: which items. Ignored for note."),
  title: z.string().max(200).optional().describe("note: the note's title."),
};
