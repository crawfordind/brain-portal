/**
 * MCP Tools: whiteboards.
 *
 * Every project and every note can have a whiteboard. An agent reads one as
 * an outline (`get_whiteboard`), adds to it the way it thinks about it
 * (`add_whiteboard_items`: frames, stickies, cards and arrows, no coordinates
 * needed), reorganises it (`organize_whiteboard`), and turns it into real
 * work (`convert_whiteboard_items`: stickies → tasks, board → note).
 *
 * What an agent writes shows up on an open canvas within seconds, labelled
 * with the key that wrote it. Same `src/lib/whiteboards/*` modules as the web
 * app; no SQL of its own.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, type ToolContext } from "../guard";
import { absoluteUrl } from "@/lib/app-url";
import {
  addItems,
  convertItemsToTasks,
  getBoardById,
  getBoardForTarget,
  groupItems,
  listBoards,
  outlineBoard,
  patchItems,
  readBoard,
  saveBoardAsNote,
  tidyBoard,
  writeItems,
  WhiteboardError,
  type BoardTarget,
  type TargetAccess,
} from "@/lib/whiteboards/store";
import { isMissingWhiteboardTables } from "@/lib/whiteboards/schema";
import type { Whiteboard } from "@/lib/whiteboards/types";
import {
  addWhiteboardItemsShape,
  convertWhiteboardItemsShape,
  deleteWhiteboardItemsShape,
  getWhiteboardShape,
  listWhiteboardsShape,
  organizeWhiteboardShape,
  updateWhiteboardItemsShape,
} from "@/lib/whiteboards/tool-schemas";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function failFrom(error: unknown) {
  if (error instanceof WhiteboardError) return fail(error.message);
  if (isMissingWhiteboardTables(error)) {
    return fail("Whiteboards aren't set up on this server yet. The operator must run `npm run db:migrate`.");
  }
  throw error;
}

/** Where a board opens in the app. */
export function boardUrl(board: Pick<Whiteboard, "scope" | "project_id" | "note_id">, access: TargetAccess): string {
  if (board.scope === "project") return absoluteUrl(`/projects/${access.slug ?? board.project_id}/whiteboard`);
  return absoluteUrl(`/notes/${access.slug ?? board.note_id}/whiteboard`);
}

function targetFrom(params: { board_id?: string; project_id?: string; note_id?: string }): BoardTarget | string | null {
  if (params.board_id) return params.board_id;
  if (params.project_id) return { scope: "project", id: params.project_id };
  if (params.note_id) return { scope: "note", id: params.note_id };
  return null;
}

