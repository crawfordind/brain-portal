/**
 * Geometry and layout for whiteboards. Pure: no DB, no DOM.
 *
 * Agents rarely know where things should go, so they may omit coordinates
 * and name a frame instead; `placeNewItems` decides. The same rules lay out
 * the canvas's "Tidy" and the AI organiser, so a board arranged by an agent
 * looks like one arranged by a person pressing a button.
 *
 * Frame membership is geometric (an item belongs to the frame its centre
 * sits in) and never stored, so moving an item out of a frame needs no
 * bookkeeping and cannot leave a stale parent behind.
 */

import {
  DEFAULT_SIZE,
  type CardRef,
  type WhiteboardItem,
  type WhiteboardItemKind,
} from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Spatial = Pick<WhiteboardItem, "id" | "kind" | "x" | "y" | "w" | "h" | "z" | "props"> &
  Partial<Pick<WhiteboardItem, "from_item_id" | "to_item_id">>;

export const GAP = 32;
export const FRAME_PADDING = 40;
/** Room under a frame's top edge for its title. */
export const FRAME_HEADER = 48;

export function isSpatial(kind: WhiteboardItemKind): boolean {
  return kind !== "connector";
}

/** Bounds of one item. Ink is measured from its points. */
export function itemRect(item: Spatial): Rect {
  if (item.kind === "ink" && item.props?.points?.length) {
    const xs = item.props.points.map((p) => p[0]);
    const ys = item.props.points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: item.x + minX,
      y: item.y + minY,
      w: Math.max(1, Math.max(...xs) - minX),
      h: Math.max(1, Math.max(...ys) - minY),
    };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boardBounds(items: Spatial[]): Rect | null {
  return unionRect(items.filter((i) => isSpatial(i.kind)).map(itemRect));
}

export function center(r: Rect): [number, number] {
  return [r.x + r.w / 2, r.y + r.h / 2];
}

export function containsPoint(r: Rect, [px, py]: [number, number]): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * The frame an item sits in: the smallest frame containing its centre. A
 * frame can sit inside a larger one.
 */
export function frameOf<T extends Spatial>(item: T, items: T[]): T | null {
  if (!isSpatial(item.kind)) return null;
  const c = center(itemRect(item));
  const own = itemRect(item);
  let best: T | null = null;
  for (const f of items) {
    if (f.kind !== "frame" || f.id === item.id) continue;
    // A frame cannot be inside a frame no larger than itself.
    if (item.kind === "frame" && f.w * f.h <= own.w * own.h) continue;
    if (!containsPoint(itemRect(f), c)) continue;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  }
  return best;
}

/** Items directly inside a frame (not inside a smaller frame within it). */
export function childrenOf<T extends Spatial>(frame: T, items: T[]): T[] {
  return items.filter((i) => i.id !== frame.id && frameOf(i, items)?.id === frame.id);
}

/** Every item inside a frame, at any depth. Used to move a frame with its contents. */
export function descendantsOf<T extends Spatial>(frame: T, items: T[]): T[] {
  const out: T[] = [];
  const queue = [frame];
  while (queue.length) {
    const f = queue.shift()!;
    for (const c of childrenOf(f, items)) {
      out.push(c);
      if (c.kind === "frame") queue.push(c);
    }
  }
  return out;
}

/** Find a frame by its title, case- and space-insensitively. */
export function findFrameByTitle<T extends Spatial & { text: string }>(items: T[], title: string): T | null {
  const key = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return (
    items.find((i) => i.kind === "frame" && i.text.trim().toLowerCase().replace(/\s+/g, " ") === key) ?? null
  );
}

// ─── Placement ──────────────────────────────────────────────────────

export interface PlacementRequest {
  /** Index into the caller's list, so results can be matched back. */
  index: number;
  kind: WhiteboardItemKind;
  w?: number;
  h?: number;
  /** Already-positioned items are left alone. */
  x?: number;
  y?: number;
  /** Place inside this frame (an existing frame's id). */
  frameId?: string | null;
}

export interface Placement {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Columns a grid uses for `count` items: roughly square, never more than 5. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.min(5, Math.ceil(Math.sqrt(count))));
}

