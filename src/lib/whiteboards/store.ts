/**
 * Whiteboards: every read and write of `whiteboards` and `whiteboard_items`.
 *
 * Used by the API routes and by the MCP tools (which run outside Next.js), so
 * it imports only the shared DB client and pure modules. Every function takes
 * the acting user's id and resolves their access itself; callers cannot
 * forget to.
 *
 * Access is never decided here from scratch. A project's board is as visible
 * as the project (`getProjectAccess`), a note's board as the note
 * (`getNoteAccess`), so sharing a note or inviting a collaborator to a
 * project carries its board with it and revoking takes it away.
 */

import type { InStatement, InValue } from "@libsql/client";
import { db, query, queryOne } from "@/lib/db/client";
import { getProjectAccess } from "@/lib/permissions";
import { getNoteAccess } from "@/lib/sharing/access";
import {
  HUMAN_STAMP,
  stampColumns,
  stampPlaceholders,
  stampValues,
  type ProvenanceStamp,
} from "@/lib/provenance/types";
import {
  boardOutline,
  boardToMarkdown,
  findFrameByTitle,
  FRAME_HEADER,
  FRAME_PADDING,
  frameOf,
  GAP,
  gridColumns,
  placeNewItems,
  tidyLayout,
  type PlacementRequest,
} from "./layout";
import {
  DEFAULT_SIZE,
  MAX_ITEMS_PER_BOARD,
  MAX_OPS_PER_REQUEST,
  newItemId,
  normalizeItemInput,
  parseProps,
  type BoardColor,
  type BoardRole,
  type BoardScope,
  type CardRef,
  type CardRefType,
  type ItemInput,
  type Whiteboard,
  type WhiteboardItem,
  type WhiteboardItemKind,
  type WhiteboardItemProps,
} from "./types";

export class WhiteboardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 413 = 400
  ) {
    super(message);
    this.name = "WhiteboardError";
  }
}

export interface BoardTarget {
  scope: BoardScope;
  /** Project id, or note id or slug. */
  id: string;
}

/** What a viewer may do with a target, before any board exists. */
export interface TargetAccess {
  scope: BoardScope;
  targetId: string;
  ownerId: string;
  title: string;
  role: BoardRole;
  /** The project a note board sits in, for the workspace tabs. */
  projectId: string | null;
  /** Notes: the slug, for links back to the note. */
  slug: string | null;
}

export interface BoardView {
  board: Whiteboard;
  access: TargetAccess;
  items: WhiteboardItem[];
  /** Ids of every item on the board; present on incremental reads. */
  ids?: string[];
  refs: Record<string, CardRef>;
}

export interface WriteResult {
  version: number;
  applied: string[];
  deleted: string[];
  errors: Array<{ id: string | null; error: string }>;
}

// ─── Access ─────────────────────────────────────────────────────────

export async function resolveTarget(target: BoardTarget, userId: string): Promise<TargetAccess | null> {
  if (target.scope === "project") {
    const access = await getProjectAccess(target.id, userId);
    if (!access) return null;
    return {
      scope: "project",
      targetId: access.project.id,
      ownerId: access.project.user_id,
      title: access.project.name,
      role: access.role,
      projectId: access.project.id,
      slug: access.project.slug,
    };
  }
  const access = await getNoteAccess(target.id, userId);
  if (!access) return null;
  return {
    scope: "note",
    targetId: access.note.id,
    ownerId: access.note.user_id,
    title: access.note.title,
    role: access.role,
    projectId: access.note.project_id ?? null,
    slug: access.note.slug,
  };
}

function canWrite(role: BoardRole): boolean {
  return role === "owner" || role === "editor";
}

