/**
 * The whiteboard vocabulary, with no imports.
 *
 * Shared by the browser canvas, the API routes and the MCP tools (which run
 * outside Next.js), so it must not reach for a DB client. Same reasoning as
 * `chat/item-types.ts` and `operations/types.ts`.
 *
 * A board belongs to exactly one project or one note. It is a container of
 * items; every item is its own row, so an agent adding three stickies and a
 * person dragging a fourth never overwrite each other's work.
 */

export const BOARD_SCOPES = ["project", "note"] as const;
export type BoardScope = (typeof BOARD_SCOPES)[number];

export const ITEM_KINDS = [
  "sticky",
  "text",
  "shape",
  "frame",
  "connector",
  "card",
  "ink",
] as const;
export type WhiteboardItemKind = (typeof ITEM_KINDS)[number];

export const SHAPES = ["rect", "ellipse", "diamond"] as const;
export type ShapeKind = (typeof SHAPES)[number];

/** What a `card` points at. The card shows the record live, never a copy. */
export const CARD_REF_TYPES = ["note", "task"] as const;
export type CardRefType = (typeof CARD_REF_TYPES)[number];

/**
 * Named colours rather than hex, so an agent says "yellow" and the canvas
 * decides what yellow looks like in light and dark themes.
 */
export const BOARD_COLORS = [
  "yellow",
  "orange",
  "pink",
  "red",
  "purple",
  "blue",
  "teal",
  "green",
  "gray",
  "white",
] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

export type BoardRole = "owner" | "editor" | "viewer";

export interface WhiteboardItemProps {
  shape?: ShapeKind;
  /** Text size in board units. */
  fontSize?: number;
  /** Ink: points relative to the item's x/y. */
  points?: Array<[number, number]>;
  strokeWidth?: number;
  /** Connector: draw an arrowhead at the target end (default true). */
  arrow?: boolean;
  /** Connector: free endpoints when not attached to an item. */
  start?: [number, number];
  end?: [number, number];
}

export interface WhiteboardItem {
  id: string;
  board_id: string;
  kind: WhiteboardItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text: string;
  color: BoardColor;
  props: WhiteboardItemProps;
  from_item_id: string | null;
  to_item_id: string | null;
  ref_type: CardRefType | null;
  ref_id: string | null;
  /** Board version of the write that last touched this item. */
  rev: number;
  source_actor: string | null;
  source_label: string | null;
  created_at: string;
  updated_at: string;
}

/** Live view of what a card points at, resolved on every read. */
export interface CardRef {
  type: CardRefType;
  id: string;
  title: string;
  /** Notes: slug. Tasks: null. */
  slug: string | null;
  /** Tasks: pending / in_progress / completed / cancelled. */
  status: string | null;
  due_date: string | null;
  /** Notes: has a whiteboard of its own. */
  has_board?: boolean;
  missing?: boolean;
}

export interface Whiteboard {
  id: string;
  scope: BoardScope;
  project_id: string | null;
  note_id: string | null;
  /** Owner of the project or note, whoever is looking. */
  user_id: string;
  title: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// ─── Limits ─────────────────────────────────────────────────────────

export const MAX_ITEMS_PER_BOARD = 3000;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_INK_POINTS = 2000;
export const MAX_OPS_PER_REQUEST = 500;
const COORD_LIMIT = 1_000_000;
const MIN_SIZE = 8;
const MAX_SIZE = 20_000;

/** Default footprint per kind, so an agent can omit sizes. */
export const DEFAULT_SIZE: Record<WhiteboardItemKind, { w: number; h: number }> = {
  sticky: { w: 200, h: 200 },
  text: { w: 280, h: 60 },
  shape: { w: 200, h: 140 },
  frame: { w: 760, h: 520 },
  connector: { w: 0, h: 0 },
  card: { w: 260, h: 120 },
  ink: { w: 0, h: 0 },
};

const DEFAULT_COLOR: Record<WhiteboardItemKind, BoardColor> = {
  sticky: "yellow",
  text: "gray",
  shape: "blue",
  frame: "white",
  connector: "gray",
  card: "white",
  ink: "gray",
};

export function isBoardScope(v: unknown): v is BoardScope {
  return typeof v === "string" && (BOARD_SCOPES as readonly string[]).includes(v);
}
export function isItemKind(v: unknown): v is WhiteboardItemKind {
  return typeof v === "string" && (ITEM_KINDS as readonly string[]).includes(v);
}
export function isBoardColor(v: unknown): v is BoardColor {
  return typeof v === "string" && (BOARD_COLORS as readonly string[]).includes(v);
}
export function isCardRefType(v: unknown): v is CardRefType {
  return typeof v === "string" && (CARD_REF_TYPES as readonly string[]).includes(v);
}

/** Ids are client-generated (so creation is idempotent); keep them boring. */
export function isValidItemId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v);
}

function num(v: unknown, fallback: number, min = -COORD_LIMIT, max = COORD_LIMIT): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function point(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const [x, y] = v;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return [num(x, 0), num(y, 0)];
}