/**
 * Lay `sizes` out in rows starting at (originX, originY), wrapping after
 * `columns`. Each row is as tall as its tallest item.
 */
export function gridLayout(
  sizes: Array<{ w: number; h: number }>,
  originX: number,
  originY: number,
  columns = gridColumns(sizes.length),
  gap = GAP
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let y = originY;
  for (let row = 0; row * columns < sizes.length; row++) {
    const slice = sizes.slice(row * columns, row * columns + columns);
    let x = originX;
    for (const s of slice) {
      out.push({ x, y });
      x += s.w + gap;
    }
    y += Math.max(...slice.map((s) => s.h)) + gap;
  }
  return out;
}

/**
 * Positions for new items that arrived without coordinates.
 *
 * - With a frame: after the frame's existing children, flowing in a grid
 *   inside its padding. The frame's required growth is returned so the
 *   caller can enlarge it rather than spill items over its edge.
 * - Without: in a grid to the right of everything on the board, top-aligned,
 *   so new work never lands on top of old work. An empty board starts at 0,0.
 */
export function placeNewItems(
  existing: Spatial[],
  requests: PlacementRequest[]
): { placements: Placement[]; frameGrowth: Array<{ id: string; w: number; h: number }> } {
  const placements: Placement[] = [];
  const growth = new Map<string, { w: number; h: number }>();

  const sized = requests.map((r) => ({
    ...r,
    w: r.w ?? DEFAULT_SIZE[r.kind].w,
    h: r.h ?? DEFAULT_SIZE[r.kind].h,
  }));

  for (const r of sized) {
    if (typeof r.x === "number" && typeof r.y === "number") {
      placements.push({ index: r.index, x: r.x, y: r.y, w: r.w, h: r.h });
    }
  }

  const unplaced = sized.filter((r) => !(typeof r.x === "number" && typeof r.y === "number"));

  // Group by frame, preserving request order.
  const byFrame = new Map<string, typeof unplaced>();
  const loose: typeof unplaced = [];
  for (const r of unplaced) {
    const frame = r.frameId ? existing.find((e) => e.id === r.frameId && e.kind === "frame") : null;
    if (frame) {
      const list = byFrame.get(frame.id) ?? [];
      list.push(r);
      byFrame.set(frame.id, list);
    } else {
      loose.push(r);
    }
  }

  for (const [frameId, list] of byFrame) {
    const frame = existing.find((e) => e.id === frameId)!;
    const children = childrenOf(frame, existing);
    const innerX = frame.x + FRAME_PADDING;
    const innerW = Math.max(frame.w - FRAME_PADDING * 2, 200);
    // Continue below what is already there.
    const below = unionRect(children.map(itemRect));
    const startY = below ? below.y + below.h + GAP : frame.y + FRAME_HEADER;
    const widest = Math.max(...list.map((r) => r.w));
    const columns = Math.max(1, Math.floor((innerW + GAP) / (widest + GAP)));
    const spots = gridLayout(list, innerX, startY, columns);
    list.forEach((r, i) => placements.push({ index: r.index, x: spots[i].x, y: spots[i].y, w: r.w, h: r.h }));

    const placed = unionRect(list.map((r, i) => ({ x: spots[i].x, y: spots[i].y, w: r.w, h: r.h })))!;
    const needW = placed.x + placed.w + FRAME_PADDING - frame.x;
    const needH = placed.y + placed.h + FRAME_PADDING - frame.y;
    if (needW > frame.w || needH > frame.h) {
      growth.set(frameId, { w: Math.max(frame.w, needW), h: Math.max(frame.h, needH) });
    }
  }

  if (loose.length) {
    const bounds = boardBounds([
      ...existing,
      ...placements.map((p) => ({ id: "", kind: "sticky" as const, x: p.x, y: p.y, w: p.w, h: p.h, z: 0, props: {} })),
    ]);
    const originX = bounds ? bounds.x + bounds.w + GAP * 2 : 0;
    const originY = bounds ? bounds.y : 0;
    // Frames go side by side; everything else in a grid.
    const frames = loose.filter((r) => r.kind === "frame");
    const rest = loose.filter((r) => r.kind !== "frame");
    let x = originX;
    for (const f of frames) {
      placements.push({ index: f.index, x, y: originY, w: f.w, h: f.h });
      x += f.w + GAP * 2;
    }
    const spots = gridLayout(rest, x, originY);
    rest.forEach((r, i) => placements.push({ index: r.index, x: spots[i].x, y: spots[i].y, w: r.w, h: r.h }));
  }

  placements.sort((a, b) => a.index - b.index);
  return {
    placements,
    frameGrowth: [...growth].map(([id, size]) => ({ id, ...size })),
  };
}