interface BoardRow {
  id: string;
  user_id: string;
  scope: BoardScope;
  project_id: string | null;
  note_id: string | null;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function toBoard(row: BoardRow, title: string): Whiteboard {
  return {
    id: row.id,
    scope: row.scope,
    project_id: row.project_id,
    note_id: row.note_id,
    user_id: row.user_id,
    // The board is named after what it belongs to, live, so renaming a
    // project renames its board.
    title: row.title || title,
    version: Number(row.version) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findBoardRow(access: TargetAccess): Promise<BoardRow | null> {
  return access.scope === "project"
    ? queryOne<BoardRow>(`SELECT * FROM whiteboards WHERE scope = 'project' AND project_id = ?`, [access.targetId])
    : queryOne<BoardRow>(`SELECT * FROM whiteboards WHERE scope = 'note' AND note_id = ?`, [access.targetId]);
}

/**
 * The board for a project or note. With `create`, makes it on first use for
 * anyone who may edit the target; a viewer of a target with no board gets
 * null, which the UI shows as "no whiteboard yet".
 */
export async function getBoardForTarget(
  target: BoardTarget,
  userId: string,
  options: { create?: boolean } = {}
): Promise<{ board: Whiteboard | null; access: TargetAccess }> {
  const access = await resolveTarget(target, userId);
  if (!access) throw new WhiteboardError(target.scope === "project" ? "Project not found" : "Note not found", 404);

  let row = await findBoardRow(access);
  if (!row && options.create) {
    if (!canWrite(access.role)) {
      throw new WhiteboardError("Only people who can edit this may start its whiteboard", 403);
    }
    // ON CONFLICT DO NOTHING (not OR IGNORE, which would also swallow a CHECK
    // failure): two first opens at once both end up on the one board.
    await db.execute({
      sql: `INSERT INTO whiteboards (user_id, scope, project_id, note_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
      args: [
        access.ownerId,
        access.scope,
        access.scope === "project" ? access.targetId : null,
        access.scope === "note" ? access.targetId : null,
      ],
    });
    row = await findBoardRow(access);
  }
  return { board: row ? toBoard(row, access.title) : null, access };
}

/** A board by its own id, with the viewer's access. Null hides existence. */
export async function getBoardById(
  boardId: string,
  userId: string
): Promise<{ board: Whiteboard; access: TargetAccess } | null> {
  const row = await queryOne<BoardRow>(`SELECT * FROM whiteboards WHERE id = ?`, [boardId]);
  if (!row) return null;
  const targetId = row.scope === "project" ? row.project_id : row.note_id;
  if (!targetId) return null;
  const access = await resolveTarget({ scope: row.scope, id: targetId }, userId);
  if (!access) return null;
  return { board: toBoard(row, access.title), access };
}

async function requireBoard(boardId: string, userId: string, write: boolean) {
  const found = await getBoardById(boardId, userId);
  if (!found) throw new WhiteboardError("Whiteboard not found", 404);
  if (write && !canWrite(found.access.role)) {
    throw new WhiteboardError("You can view this whiteboard but not change it", 403);
  }
  return found;
}

// ─── Reading ────────────────────────────────────────────────────────

interface ItemRow extends Omit<WhiteboardItem, "props" | "kind" | "color" | "ref_type"> {
  kind: string;
  color: string;
  props: string;
  ref_type: string | null;
}

function toItem(row: ItemRow): WhiteboardItem {
  return {
    id: row.id,
    board_id: row.board_id,
    kind: row.kind as WhiteboardItemKind,
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    z: Number(row.z),
    text: row.text ?? "",
    color: row.color as BoardColor,
    props: parseProps(row.props),
    from_item_id: row.from_item_id,
    to_item_id: row.to_item_id,
    ref_type: (row.ref_type as CardRefType | null) ?? null,
    ref_id: row.ref_id,
    rev: Number(row.rev) || 0,
    source_actor: row.source_actor ?? null,
    source_label: row.source_label ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ITEM_COLUMNS = `id, board_id, kind, x, y, w, h, z, text, color, props, from_item_id, to_item_id,
  ref_type, ref_id, rev, source_actor, source_label, created_at, updated_at`;

export async function loadItems(boardId: string, sinceRev?: number): Promise<WhiteboardItem[]> {
  const rows =
    typeof sinceRev === "number"
      ? await query<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM whiteboard_items WHERE board_id = ? AND rev > ? ORDER BY z ASC, created_at ASC`,
          [boardId, sinceRev]
        )
      : await query<ItemRow>(
          `SELECT ${ITEM_COLUMNS} FROM whiteboard_items WHERE board_id = ? ORDER BY z ASC, created_at ASC`,
          [boardId]
        );
  return rows.map(toItem);
}

/**
 * What each card points at, read live. A record is shown when it belongs to
 * the board's owner, to the viewer, or to the board's project, which is
 * everything the viewer could already open from the project or note itself.
 * Anything else reads as missing rather than leaking a title.
 */
export async function resolveCardRefs(
  items: Array<Pick<WhiteboardItem, "kind" | "ref_type" | "ref_id">>,
  scope: { ownerId: string; viewerId: string; projectId: string | null }
): Promise<Record<string, CardRef>> {
  const out: Record<string, CardRef> = {};
  const noteIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const i of items) {
    if (i.kind !== "card" || !i.ref_id) continue;
    if (i.ref_type === "note") noteIds.add(i.ref_id);
    if (i.ref_type === "task") taskIds.add(i.ref_id);
  }
  const visible = `(user_id = ? OR user_id = ?${scope.projectId ? " OR project_id = ?" : ""})`;
  const visibleArgs: InValue[] = [scope.ownerId, scope.viewerId, ...(scope.projectId ? [scope.projectId] : [])];

  if (noteIds.size) {
    const ids = [...noteIds].slice(0, 500);
    let rows: Array<{ id: string; title: string; slug: string; has_board: number }>;
    try {
      rows = await query(
        `SELECT n.id, n.title, n.slug,
                EXISTS(SELECT 1 FROM whiteboards w WHERE w.scope = 'note' AND w.note_id = n.id) AS has_board
         FROM notes n
         WHERE n.id IN (${ids.map(() => "?").join(",")}) AND ${visible.replace(/(user_id|project_id)/g, "n.$1")}`,
        [...ids, ...visibleArgs]
      );
    } catch {
      rows = [];
    }
    const found = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = found.get(id);
      out[`note:${id}`] = r
        ? { type: "note", id, title: r.title || "Untitled", slug: r.slug, status: null, due_date: null, has_board: !!Number(r.has_board) }
        : { type: "note", id, title: "Note unavailable", slug: null, status: null, due_date: null, missing: true };
    }
  }

  if (taskIds.size) {
    const ids = [...taskIds].slice(0, 500);
    const rows = await query<{ id: string; title: string | null; content: string; status: string; due_date: string | null }>(
      `SELECT id, title, content, status, due_date FROM tasks
       WHERE id IN (${ids.map(() => "?").join(",")}) AND ${visible}`,
      [...ids, ...visibleArgs]
    );
    const found = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = found.get(id);
      out[`task:${id}`] = r
        ? { type: "task", id, title: (r.title || r.content || "Untitled task").slice(0, 200), slug: null, status: r.status, due_date: r.due_date }
        : { type: "task", id, title: "Task unavailable", slug: null, status: null, due_date: null, missing: true };
    }
  }
  return out;
}

/**
 * A board with its items. With `sinceRev`, only items written after that
 * version are returned, plus the id of every item still on the board so the
 * reader can drop the ones that were deleted. Unchanged boards return no
 * items at all.
 */
export async function readBoard(boardId: string, userId: string, sinceRev?: number): Promise<BoardView> {
  const { board, access } = await requireBoard(boardId, userId, false);
  const incremental = typeof sinceRev === "number" && sinceRev >= 0;
  if (incremental && sinceRev >= board.version) {
    return { board, access, items: [], ids: undefined, refs: {} };
  }
  const items = await loadItems(boardId, incremental ? sinceRev : undefined);
  const ids = incremental
    ? (await query<{ id: string }>(`SELECT id FROM whiteboard_items WHERE board_id = ?`, [boardId])).map((r) => r.id)
    : undefined;
  // Cards are resolved over the whole board on a full read, and over the
  // changed ones otherwise; a task ticked off elsewhere is picked up on the
  // next full read (opening the board, or the canvas's periodic refresh).
  const refs = await resolveCardRefs(items, { ownerId: board.user_id, viewerId: userId, projectId: access.projectId });
  return { board, access, items, ids, refs };
}

export async function readBoardForTarget(
  target: BoardTarget,
  userId: string,
  options: { create?: boolean } = {}
): Promise<BoardView | { board: null; access: TargetAccess }> {
  const { board, access } = await getBoardForTarget(target, userId, options);
  if (!board) return { board: null, access };
  return readBoard(board.id, userId);
}

/**
 * A target's board as an outline, or null when it has none or it is empty.
 * Never creates a board.
 */
export async function outlineForTarget(
  target: BoardTarget,
  userId: string
): Promise<{ boardId: string; outline: string } | null> {
  const { board } = await getBoardForTarget(target, userId);
  if (!board) return null;
  const view = await readBoard(board.id, userId);
  if (!view.items.length) return null;
  return {
    boardId: board.id,
    outline: boardOutline(view.board.title, view.items, new Map(Object.entries(view.refs)), { maxLines: 300 }),
  };
}

/** The board as text for an agent or the chat. */
export async function outlineBoard(boardId: string, userId: string, maxLines?: number): Promise<string> {
  const view = await readBoard(boardId, userId);
  return boardOutline(view.board.title, view.items, new Map(Object.entries(view.refs)), { maxLines });
}

// ─── Writing ────────────────────────────────────────────────────────

const UPSERT_SQL = `INSERT INTO whiteboard_items
    (id, board_id, kind, x, y, w, h, z, text, color, props, from_item_id, to_item_id, ref_type, ref_id,
     rev, created_by, ${stampColumns()})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
     (SELECT version FROM whiteboards WHERE id = ?), ?, ${stampPlaceholders()})
  ON CONFLICT(id) DO UPDATE SET
    kind = excluded.kind, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, z = excluded.z,
    text = excluded.text, color = excluded.color, props = excluded.props,
    from_item_id = excluded.from_item_id, to_item_id = excluded.to_item_id,
    ref_type = excluded.ref_type, ref_id = excluded.ref_id,
    rev = excluded.rev, updated_at = datetime('now')
  WHERE whiteboard_items.board_id = excluded.board_id`;

function upsertStatement(boardId: string, userId: string, item: ItemInput, stamp: ProvenanceStamp): InStatement {
  return {
    sql: UPSERT_SQL,
    args: [
      item.id,
      boardId,
      item.kind,
      item.x,
      item.y,
      item.w,
      item.h,
      item.z,
      item.text,
      item.color,
      JSON.stringify(item.props),
      item.from_item_id,
      item.to_item_id,
      item.ref_type,
      item.ref_id,
      boardId,
      userId,
      ...stampValues(stamp),
    ],
  };
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Apply a batch of item writes and deletes in one transaction.
 *
 * Items are upserted whole (the canvas always has the whole item). An id that
 * already belongs to another board is refused, connectors must join items on
 * this board, and cards must point at records the viewer can see. Each
 * refusal is reported per item and the rest of the batch still lands, so one
 * bad sticky in an agent's fifty does not lose the other forty-nine.
 *
 * Deleting an item deletes the connectors attached to it.
 */
export async function writeItems(
  boardId: string,
  userId: string,
  ops: { upserts?: unknown[]; deletes?: unknown[] },
  stamp: ProvenanceStamp = HUMAN_STAMP
): Promise<WriteResult> {
  const { board, access } = await requireBoard(boardId, userId, true);
  const rawUpserts = Array.isArray(ops.upserts) ? ops.upserts : [];
  const rawDeletes = Array.isArray(ops.deletes) ? ops.deletes : [];
  if (rawUpserts.length + rawDeletes.length > MAX_OPS_PER_REQUEST) {
    throw new WhiteboardError(`At most ${MAX_OPS_PER_REQUEST} changes per request`, 413);
  }

  const errors: WriteResult["errors"] = [];
  const valid: ItemInput[] = [];
  for (const raw of rawUpserts) {
    const r = normalizeItemInput(raw);
    if (r.ok) valid.push(r.item);
    else errors.push({ id: typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : null, error: r.error });
  }
  const deletes = rawDeletes.filter((d): d is string => typeof d === "string" && d.length > 0 && d.length <= 64);

  // Ids that live on another board are not ours to touch.
  const existing = valid.length
    ? await query<{ id: string; board_id: string }>(
        `SELECT id, board_id FROM whiteboard_items WHERE id IN (${placeholders(valid.length)})`,
        valid.map((v) => v.id)
      )
    : [];
  const elsewhere = new Set(existing.filter((e) => e.board_id !== boardId).map((e) => e.id));
  const onBoard = new Set(
    (await query<{ id: string }>(`SELECT id FROM whiteboard_items WHERE board_id = ?`, [boardId])).map((r) => r.id)
  );

  let accepted = valid.filter((v) => {
    if (elsewhere.has(v.id)) {
      errors.push({ id: v.id, error: "That id belongs to another whiteboard" });
      return false;
    }
    return true;
  });

  // Count limit, counting only genuinely new items.
  const deleting = new Set(deletes);
  const newCount = accepted.filter((v) => !onBoard.has(v.id)).length;
  const remaining = [...onBoard].filter((id) => !deleting.has(id)).length;
  if (remaining + newCount > MAX_ITEMS_PER_BOARD) {
    throw new WhiteboardError(`A whiteboard holds at most ${MAX_ITEMS_PER_BOARD} items`, 413);
  }

  // Connectors must join items that will exist after this batch.
  const willExist = new Set([...[...onBoard].filter((id) => !deleting.has(id)), ...accepted.map((a) => a.id)]);
  accepted = accepted.filter((v) => {
    if (v.kind !== "connector") return true;
    for (const end of [v.from_item_id, v.to_item_id]) {
      if (end && !willExist.has(end)) {
        errors.push({ id: v.id, error: `Connector end ${end} is not on this whiteboard` });
        return false;
      }
    }
    return true;
  });

  // Cards must point at something the viewer can see.
  const cards = accepted.filter((v) => v.kind === "card");
  if (cards.length) {
    const refs = await resolveCardRefs(cards, { ownerId: board.user_id, viewerId: userId, projectId: access.projectId });
    accepted = accepted.filter((v) => {
      if (v.kind !== "card") return true;
      if (refs[`${v.ref_type}:${v.ref_id}`]?.missing) {
        errors.push({ id: v.id, error: `No ${v.ref_type} ${v.ref_id} that this whiteboard can show` });
        return false;
      }
      return true;
    });
  }

  if (!accepted.length && !deletes.length) {
    return { version: board.version, applied: [], deleted: [], errors };
  }

  const statements: InStatement[] = [
    {
      sql: `UPDATE whiteboards SET version = version + 1, updated_at = datetime('now') WHERE id = ?`,
      args: [boardId],
    },
    ...accepted.map((item) => upsertStatement(boardId, userId, item, stamp)),
  ];
  if (deletes.length) {
    const ph = placeholders(deletes.length);
    statements.push({
      sql: `DELETE FROM whiteboard_items
            WHERE board_id = ? AND (id IN (${ph}) OR from_item_id IN (${ph}) OR to_item_id IN (${ph}))
            RETURNING id`,
      args: [boardId, ...deletes, ...deletes, ...deletes],
    });
  }
  statements.push({ sql: `SELECT version FROM whiteboards WHERE id = ?`, args: [boardId] });

  const results = await db.batch(statements, "write");
  const last = results[results.length - 1];
  const version = Number(last?.rows?.[0]?.version ?? board.version + 1);
  const deleted = deletes.length
    ? (results[results.length - 2]?.rows ?? []).map((r) => String((r as Record<string, unknown>).id))
    : [];

  return { version, applied: accepted.map((a) => a.id), deleted, errors };
}

/**
 * Partial updates, as an agent sends them: only the fields named change.
 * Each patch is merged onto the stored item and then validated whole.
 */
export async function patchItems(
  boardId: string,
  userId: string,
  patches: Array<Record<string, unknown> & { id: string }>,
  stamp: ProvenanceStamp = HUMAN_STAMP
): Promise<WriteResult> {
  if (!patches.length) {
    const { board } = await requireBoard(boardId, userId, true);
    return { version: board.version, applied: [], deleted: [], errors: [] };
  }
  const ids = patches.map((p) => p.id);
  const current = new Map(
    (
      await query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM whiteboard_items WHERE board_id = ? AND id IN (${placeholders(ids.length)})`,
        [boardId, ...ids]
      )
    ).map((r) => [r.id, toItem(r)])
  );
  const errors: WriteResult["errors"] = [];
  const merged: unknown[] = [];
  for (const p of patches) {
    const base = current.get(p.id);
    if (!base) {
      errors.push({ id: p.id, error: "No such item on this whiteboard" });
      continue;
    }
    const props = p.props && typeof p.props === "object" ? { ...base.props, ...(p.props as object) } : base.props;
    merged.push({ ...base, ...p, kind: base.kind, props });
  }
  const result = await writeItems(boardId, userId, { upserts: merged }, stamp);
  return { ...result, errors: [...errors, ...result.errors] };
}

// ─── Agent-friendly creation ────────────────────────────────────────

/** One item as an agent describes it: no id, coordinates optional. */
export interface NewItemSpec {
  kind: WhiteboardItemKind;
  text?: string;
  color?: BoardColor;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  shape?: WhiteboardItemProps["shape"];
  font_size?: number;
  /** Place inside this frame: an existing frame's id or title, or a `ref` from this batch. */
  frame?: string;
  /** Cards. */
  ref_type?: CardRefType;
  ref_id?: string;
  /** Connectors: item ids, or `ref`s of items in this batch. */
  from?: string;
  to?: string;
  arrow?: boolean;
  /** A name for this item within the batch, so connectors and frames can point at it. */
  ref?: string;
}

export interface CreateResult extends WriteResult {
  board: Whiteboard;
  /** `ref` → created id, for items that named themselves. */
  refs: Record<string, string>;
  created: Array<{ id: string; kind: WhiteboardItemKind; text: string; frame: string | null }>;
}

/**
 * Add items the way an agent thinks about them: "three stickies in the Risks
 * frame, connected to the plan card". Ids are minted here, positions are
 * chosen by `placeNewItems` when missing, frames named in the batch are made
 * first so items can go into them, and frames grow to fit what lands in them.
 *
 * Creates the board on first use, like opening it would.
 */
export async function addItems(
  target: BoardTarget,
  userId: string,
  specs: NewItemSpec[],
  stamp: ProvenanceStamp = HUMAN_STAMP
): Promise<CreateResult> {
  if (!specs.length) throw new WhiteboardError("Nothing to add");
  if (specs.length > MAX_OPS_PER_REQUEST) throw new WhiteboardError(`At most ${MAX_OPS_PER_REQUEST} items at once`, 413);

  const { board } = await getBoardForTarget(target, userId, { create: true });
  if (!board) throw new WhiteboardError("Whiteboard not found", 404);
  const existing = await loadItems(board.id);
  let topZ = existing.reduce((m, i) => Math.max(m, i.z), 0);

  const refIds: Record<string, string> = {};
  const ids = specs.map((s) => {
    const id = newItemId();
    if (s.ref) refIds[s.ref] = id;
    return id;
  });
  const resolveRef = (value: string | undefined): string | null => {
    if (!value) return null;
    if (refIds[value]) return refIds[value];
    if (existing.some((e) => e.id === value)) return value;
    return null;
  };

  // A frame made in this batch without a size is sized for what this batch
  // puts in it, rather than a fixed 760×520 that dwarfs two stickies.
  const sized = specs.map((spec) => {
    if (spec.kind !== "frame" || spec.w || spec.h) return spec;
    const title = spec.text?.trim().toLowerCase();
    const kids = specs.filter(
      (k) => k !== spec && k.kind !== "connector" && k.frame &&
        ((spec.ref && k.frame === spec.ref) || (title && k.frame.trim().toLowerCase() === title))
    );
    if (!kids.length) return spec;
    const cols = Math.min(3, gridColumns(kids.length));
    const rows = Math.ceil(kids.length / cols);
    const kw = Math.max(...kids.map((k) => k.w ?? DEFAULT_SIZE[k.kind].w));
    const kh = Math.max(...kids.map((k) => k.h ?? DEFAULT_SIZE[k.kind].h));
    return {
      ...spec,
      w: Math.max(360, cols * (kw + GAP) - GAP + FRAME_PADDING * 2),
      h: Math.max(240, FRAME_HEADER + rows * (kh + GAP) - GAP + FRAME_PADDING),
    };
  });
  specs = sized;

  // Frames in this batch are laid out first, so other items can land in them.
  const order = specs
    .map((s, index) => ({ s, index }))
    .sort((a, b) => Number(b.s.kind === "frame") - Number(a.s.kind === "frame"));

  const working = [...existing];
  const built: Array<ItemInput | null> = specs.map(() => null);
  const errors: WriteResult["errors"] = [];

  const frameIdFor = (name: string | undefined): string | null => {
    if (!name) return null;
    const byRef = resolveRef(name);
    if (byRef && working.some((w) => w.id === byRef && w.kind === "frame")) return byRef;
    return findFrameByTitle(working, name)?.id ?? null;
  };

  const growth = new Map<string, { w: number; h: number }>();
  for (const pass of ["frames", "rest"] as const) {
    const batch = order.filter(({ s }) => (pass === "frames" ? s.kind === "frame" : s.kind !== "frame"));
    if (!batch.length) continue;

    const requests: PlacementRequest[] = [];
    for (const { s, index } of batch) {
      if (s.kind === "connector") continue;
      const frameId = frameIdFor(s.frame);
      if (s.frame && !frameId) errors.push({ id: null, error: `No frame "${s.frame}"; item placed on the board instead` });
      const size = s.kind === "text" && s.text && !s.w ? textSize(s.text) : null;
      requests.push({
        index,
        kind: s.kind,
        x: s.x,
        y: s.y,
        w: s.w ?? size?.w,
        h: s.h ?? size?.h,
        frameId,
      });
    }
    const { placements, frameGrowth } = placeNewItems(working, requests);
    for (const g of frameGrowth) {
      growth.set(g.id, g);
      const f = working.find((w) => w.id === g.id);
      if (f) Object.assign(f, { w: g.w, h: g.h });
    }

    for (const { s, index } of batch) {
      const p = placements.find((pl) => pl.index === index);
      const props: Record<string, unknown> = {};
      if (s.shape) props.shape = s.shape;
      if (s.font_size) props.fontSize = s.font_size;
      if (s.kind === "connector") props.arrow = s.arrow !== false;
      const raw = {
        id: ids[index],
        kind: s.kind,
        text: s.text ?? "",
        color: s.color,
        x: p?.x,
        y: p?.y,
        w: p?.w,
        h: p?.h,
        // Frames sit beneath what they hold.
        z: s.kind === "frame" ? -1000 + index : (topZ += 1),
        props,
        ref_type: s.ref_type,
        ref_id: s.ref_id,
        from_item_id: s.kind === "connector" ? resolveRef(s.from) : null,
        to_item_id: s.kind === "connector" ? resolveRef(s.to) : null,
      };
      if (s.kind === "connector" && (!raw.from_item_id || !raw.to_item_id)) {
        errors.push({ id: null, error: `Connector ${s.from ?? "?"} → ${s.to ?? "?"}: both ends must be existing item ids or refs in this batch` });
        continue;
      }
      const n = normalizeItemInput(raw);
      if (!n.ok) {
        errors.push({ id: null, error: n.error });
        continue;
      }
      built[index] = n.item;
      if (n.item.kind !== "connector") working.push({ ...toWorking(n.item, board.id) });
    }
  }

  const upserts: unknown[] = built.filter(Boolean);
  for (const [id, size] of growth) {
    const f = existing.find((e) => e.id === id);
    if (f) upserts.push({ ...f, ...size });
  }

  const result = await writeItems(board.id, userId, { upserts }, stamp);
  const applied = new Set(result.applied);
  const created = built
    .filter((b): b is ItemInput => !!b && applied.has(b.id))
    .map((b) => {
      const f = b.kind === "connector" ? null : frameOf(toWorking(b, board.id), working);
      return { id: b.id, kind: b.kind, text: b.text, frame: f ? f.text || f.id : null };
    });

  return {
    ...result,
    applied: result.applied.filter((id) => built.some((b) => b?.id === id)),
    errors: [...errors, ...result.errors],
    board: { ...board, version: result.version },
    refs: Object.fromEntries(Object.entries(refIds).filter(([, id]) => applied.has(id))),
    created,
  };
}

function toWorking(item: ItemInput, boardId: string): WhiteboardItem {
  return {
    ...item,
    board_id: boardId,
    rev: 0,
    source_actor: null,
    source_label: null,
    created_at: "",
    updated_at: "",
  };
}

/** Rough footprint for a block of text, so agent-written text does not overflow. */
function textSize(text: string): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.min(560, Math.max(160, longest * 9 + 24));
  const wrapped = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 9) / (w - 24))), 0);
  return { w, h: Math.max(DEFAULT_SIZE.text.h, wrapped * 26 + 20) };
}

/** Arrange the board tidily (see `tidyLayout`). Returns how many items moved. */
export async function tidyBoard(boardId: string, userId: string, stamp: ProvenanceStamp = HUMAN_STAMP) {
  await requireBoard(boardId, userId, true);
  const items = await loadItems(boardId);
  const changes = tidyLayout(items);
  if (!changes.length) {
    const { board } = await requireBoard(boardId, userId, false);
    return { version: board.version, moved: 0 };
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const result = await writeItems(
    boardId,
    userId,
    { upserts: changes.map((c) => ({ ...byId.get(c.id)!, ...c })) },
    stamp
  );
  return { version: result.version, moved: result.applied.length };
}

/**
 * Put existing items into new titled frames ("organize"): one frame per
 * group, side by side to the right of the board, each item moved inside its
 * group's frame. Used by the AI organiser and the `group_whiteboard_items`
 * tool; the grouping itself is decided by the caller.
 */
export async function groupItems(
  boardId: string,
  userId: string,
  groups: Array<{ title: string; item_ids: string[]; color?: BoardColor }>,
  stamp: ProvenanceStamp = HUMAN_STAMP
): Promise<WriteResult & { frames: Array<{ id: string; title: string; count: number }> }> {
  await requireBoard(boardId, userId, true);
  const items = await loadItems(boardId);
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = new Set<string>();
  const clean = groups
    .map((g) => ({
      title: String(g.title || "").trim().slice(0, 120) || "Group",
      color: g.color,
      members: (g.item_ids || [])
        .map((id) => byId.get(id))
        .filter((i): i is WhiteboardItem => !!i && i.kind !== "connector" && i.kind !== "frame" && !used.has(i.id))
        .map((i) => (used.add(i.id), i)),
    }))
    .filter((g) => g.members.length > 0);
  if (!clean.length) throw new WhiteboardError("None of those items can be grouped");

  // Lay out: frames in a row to the right of the rest of the board.
  const rest = items.filter((i) => !used.has(i.id));
  const frameSpecs = clean.map((g, index) => {
    const widest = Math.max(...g.members.map((m) => m.w));
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(g.members.length))));
    return { index, kind: "frame" as const, w: Math.max(360, cols * (widest + 32) + 48), h: 240 };
  });
  const { placements } = placeNewItems(rest, frameSpecs);

  const upserts: Record<string, unknown>[] = [];
  const frames: Array<{ id: string; title: string; count: number }> = [];
  clean.forEach((g, i) => {
    const p = placements[i];
    const frameId = newItemId();
    const frame = { id: frameId, kind: "frame" as const, x: p.x, y: p.y, w: p.w, h: p.h, z: -1000 + i, text: g.title, color: g.color ?? "white", props: {} };
    const { placements: inside, frameGrowth } = placeNewItems(
      [frame],
      g.members.map((m, index) => ({ index, kind: m.kind, w: m.w, h: m.h, frameId }))
    );
    const grown = frameGrowth[0];
    upserts.push(grown ? { ...frame, w: grown.w, h: grown.h } : frame);
    g.members.forEach((m, index) => {
      const spot = inside[index];
      upserts.push({ ...m, x: spot.x, y: spot.y });
    });
    frames.push({ id: frameId, title: g.title, count: g.members.length });
  });

  const result = await writeItems(boardId, userId, { upserts }, stamp);
  return { ...result, frames: frames.filter((f) => result.applied.includes(f.id)) };
}

// ─── Into the rest of the app ───────────────────────────────────────

/**
 * Turn stickies, text and shapes into real tasks, in the board's project
 * (and, on a note's board, linked to that note). Each item becomes a card
 * showing its task, in the same place, so the board keeps its shape and the
 * task list gains the work.
 */
export async function convertItemsToTasks(
  boardId: string,
  userId: string,
  itemIds: string[],
  stamp: ProvenanceStamp = HUMAN_STAMP
): Promise<WriteResult & { tasks: Array<{ id: string; title: string; item_id: string }> }> {
  const { board, access } = await requireBoard(boardId, userId, true);
  if (!itemIds.length) throw new WhiteboardError("Choose at least one item");
  const rows = await query<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM whiteboard_items WHERE board_id = ? AND id IN (${placeholders(itemIds.length)})`,
    [boardId, ...itemIds.slice(0, MAX_OPS_PER_REQUEST)]
  );
  const convertible = rows
    .map(toItem)
    .filter((i) => (i.kind === "sticky" || i.kind === "text" || i.kind === "shape") && i.text.trim());
  if (!convertible.length) throw new WhiteboardError("Only stickies, text and shapes with words in them become tasks");

  const noteId = board.scope === "note" ? board.note_id : null;
  const tasks: Array<{ id: string; title: string; item_id: string }> = [];
  for (const item of convertible) {
    const text = item.text.trim();
    const [first, ...rest] = text.split("\n");
    const title = first.trim().slice(0, 200);
    const description = rest.join("\n").trim() || null;
    const row = await queryOne<{ id: string }>(
      `INSERT INTO tasks (user_id, content, title, description, project_id, note_id, metadata, ${stampColumns()})
       VALUES (?, ?, ?, ?, ?, ?, ?, ${stampPlaceholders()})
       RETURNING id`,
      [
        userId,
        text,
        title,
        description,
        access.projectId,
        noteId,
        JSON.stringify({ whiteboard: { board_id: boardId, item_id: item.id } }),
        ...stampValues(stamp),
      ]
    );
    if (row?.id) tasks.push({ id: row.id, title, item_id: item.id });
  }

  const byItem = new Map(convertible.map((c) => [c.id, c]));
  const result = await writeItems(
    boardId,
    userId,
    {
      upserts: tasks.map((t) => {
        const item = byItem.get(t.item_id)!;
        return {
          id: item.id,
          kind: "card",
          x: item.x,
          y: item.y,
          w: DEFAULT_SIZE.card.w,
          h: DEFAULT_SIZE.card.h,
          z: item.z,
          text: t.title,
          color: item.color,
          ref_type: "task",
          ref_id: t.id,
        };
      }),
    },
    stamp
  );
  return { ...result, tasks };
}

/**
 * Write the board out as a note in the board's project: frames become
 * headings, items bullets. The note links back to its board in metadata.
 */
export async function saveBoardAsNote(
  boardId: string,
  userId: string,
  stamp: ProvenanceStamp = HUMAN_STAMP,
  title?: string
): Promise<{ id: string; slug: string; title: string }> {
  const view = await readBoard(boardId, userId);
  if (!canWrite(view.access.role)) throw new WhiteboardError("You can view this whiteboard but not change it", 403);
  const noteTitle = (title?.trim() || `${view.board.title} — whiteboard`).slice(0, 200);
  const content = boardToMarkdown(noteTitle, view.items, new Map(Object.entries(view.refs)));
  const base =
    noteTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .substring(0, 90) || "whiteboard";
  const clash = await queryOne<{ id: string }>(`SELECT id FROM notes WHERE user_id = ? AND slug = ?`, [userId, base]);
  const slug = clash ? `${base}-${Date.now()}` : base;
  const plain = content.replace(/[#*_`>-]/g, " ").replace(/\s+/g, " ").trim();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO notes (user_id, title, slug, content, content_plain, note_type, project_id, word_count, metadata, ${stampColumns()})
     VALUES (?, ?, ?, ?, ?, 'note', ?, ?, ?, ${stampPlaceholders()})
     RETURNING id`,
    [
      userId,
      noteTitle,
      slug,
      content,
      plain,
      view.access.projectId,
      plain.split(/\s+/).filter(Boolean).length,
      JSON.stringify({ whiteboard: { board_id: boardId } }),
      ...stampValues(stamp),
    ]
  );
  if (!row) throw new WhiteboardError("Couldn't save the note");
  return { id: row.id, slug, title: noteTitle };
}

// ─── Listing ────────────────────────────────────────────────────────

export interface BoardSummary {
  id: string;
  scope: BoardScope;
  title: string;
  project_id: string | null;
  project_name: string | null;
  project_slug: string | null;
  note_id: string | null;
  note_slug: string | null;
  item_count: number;
  updated_at: string;
}

/**
 * Boards this account can open: on its own projects and notes, and on
 * projects it collaborates on. Newest activity first.
 */
export async function listBoards(
  userId: string,
  options: { projectId?: string; limit?: number } = {}
): Promise<BoardSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const projectFilter = options.projectId ? `AND COALESCE(w.project_id, n.project_id) = ?` : "";
  const rows = await query<
    BoardSummary & { project_title: string | null; note_title: string | null; effective_project: string | null }
  >(
    `SELECT w.id, w.scope, w.project_id, w.note_id, w.updated_at,
            COALESCE(p.name, np.name) AS project_name,
            COALESCE(p.slug, np.slug) AS project_slug,
            p.name AS project_title, n.title AS note_title, n.slug AS note_slug,
            COALESCE(w.project_id, n.project_id) AS effective_project,
            (SELECT COUNT(*) FROM whiteboard_items i WHERE i.board_id = w.id) AS item_count
     FROM whiteboards w
     LEFT JOIN projects p ON p.id = w.project_id
     LEFT JOIN notes n ON n.id = w.note_id
     LEFT JOIN projects np ON np.id = n.project_id
     WHERE (w.user_id = ?
        OR COALESCE(w.project_id, n.project_id) IN (
          SELECT project_id FROM project_collaborators WHERE user_id = ? AND status = 'accepted'))
       ${projectFilter}
     ORDER BY w.updated_at DESC
     LIMIT ?`,
    [userId, userId, ...(options.projectId ? [options.projectId] : []), limit]
  );
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    title: (r.scope === "project" ? r.project_title : r.note_title) || "Untitled",
    project_id: r.effective_project ?? null,
    project_name: r.project_name ?? null,
    project_slug: r.project_slug ?? null,
    note_id: r.note_id,
    note_slug: r.note_slug ?? null,
    item_count: Number(r.item_count) || 0,
    updated_at: r.updated_at,
  }));
}

export interface WorkspaceTab {
  scope: BoardScope;
  /** Project id or note id. */
  target_id: string;
  title: string;
  slug: string | null;
  board_id: string | null;
  item_count: number;
  is_pinned?: boolean;
  updated_at: string | null;
}

/**
 * The tabs of a project's whiteboard space: the project's own board first,
 * then one tab per note in the project, pinned and recently edited first.
 * A note without a board yet still gets a tab; opening it starts the board.
 */
export async function projectWorkspace(
  projectId: string,
  userId: string
): Promise<{ project: { id: string; name: string; slug: string }; role: BoardRole; tabs: WorkspaceTab[] }> {
  const access = await getProjectAccess(projectId, userId);
  if (!access) throw new WhiteboardError("Project not found", 404);
  const board = await queryOne<{ id: string; updated_at: string; item_count: number }>(
    `SELECT w.id, w.updated_at, (SELECT COUNT(*) FROM whiteboard_items i WHERE i.board_id = w.id) AS item_count
     FROM whiteboards w WHERE w.scope = 'project' AND w.project_id = ?`,
    [projectId]
  );
  const notes = await query<{
    id: string;
    title: string;
    slug: string;
    is_pinned: number;
    updated_at: string;
    board_id: string | null;
    item_count: number | null;
  }>(
    `SELECT n.id, n.title, n.slug, n.is_pinned, n.updated_at, w.id AS board_id,
            (SELECT COUNT(*) FROM whiteboard_items i WHERE i.board_id = w.id) AS item_count
     FROM notes n
     LEFT JOIN whiteboards w ON w.scope = 'note' AND w.note_id = n.id
     WHERE n.project_id = ? AND COALESCE(n.is_archived, 0) = 0
     ORDER BY n.is_pinned DESC, (w.id IS NOT NULL) DESC, n.updated_at DESC
     LIMIT 100`,
    [projectId]
  );
  return {
    project: { id: access.project.id, name: access.project.name, slug: access.project.slug },
    role: access.role,
    tabs: [
      {
        scope: "project",
        target_id: projectId,
        title: access.project.name,
        slug: access.project.slug,
        board_id: board?.id ?? null,
        item_count: Number(board?.item_count) || 0,
        updated_at: board?.updated_at ?? null,
      },
      ...notes.map((n) => ({
        scope: "note" as const,
        target_id: n.id,
        title: n.title || "Untitled",
        slug: n.slug,
        board_id: n.board_id,
        item_count: Number(n.item_count) || 0,
        is_pinned: !!Number(n.is_pinned),
        updated_at: n.updated_at,
      })),
    ],
  };
}