/** The writable part of an item, as a client or agent sends it. */
export interface ItemInput {
  id: string;
  kind: WhiteboardItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text: string;
  color: BoardColor;
  props: WhiteboardItemProps;
  from_item_id: string | null;
  to_item_id: string | null;
  ref_type: CardRefType | null;
  ref_id: string | null;
}

export type NormalizeResult = { ok: true; item: ItemInput } | { ok: false; error: string };

/**
 * Validate and clamp one item from an untrusted source. Unknown fields are
 * dropped; out-of-range numbers are clamped rather than rejected, because a
 * dragged item that lands at 1,000,001 is still the user's work.
 */
export function normalizeItemInput(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Item must be an object" };
  const r = raw as Record<string, unknown>;
  if (!isValidItemId(r.id)) return { ok: false, error: "Item id must be 6-64 letters, digits, - or _" };
  if (!isItemKind(r.kind)) return { ok: false, error: `Unknown kind "${String(r.kind)}"` };
  const kind = r.kind;
  const size = DEFAULT_SIZE[kind];
  const spatial = kind !== "connector";

  const text = typeof r.text === "string" ? r.text.slice(0, MAX_TEXT_LENGTH) : "";
  const color = isBoardColor(r.color) ? r.color : DEFAULT_COLOR[kind];

  const rawProps = (r.props && typeof r.props === "object" ? r.props : {}) as Record<string, unknown>;
  const props: WhiteboardItemProps = {};
  if (kind === "shape") {
    props.shape = (SHAPES as readonly string[]).includes(rawProps.shape as string)
      ? (rawProps.shape as ShapeKind)
      : "rect";
  }
  if (kind === "text" || kind === "sticky" || kind === "shape") {
    if (rawProps.fontSize !== undefined) props.fontSize = num(rawProps.fontSize, 18, 8, 160);
  }
  if (kind === "ink") {
    const pts = Array.isArray(rawProps.points) ? rawProps.points : [];
    props.points = pts
      .slice(0, MAX_INK_POINTS)
      .map(point)
      .filter((p): p is [number, number] => !!p);
    if (props.points.length < 1) return { ok: false, error: "Ink needs at least one point" };
    props.strokeWidth = num(rawProps.strokeWidth, 3, 1, 40);
  }
  if (kind === "connector") {
    props.arrow = rawProps.arrow !== false;
    const start = point(rawProps.start);
    const end = point(rawProps.end);
    if (start) props.start = start;
    if (end) props.end = end;
  }

  const from = typeof r.from_item_id === "string" && isValidItemId(r.from_item_id) ? r.from_item_id : null;
  const to = typeof r.to_item_id === "string" && isValidItemId(r.to_item_id) ? r.to_item_id : null;
  if (kind === "connector") {
    if (!(from || props.start) || !(to || props.end)) {
      return { ok: false, error: "A connector needs a start and an end (an item id or a point)" };
    }
    if (from && to && from === to) return { ok: false, error: "A connector cannot join an item to itself" };
  }

  let refType: CardRefType | null = null;
  let refId: string | null = null;
  if (kind === "card") {
    if (!isCardRefType(r.ref_type) || typeof r.ref_id !== "string" || !r.ref_id.trim()) {
      return { ok: false, error: 'A card needs ref_type ("note" or "task") and ref_id' };
    }
    refType = r.ref_type;
    refId = r.ref_id.trim().slice(0, 64);
  }

  return {
    ok: true,
    item: {
      id: r.id,
      kind,
      x: spatial ? num(r.x, 0) : 0,
      y: spatial ? num(r.y, 0) : 0,
      w: spatial && kind !== "ink" ? num(r.w, size.w, MIN_SIZE, MAX_SIZE) : num(r.w, 0, 0, MAX_SIZE),
      h: spatial && kind !== "ink" ? num(r.h, size.h, MIN_SIZE, MAX_SIZE) : num(r.h, 0, 0, MAX_SIZE),
      z: num(r.z, 0, -1e9, 1e9),
      text,
      color,
      props,
      from_item_id: kind === "connector" ? from : null,
      to_item_id: kind === "connector" ? to : null,
      ref_type: refType,
      ref_id: refId,
    },
  };
}

/** Parse a stored props column; a corrupt one reads as empty. */
export function parseProps(raw: unknown): WhiteboardItemProps {
  if (raw && typeof raw === "object") return raw as WhiteboardItemProps;
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Short, URL-safe id. The browser and server both mint them. */
export function newItemId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "wi_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `project:<id>` / `note:<id>`: how a board is addressed in a URL tab. */
export function encodeBoardTarget(scope: BoardScope, id: string): string {
  return `${scope}:${id}`;
}

export function parseBoardTarget(value: string | null | undefined): { scope: BoardScope; id: string } | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i <= 0) return null;
  const scope = value.slice(0, i);
  const id = value.slice(i + 1).trim();
  if (!isBoardScope(scope) || !id) return null;
  return { scope, id };
}