/**
 * "Tidy": every frame's direct children in a grid inside it (frames resized
 * to fit), loose items in a grid to the right of the frames. Returns only the
 * items whose position or size changed.
 */
export function tidyLayout<T extends Spatial>(items: T[]): Array<Pick<T, "id" | "x" | "y" | "w" | "h">> {
  const changes = new Map<string, { id: string; x: number; y: number; w: number; h: number }>();
  const current = new Map(items.map((i) => [i.id, { ...i }]));
  const get = (id: string) => current.get(id)!;
  const move = (id: string, patch: Partial<Rect>) => {
    const it = get(id);
    Object.assign(it, patch);
    changes.set(id, { id, x: it.x, y: it.y, w: it.w, h: it.h });
  };

  // Top-level frames, in reading order.
  const frames = items
    .filter((i) => i.kind === "frame" && !frameOf(i, items))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const membership = new Map(frames.map((f) => [f.id, childrenOf(f, items).filter((c) => isSpatial(c.kind))]));
  const loose = items.filter(
    (i) => isSpatial(i.kind) && i.kind !== "frame" && i.kind !== "ink" && !frameOf(i, items)
  );

  let cursorX = frames.length ? Math.min(...frames.map((f) => f.x)) : 0;
  const top = frames.length ? Math.min(...frames.map((f) => f.y)) : 0;

  for (const frame of frames) {
    const kids = (membership.get(frame.id) ?? []).sort((a, b) => a.y - b.y || a.x - b.x);
    const dx = cursorX - frame.x;
    const dy = top - frame.y;
    move(frame.id, { x: cursorX, y: top });
    if (kids.length) {
      const spots = gridLayout(kids, cursorX + FRAME_PADDING, top + FRAME_HEADER, gridColumns(kids.length));
      kids.forEach((k, i) => {
        // A nested frame moves with its own contents.
        if (k.kind === "frame") {
          for (const d of descendantsOf(k, items)) {
            const it = get(d.id);
            move(d.id, { x: it.x + (spots[i].x - k.x), y: it.y + (spots[i].y - k.y) });
          }
        }
        move(k.id, { x: spots[i].x, y: spots[i].y });
      });
      const box = unionRect(kids.map((k) => itemRect(get(k.id))))!;
      move(frame.id, {
        w: Math.max(320, box.x + box.w + FRAME_PADDING - cursorX),
        h: Math.max(240, box.y + box.h + FRAME_PADDING - top),
      });
    } else {
      // Ink and other non-grid children ride along with the frame.
      for (const d of descendantsOf(frame, items)) {
        const it = get(d.id);
        move(d.id, { x: it.x + dx, y: it.y + dy });
      }
    }
    cursorX += get(frame.id).w + GAP * 2;
  }

  if (loose.length) {
    const sorted = [...loose].sort((a, b) => a.y - b.y || a.x - b.x);
    const spots = gridLayout(sorted, cursorX, top);
    sorted.forEach((l, i) => move(l.id, { x: spots[i].x, y: spots[i].y }));
  }

  // Report only what actually moved.
  return [...changes.values()].filter((c) => {
    const before = items.find((i) => i.id === c.id)!;
    return before.x !== c.x || before.y !== c.y || before.w !== c.w || before.h !== c.h;
  }) as Array<Pick<T, "id" | "x" | "y" | "w" | "h">>;
}