export function registerWhiteboardTools(server: McpServer, ctx: ToolContext) {
  // ─── List ──────────────────────────────────────────────
  server.tool(
    "list_whiteboards",
    "List the whiteboards this account can open: each project's board and each note's board, with item counts. A project's notes appear as tabs of the project's whiteboard space in the app.",
    listWhiteboardsShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:read");
      if (!guard.ok) return errorResult(guard);
      try {
        const boards = await listBoards(guard.userId, { projectId: params.project_id, limit: params.limit });
        return json({ count: boards.length, boards });
      } catch (error) {
        if (isMissingWhiteboardTables(error)) return json({ count: 0, boards: [] });
        return failFrom(error);
      }
    }
  );

  // ─── Get ───────────────────────────────────────────────
  server.tool(
    "get_whiteboard",
    "Read a whiteboard (by board_id, project_id or note_id) as an outline: frames with what is inside them, stickies, cards with their live note/task status, and the arrows between items. Use this before adding to a board so new items fit what is there.",
    getWhiteboardShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:read");
      if (!guard.ok) return errorResult(guard);
      const target = targetFrom(params);
      if (!target) return fail("Give board_id, project_id or note_id.");
      try {
        let boardId: string;
        if (typeof target === "string") {
          boardId = target;
        } else {
          const { board, access } = await getBoardForTarget(target, guard.userId);
          if (!board) {
            return json({
              exists: false,
              title: access.title,
              message: `The ${target.scope} "${access.title}" has no whiteboard yet. add_whiteboard_items with this ${target.scope}_id starts one.`,
            });
          }
          boardId = board.id;
        }
        const view = await readBoard(boardId, guard.userId);
        const outline = await outlineBoard(boardId, guard.userId);
        return json({
          exists: true,
          board_id: view.board.id,
          scope: view.board.scope,
          title: view.board.title,
          can_edit: view.access.role !== "viewer",
          item_count: view.items.length,
          open_url: boardUrl(view.board, view.access),
          outline,
          ...(params.include_items
            ? {
                items: view.items.map((i) => ({
                  id: i.id,
                  kind: i.kind,
                  text: i.text,
                  color: i.color,
                  x: i.x,
                  y: i.y,
                  w: i.w,
                  h: i.h,
                  ...(i.kind === "shape" ? { shape: i.props.shape } : {}),
                  ...(i.kind === "connector" ? { from: i.from_item_id, to: i.to_item_id } : {}),
                  ...(i.kind === "card" ? { ref_type: i.ref_type, ref_id: i.ref_id } : {}),
                  ...(i.source_label ? { written_by: i.source_label } : {}),
                })),
              }
            : {}),
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Add ───────────────────────────────────────────────
  server.tool(
    "add_whiteboard_items",
    'Add stickies, text, shapes, frames, cards (live links to notes/tasks) and arrows to a project\'s or note\'s whiteboard, creating the board if needed. Coordinates are optional: items without them are placed beside what is already there, or inside the frame named in `frame`. Example: a frame {kind:"frame", text:"Risks", ref:"risks"} plus stickies {kind:"sticky", text:"…", frame:"risks"}.',
    addWhiteboardItemsShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:write");
      if (!guard.ok) return errorResult(guard);
      const target = targetFrom(params);
      if (!target) return fail("Give board_id, project_id or note_id.");
      try {
        let resolved: BoardTarget;
        if (typeof target === "string") {
          const found = await getBoardById(target, guard.userId);
          if (!found) return fail("Whiteboard not found");
          resolved = { scope: found.board.scope, id: found.access.targetId };
        } else {
          resolved = target;
        }
        const result = await addItems(resolved, guard.userId, params.items, ctx.provenance());
        const { access } = await getBoardForTarget(resolved, guard.userId);
        return json({
          success: result.applied.length > 0,
          board_id: result.board.id,
          added: result.created,
          refs: result.refs,
          ...(result.errors.length ? { problems: result.errors } : {}),
          open_url: boardUrl(result.board, access),
          message: `Added ${result.created.length} item${result.created.length === 1 ? "" : "s"} to "${result.board.title}".`,
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Update ────────────────────────────────────────────
  server.tool(
    "update_whiteboard_items",
    "Change the text, colour, position, size or stacking of items already on a whiteboard. Only the fields given change.",
    updateWhiteboardItemsShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const result = await patchItems(params.board_id, guard.userId, params.items, ctx.provenance());
        return json({
          success: result.applied.length > 0,
          updated: result.applied,
          ...(result.errors.length ? { problems: result.errors } : {}),
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Delete ────────────────────────────────────────────
  server.tool(
    "delete_whiteboard_items",
    "Remove items from a whiteboard. Arrows attached to them are removed too. A card's note or task is never deleted.",
    deleteWhiteboardItemsShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:write");
      if (!guard.ok) return errorResult(guard);
      try {
        const result = await writeItems(params.board_id, guard.userId, { deletes: params.item_ids }, ctx.provenance());
        return json({ success: true, deleted: result.deleted, message: `Removed ${result.deleted.length} item(s).` });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Organize ──────────────────────────────────────────
  server.tool(
    "organize_whiteboard",
    "Reorganise a whiteboard. With `groups`, put the listed items into new titled frames, one per theme (read the board with get_whiteboard first and decide the themes yourself). Without, tidy it: line up the contents of each frame and the loose items beside them.",
    organizeWhiteboardShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:write");
      if (!guard.ok) return errorResult(guard);
      try {
        if (params.groups?.length) {
          const result = await groupItems(params.board_id, guard.userId, params.groups, ctx.provenance());
          return json({
            success: true,
            frames: result.frames,
            ...(result.errors.length ? { problems: result.errors } : {}),
            message: `Grouped into ${result.frames.length} frame(s).`,
          });
        }
        const result = await tidyBoard(params.board_id, guard.userId, ctx.provenance());
        return json({ success: true, moved: result.moved, message: result.moved ? `Tidied ${result.moved} item(s).` : "Already tidy." });
      } catch (error) {
        return failFrom(error);
      }
    }
  );

  // ─── Convert ───────────────────────────────────────────
  server.tool(
    "convert_whiteboard_items",
    'Turn whiteboard content into real work. to:"tasks" makes each listed sticky/text/shape a task in the board\'s project and swaps it for a live task card in the same spot. to:"note" writes the whole board out as a note (frames become headings) in the same project.',
    convertWhiteboardItemsShape,
    async (params) => {
      const guard = ctx.guard("whiteboards:write");
      if (!guard.ok) return errorResult(guard);
      // Converting also writes outside the board, so it needs that scope too.
      const second = ctx.guard(params.to === "tasks" ? "tasks:write" : "notes:write");
      if (!second.ok) return errorResult(second);
      try {
        if (params.to === "tasks") {
          const result = await convertItemsToTasks(params.board_id, guard.userId, params.item_ids ?? [], ctx.provenance());
          return json({
            success: result.tasks.length > 0,
            tasks: result.tasks,
            ...(result.errors.length ? { problems: result.errors } : {}),
            message: `Created ${result.tasks.length} task(s).`,
          });
        }
        const note = await saveBoardAsNote(params.board_id, guard.userId, ctx.provenance(), params.title);
        return json({
          success: true,
          note_id: note.id,
          slug: note.slug,
          open_url: absoluteUrl(`/notes/${note.slug}`),
          message: `Saved the board as the note "${note.title}".`,
        });
      } catch (error) {
        return failFrom(error);
      }
    }
  );
}