// ─── Reading a board as text ────────────────────────────────────────

type OutlineItem = Pick<
  WhiteboardItem,
  "id" | "kind" | "x" | "y" | "w" | "h" | "z" | "text" | "color" | "props" | "from_item_id" | "to_item_id" | "ref_type" | "ref_id"
>;

function describe(item: OutlineItem, refs: Map<string, CardRef>, prose = false): string | null {
  const text = item.text.trim().replace(/\s+/g, " ");
  switch (item.kind) {
    case "sticky":
      if (prose) return text || null;
      return text ? `[${item.color} sticky] ${text}` : null;
    case "text":
      return text || null;
    case "shape":
      if (prose) return text || null;
      return text ? `[${item.props.shape ?? "rect"}] ${text}` : null;
    case "card": {
      const ref = item.ref_type && item.ref_id ? refs.get(`${item.ref_type}:${item.ref_id}`) : undefined;
      if (!ref) return prose ? text || null : `[${item.ref_type} card] ${text || item.ref_id}`;
      if (ref.missing) return prose ? text || null : `[${ref.type} card, deleted] ${text || ref.id}`;
      if (prose) {
        const done = ref.type === "task" ? (ref.status === "completed" ? "[x] " : "[ ] ") : "";
        return `${done}${ref.title}`;
      }
      const status = ref.type === "task" && ref.status ? `, ${ref.status}` : "";
      const due = ref.due_date ? `, due ${ref.due_date}` : "";
      // The record's own id, named apart from the item's id that follows.
      return `[${ref.type}${status}${due}] ${ref.title} (${ref.type} ${ref.id})`;
    }
    case "ink":
      return null;
    default:
      return text || null;
  }
}

function readingOrder(a: OutlineItem, b: OutlineItem): number {
  // Rows of roughly one sticky height, then left to right.
  const row = Math.floor(a.y / 160) - Math.floor(b.y / 160);
  return row || a.x - b.x;
}

/**
 * The board as an indented outline: frames with their contents, then loose
 * items, then the connections. This is what an agent or the chat reads, so
 * it names every item's id; positions are left out because they mean
 * nothing in prose.
 */
export function boardOutline(
  title: string,
  items: OutlineItem[],
  refs: Map<string, CardRef> = new Map(),
  options: { maxLines?: number } = {}
): string {
  const maxLines = options.maxLines ?? 400;
  const lines: string[] = [`Whiteboard: ${title}`];
  const byId = new Map(items.map((i) => [i.id, i]));
  const inkCount = items.filter((i) => i.kind === "ink").length;

  const walk = (parent: OutlineItem | null, depth: number) => {
    const kids = items
      .filter((i) => isSpatial(i.kind) && (frameOf(i, items)?.id ?? null) === (parent?.id ?? null))
      .sort(readingOrder);
    for (const k of kids) {
      const pad = "  ".repeat(depth);
      if (k.kind === "frame") {
        lines.push(`${pad}- Frame "${k.text.trim() || "Untitled"}" (id ${k.id})`);
        walk(k, depth + 1);
        continue;
      }
      const line = describe(k, refs);
      if (line) lines.push(`${pad}- ${line} (id ${k.id})`);
    }
  };
  walk(null, 0);

  const connectors = items.filter((i) => i.kind === "connector");
  if (connectors.length) {
    lines.push("Connections:");
    const name = (id: string | null) => {
      if (!id) return "a point";
      const it = byId.get(id);
      if (!it) return "a deleted item";
      const label = it.kind === "card" ? describe(it, refs) : it.text.trim().replace(/\s+/g, " ");
      return `"${(label || it.kind).slice(0, 60)}"`;
    };
    for (const c of connectors) {
      const label = c.text.trim() ? ` (${c.text.trim()})` : "";
      lines.push(`- ${name(c.from_item_id)} → ${name(c.to_item_id)}${label}`);
    }
  }
  if (inkCount) lines.push(`(${inkCount} hand-drawn stroke${inkCount === 1 ? "" : "s"} not shown)`);
  if (lines.length === 1) lines.push("(empty)");

  if (lines.length > maxLines) {
    const dropped = lines.length - maxLines;
    return [...lines.slice(0, maxLines), `… ${dropped} more line${dropped === 1 ? "" : "s"}`].join("\n");
  }
  return lines.join("\n");
}

/**
 * The board as a markdown note: frames become headings, their items bullets.
 * "Save as note" uses it; the note stands alone, so ids are left out.
 */
export function boardToMarkdown(title: string, items: OutlineItem[], refs: Map<string, CardRef> = new Map()): string {
  const out: string[] = [`# ${title}`, ""];
  const bullet = (i: OutlineItem) => {
    const line = describe(i, refs, true);
    return line ? `- ${line}` : null;
  };
  const top = items.filter((i) => isSpatial(i.kind) && !frameOf(i, items)).sort(readingOrder);
  const looseLines = top.filter((i) => i.kind !== "frame").map(bullet).filter(Boolean) as string[];
  if (looseLines.length) out.push(...looseLines, "");

  const section = (frame: OutlineItem, level: number) => {
    out.push(`${"#".repeat(Math.min(6, level))} ${frame.text.trim() || "Untitled"}`, "");
    const kids = childrenOf(frame, items).sort(readingOrder);
    const lines = kids.filter((k) => k.kind !== "frame").map(bullet).filter(Boolean) as string[];
    if (lines.length) out.push(...lines, "");
    for (const k of kids.filter((k) => k.kind === "frame")) section(k, level + 1);
  };
  for (const f of top.filter((i) => i.kind === "frame")) section(f, 2);

  const connectors = items.filter((i) => i.kind === "connector");
  if (connectors.length) {
    const name = (id: string | null) => {
      const it = id ? items.find((i) => i.id === id) : undefined;
      return it ? (it.kind === "card" ? describe(it, refs, true)?.replace(/^\[[ x]\] /, "") : it.text.trim()) || it.kind : "…";
    };
    out.push("## Connections", "");
    for (const c of connectors) {
      out.push(`- ${name(c.from_item_id)} → ${name(c.to_item_id)}${c.text.trim() ? ` (${c.text.trim()})` : ""}`);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// ─── Connectors ─────────────────────────────────────────────────────

/**
 * Where a line from `r`'s centre toward `toward` leaves `r`'s edge, so an
 * arrow starts and ends at the items' borders instead of their middles.
 */
export function edgePoint(r: Rect, toward: [number, number], ellipse = false): [number, number] {
  const [cx, cy] = center(r);
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = r.w / 2;
  const hh = r.h / 2;
  let t: number;
  if (ellipse) {
    t = 1 / Math.sqrt((dx * dx) / (hw * hw || 1) + (dy * dy) / (hh * hh || 1));
  } else {
    const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    t = Math.min(tx, ty);
  }
  return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)];
}

/** Both ends of a connector in board coordinates, or null when an end is gone. */
export function connectorEnds(
  connector: Pick<WhiteboardItem, "from_item_id" | "to_item_id" | "props">,
  byId: Map<string, Spatial>
): { start: [number, number]; end: [number, number] } | null {
  const from = connector.from_item_id ? byId.get(connector.from_item_id) : undefined;
  const to = connector.to_item_id ? byId.get(connector.to_item_id) : undefined;
  if (connector.from_item_id && !from) return null;
  if (connector.to_item_id && !to) return null;
  const fromRect = from ? itemRect(from) : null;
  const toRect = to ? itemRect(to) : null;
  const a: [number, number] | undefined = fromRect ? center(fromRect) : connector.props?.start;
  const b: [number, number] | undefined = toRect ? center(toRect) : connector.props?.end;
  if (!a || !b) return null;
  const isEllipse = (i?: Spatial) => i?.kind === "shape" && i.props?.shape === "ellipse";
  return {
    start: fromRect ? edgePoint(fromRect, b, isEllipse(from)) : a,
    end: toRect ? edgePoint(toRect, a, isEllipse(to)) : b,
  };
}
