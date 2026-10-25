"use client";

/**
 * The infinite canvas: pan, zoom, select, move, resize, draw, connect.
 *
 * Hand-built rather than a library, like the project dashboard's charts: no
 * licence watermark, nothing to configure for self-hosters, and every item
 * is an ordinary DOM node that inherits the app's theme.
 *
 * Coordinates: `screen = board * zoom + offset`. Pointer handling lives on
 * the root and resolves targets with `closest('[data-item-id]')`, so an item
 * needs no handlers of its own. Every gesture previews locally and commits
 * once at the end, which is what makes a drag one undo step and one save.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  boardBounds,
  connectorEnds,
  descendantsOf,
  gridLayout,
  intersects,
  itemRect,
  type Rect,
} from "@/lib/whiteboards/layout";
import {
  DEFAULT_SIZE,
  newItemId,
  type BoardColor,
  type CardRef,
  type ShapeKind,
  type WhiteboardItem,
  type WhiteboardItemKind,
} from "@/lib/whiteboards/types";
import { COLOR_STYLES } from "./board-styles";
import { ItemView, type Handle } from "./item-view";
import type { WhiteboardState } from "./use-whiteboard";

export type Tool = "select" | "hand" | "sticky" | "text" | "shape" | "frame" | "connector" | "pen" | "eraser";

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

type Drag =
  | { mode: "pan"; startX: number; startY: number; cam: Camera }
  | { mode: "move"; startX: number; startY: number; origin: Map<string, WhiteboardItem>; moved: boolean }
  | { mode: "resize"; handle: Handle; startX: number; startY: number; origin: WhiteboardItem }
  | { mode: "marquee"; startX: number; startY: number; x: number; y: number; additive: Set<string> }
  | { mode: "frame"; startX: number; startY: number; x: number; y: number }
  | { mode: "connect"; fromId: string; x: number; y: number }
  | { mode: "draw"; points: Array<[number, number]> }
  | { mode: "erase"; erased: Map<string, WhiteboardItem> }
  | { mode: "pinch"; startDist: number; startMid: [number, number]; cam: Camera };

export interface CanvasHandle {
  zoomBy: (factor: number) => void;
  zoomToFit: () => void;
  resetZoom: () => void;
  /** Board point at the centre of the view, for placing new things. */
  viewCenter: () => [number, number];
  /** Copy the selection (frames with their contents) one step down-right. */
  duplicateSelection: () => void;
}

interface WhiteboardCanvasProps {
  state: WhiteboardState;
  tool: Tool;
  setTool: (tool: Tool) => void;
  color: BoardColor;
  shape: ShapeKind;
  selection: Set<string>;
  setSelection: (next: Set<string>) => void;
  camera: Camera;
  setCamera: (next: Camera | ((c: Camera) => Camera)) => void;
  onToggleTask: (ref: CardRef) => void;
  onOpenNoteBoard?: (noteId: string) => void;
  /** Registers zoom controls for the toolbar. */
  controlsRef: React.MutableRefObject<CanvasHandle | null>;
  /** Shown over an empty board. */
  emptyState?: React.ReactNode;
}

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Thin out a freehand stroke: drop points closer than `min` to the last kept one. */
function simplify(points: Array<[number, number]>, min = 2): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= min) out.push(p);
  }
  return out;
}

function inkPath(points: Array<[number, number]>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]} l0.01,0`;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    d += ` Q${x1},${y1} ${(x1 + x2) / 2},${(y1 + y2) / 2}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

export function makeItem(
  boardId: string,
  kind: WhiteboardItemKind,
  fields: Partial<WhiteboardItem> & { x: number; y: number },
  topZ: number
): WhiteboardItem {
  const size = DEFAULT_SIZE[kind];
  const now = new Date().toISOString();
  return {
    id: newItemId(),
    board_id: boardId,
    kind,
    w: size.w,
    h: size.h,
    z: kind === "frame" ? -1000 + (topZ % 1000) : topZ + 1,
    text: "",
    color: kind === "frame" ? "white" : kind === "text" ? "gray" : "yellow",
    props: {},
    from_item_id: null,
    to_item_id: null,
    ref_type: null,
    ref_id: null,
    rev: 0,
    source_actor: null,
    source_label: null,
    created_at: now,
    updated_at: now,
    ...fields,
  };
}

export function WhiteboardCanvas({
  state,
  tool,
  setTool,
  color,
  shape,
  selection,
  setSelection,
  camera,
  setCamera,
  onToggleTask,
  onOpenNoteBoard,
  controlsRef,
  emptyState,
}: WhiteboardCanvasProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pointers = useRef(new Map<number, [number, number]>());
  /** The board's own clipboard, and the text it put on the system one. */
  const clipboard = useRef<{ items: WhiteboardItem[]; text: string }>({ items: [], text: "" });
  const camRef = useRef(camera);
  useLayoutEffect(() => {
    camRef.current = camera;
  }, [camera]);

  const { items, itemsById, refs, commit, preview, canEdit, board } = state;
  const boardId = board?.id ?? "";
  const topZ = useMemo(() => items.reduce((m, i) => Math.max(m, i.z), 0), [items]);

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ─── Coordinates ────────────────────────────────────────────────
  const toBoard = useCallback((clientX: number, clientY: number): [number, number] => {
    const rect = rootRef.current?.getBoundingClientRect();
    const c = camRef.current;
    return [(clientX - (rect?.left ?? 0) - c.x) / c.z, (clientY - (rect?.top ?? 0) - c.y) / c.z];
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
      setCamera((c) => {
        const z = clampZoom(c.z * factor);
        const k = z / c.z;
        return { z, x: px - (px - c.x) * k, y: py - (py - c.y) * k };
      });
    },
    [setCamera]
  );

  const zoomToFit = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const bounds = boardBounds(items);
    if (!rect) return;
    if (!bounds) {
      setCamera({ x: rect.width / 2, y: rect.height / 2, z: 1 });
      return;
    }
    const pad = 64;
    const z = clampZoom(Math.min((rect.width - pad * 2) / bounds.w, (rect.height - pad * 2) / bounds.h, 1.5));
    setCamera({
      z,
      x: rect.width / 2 - (bounds.x + bounds.w / 2) * z,
      y: rect.height / 2 - (bounds.y + bounds.h / 2) * z,
    });
  }, [items, setCamera]);

  useEffect(() => {
    controlsRef.current = {
      zoomBy: (f) => zoomAt(f),
      zoomToFit,
      resetZoom: () => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        setCamera((c) => {
          const cx = (rect.width / 2 - c.x) / c.z;
          const cy = (rect.height / 2 - c.y) / c.z;
          return { z: 1, x: rect.width / 2 - cx, y: rect.height / 2 - cy };
        });
      },
      viewCenter: () => {
        const rect = rootRef.current?.getBoundingClientRect();
        const c = camRef.current;
        if (!rect) return [0, 0];
        return [(rect.width / 2 - c.x) / c.z, (rect.height / 2 - c.y) / c.z];
      },
      duplicateSelection: controlsRef.current?.duplicateSelection ?? (() => {}),
    };
  }, [controlsRef, zoomAt, zoomToFit, setCamera]);

  // Wheel: pinch / Ctrl+wheel zooms at the pointer, plain wheel pans.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setCamera]);

  // ─── Creating things ───────────────────────────────────────────
  const createAt = useCallback(
    (kind: WhiteboardItemKind, bx: number, by: number, extra: Partial<WhiteboardItem> = {}) => {
      if (!canEdit || !boardId) return null;
      const size = DEFAULT_SIZE[kind];
      const item = makeItem(
        boardId,
        kind,
        {
          x: Math.round(bx - (extra.w ?? size.w) / 2),
          y: Math.round(by - (extra.h ?? size.h) / 2),
          color: kind === "frame" ? "white" : kind === "text" ? "gray" : color,
          props: kind === "shape" ? { shape } : {},
          text: kind === "frame" ? "Frame" : "",
          ...extra,
        },
        topZ
      );
      commit([item]);
      setSelection(new Set([item.id]));
      if (kind !== "frame") setEditingId(item.id);
      return item;
    },
    [boardId, canEdit, color, commit, setSelection, shape, topZ]
  );

  const commitText = useCallback(
    (id: string, text: string) => {
      setEditingId(null);
      const item = itemsById.get(id);
      if (!item) return;
      // An empty new text box is a mis-click, not content.
      if (!text.trim() && item.kind === "text" && !item.text) {
        commit([], [id]);
        return;
      }
      if (text !== item.text) commit([{ ...item, text }]);
    },
    [commit, itemsById]
  );

  // ─── Pointer ───────────────────────────────────────────────────
  const itemAt = (target: EventTarget | null): WhiteboardItem | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-item-id]") as HTMLElement | null;
    const id = el?.dataset.itemId;
    return id ? itemsById.get(id) ?? null : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("textarea, button, a, input")) return;
    rootRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);

    // Two fingers: pinch-zoom and pan, whatever the tool.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setDragState({
        mode: "pinch",
        startDist: Math.hypot(a[0] - b[0], a[1] - b[1]),
        startMid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        cam: camRef.current,
      });
      state.setInteracting(true);
      return;
    }
    if (pointers.current.size > 2) return;

    // Finish an edit by blurring, which saves the text; unmounting the
    // textarea first would drop what was typed.
    if (editingId) (document.activeElement as HTMLElement | null)?.blur?.();
    const [bx, by] = toBoard(e.clientX, e.clientY);
    const hit = itemAt(e.target);
    const handle = (e.target as HTMLElement).closest("[data-handle]") as HTMLElement | null;

    const pan = e.button === 1 || spaceHeld || tool === "hand";
    if (pan) {
      setDragState({ mode: "pan", startX: e.clientX, startY: e.clientY, cam: camRef.current });
      return;
    }
    if (e.button !== 0) return;
    state.setInteracting(true);

    switch (tool) {
      case "sticky":
      case "text":
      case "shape": {
        createAt(tool, bx, by);
        setTool("select");
        state.setInteracting(false);
        return;
      }
      case "frame":
        if (!canEdit) return;
        setDragState({ mode: "frame", startX: bx, startY: by, x: bx, y: by });
        return;
      case "connector":
        if (hit && hit.kind !== "connector" && hit.kind !== "ink" && canEdit) {
          setDragState({ mode: "connect", fromId: hit.id, x: bx, y: by });
        }
        return;
      case "pen":
        if (!canEdit) return;
        setDragState({ mode: "draw", points: [[bx, by]] });
        return;
      case "eraser":
        if (!canEdit) return;
        setDragState({ mode: "erase", erased: new Map() });
        return;
    }

    // Select tool
    if (handle && hit && canEdit) {
      setDragState({ mode: "resize", handle: handle.dataset.handle as Handle, startX: bx, startY: by, origin: hit });
      return;
    }
    if (hit) {
      let next = selection;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        next = new Set(selection);
        if (next.has(hit.id)) next.delete(hit.id);
        else next.add(hit.id);
      } else if (!selection.has(hit.id)) {
        next = new Set([hit.id]);
      }
      setSelection(next);
      if (!canEdit || !next.has(hit.id)) return;
      // Moving a frame moves what is in it.
      const origin = new Map<string, WhiteboardItem>();
      for (const id of next) {
        const it = itemsById.get(id);
        if (!it || it.kind === "connector") continue;
        origin.set(id, it);
        if (it.kind === "frame") for (const d of descendantsOf(it, items)) origin.set(d.id, d);
      }
      setDragState({ mode: "move", startX: bx, startY: by, origin, moved: false });
      return;
    }
    // Empty canvas: a finger pans, a mouse draws a selection box.
    if (e.pointerType === "touch") {
      if (!(e.shiftKey || e.metaKey)) setSelection(new Set());
      setDragState({ mode: "pan", startX: e.clientX, startY: e.clientY, cam: camRef.current });
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(selection) : new Set<string>();
    if (!additive.size) setSelection(new Set());
    setDragState({ mode: "marquee", startX: bx, startY: by, x: bx, y: by, additive });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const d = dragRef.current;
    if (!d) return;

    if (d.mode === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const rect = rootRef.current!.getBoundingClientRect();
      const z = clampZoom(d.cam.z * (dist / (d.startDist || 1)));
      const k = z / d.cam.z;
      const sx = d.startMid[0] - rect.left;
      const sy = d.startMid[1] - rect.top;
      setCamera({
        z,
        x: sx - (sx - d.cam.x) * k + (mid[0] - d.startMid[0]),
        y: sy - (sy - d.cam.y) * k + (mid[1] - d.startMid[1]),
      });
      return;
    }
    if (d.mode === "pan") {
      setCamera({ ...d.cam, x: d.cam.x + (e.clientX - d.startX), y: d.cam.y + (e.clientY - d.startY) });
      return;
    }

    const [bx, by] = toBoard(e.clientX, e.clientY);
    switch (d.mode) {
      case "move": {
        const dx = bx - d.startX;
        const dy = by - d.startY;
        if (!d.moved && Math.hypot(dx, dy) * camRef.current.z < 3) return;
        d.moved = true;
        preview([...d.origin.values()].map((o) => ({ ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) })));
        return;
      }
      case "resize": {
        const o = d.origin;
        const dx = bx - d.startX;
        const dy = by - d.startY;
        let { x, y, w, h } = o;
        if (d.handle.includes("e")) w = o.w + dx;
        if (d.handle.includes("s")) h = o.h + dy;
        if (d.handle.includes("w")) {
          w = o.w - dx;
          x = o.x + dx;
        }
        if (d.handle.includes("n")) {
          h = o.h - dy;
          y = o.y + dy;
        }
        const min = o.kind === "frame" ? 120 : 40;
        if (w < min) {
          if (d.handle.includes("w")) x -= min - w;
          w = min;
        }
        if (h < min) {
          if (d.handle.includes("n")) y -= min - h;
          h = min;
        }
        // Stickies stay square unless Shift says otherwise.
        if (o.kind === "sticky" && !e.shiftKey) {
          const s = Math.max(w, h);
          if (d.handle.includes("w")) x = o.x + o.w - s;
          if (d.handle.includes("n")) y = o.y + o.h - s;
          w = h = s;
        }
        preview([{ ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }]);
        return;
      }
      case "marquee":
      case "frame":
        setDragState({ ...d, x: bx, y: by });
        if (d.mode === "marquee") {
          const r = normRect(d.startX, d.startY, bx, by);
          const next = new Set(d.additive);
          for (const it of items) {
            if (it.kind === "connector") continue;
            const ir = itemRect(it);
            // Frames only when fully enclosed, so sweeping inside one picks its contents.
            const inside = ir.x >= r.x && ir.y >= r.y && ir.x + ir.w <= r.x + r.w && ir.y + ir.h <= r.y + r.h;
            if (it.kind === "frame" ? inside : intersects(r, ir)) next.add(it.id);
          }
          setSelection(next);
        }
        return;
      case "connect":
        setDragState({ ...d, x: bx, y: by });
        return;
      case "draw":
        d.points.push([bx, by]);
        setDragState({ ...d });
        return;
      case "erase": {
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          const id = (el as HTMLElement).dataset?.itemId ?? (el.closest?.("[data-item-id]") as HTMLElement | null)?.dataset.itemId;
          const it = id ? itemsById.get(id) : undefined;
          if (it?.kind === "ink" && !d.erased.has(it.id)) {
            d.erased.set(it.id, it);
            setDragState({ ...d });
          }
        }
        return;
      }
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d) {
      state.setInteracting(false);
      return;
    }
    if (d.mode === "pinch") {
      if (pointers.current.size === 0) {
        setDragState(null);
        state.setInteracting(false);
      }
      return;
    }
    setDragState(null);
    state.setInteracting(false);

    switch (d.mode) {
      case "move": {
        if (!d.moved) return;
        const now = state.getItems();
        const moved = [...d.origin.keys()].map((id) => now.get(id)).filter(Boolean) as WhiteboardItem[];
        commit(moved, [], new Map([...d.origin].map(([id, it]) => [id, it])));
        return;
      }
      case "resize": {
        const now = state.getItems().get(d.origin.id);
        if (now && (now.w !== d.origin.w || now.h !== d.origin.h || now.x !== d.origin.x || now.y !== d.origin.y)) {
          commit([now], [], new Map([[d.origin.id, d.origin]]));
        }
        return;
      }
      case "frame": {
        const r = normRect(d.startX, d.startY, d.x, d.y);
        const small = r.w * camRef.current.z < 20 || r.h * camRef.current.z < 20;
        if (small) createAt("frame", d.startX, d.startY);
        else createAt("frame", r.x + r.w / 2, r.y + r.h / 2, { w: Math.round(r.w), h: Math.round(r.h) });
        setTool("select");
        return;
      }
      case "connect": {
        const target = itemAt(document.elementFromPoint(e.clientX, e.clientY));
        if (!target || target.id === d.fromId || target.kind === "connector" || target.kind === "ink") return;
        const item = makeItem(boardId, "connector", {
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          color: "gray",
          from_item_id: d.fromId,
          to_item_id: target.id,
          props: { arrow: true },
        }, topZ);
        commit([item]);
        setSelection(new Set([item.id]));
        return;
      }
      case "draw": {
        const pts = simplify(d.points);
        if (!pts.length) return;
        const minX = Math.min(...pts.map((p) => p[0]));
        const minY = Math.min(...pts.map((p) => p[1]));
        const item = makeItem(boardId, "ink", {
          x: Math.round(minX),
          y: Math.round(minY),
          w: 0,
          h: 0,
          color,
          props: {
            points: pts.slice(0, 2000).map(([x, y]) => [Math.round((x - minX) * 10) / 10, Math.round((y - minY) * 10) / 10]),
            strokeWidth: 3,
          },
        }, topZ);
        commit([item]);
        return;
      }
      case "erase":
        if (d.erased.size) commit([], [...d.erased.keys()], new Map(d.erased));
        return;
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canEdit || tool !== "select") return;
    if ((e.target as HTMLElement).closest("textarea, button, a")) return;
    const hit = itemAt(e.target);
    if (hit) {
      if (hit.kind === "card") {
        if (hit.ref_type === "note" && hit.ref_id && onOpenNoteBoard) onOpenNoteBoard(hit.ref_id);
        return;
      }
      if (hit.kind === "ink") return;
      // A double-click inside a frame's body adds a sticky there; on its title, renames it.
      if (hit.kind === "frame") {
        const [, by] = toBoard(e.clientX, e.clientY);
        if (by - hit.y > 48) {
          const [bx] = toBoard(e.clientX, e.clientY);
          createAt("sticky", bx, by);
          return;
        }
      }
      setSelection(new Set([hit.id]));
      setEditingId(hit.id);
      return;
    }
    const [bx, by] = toBoard(e.clientX, e.clientY);
    createAt("sticky", bx, by);
  };

  // ─── Keyboard and clipboard ────────────────────────────────────
  const duplicate = useCallback(
    (source: WhiteboardItem[], offset = 32): WhiteboardItem[] => {
      const idMap = new Map<string, string>();
      for (const s of source) idMap.set(s.id, newItemId());
      let z = topZ;
      const copies: WhiteboardItem[] = [];
      for (const s of source) {
        if (s.kind === "connector") {
          // Only connectors whose both ends were copied come along.
          if (!idMap.has(s.from_item_id ?? "") || !idMap.has(s.to_item_id ?? "")) continue;
        }
        copies.push({
          ...s,
          id: idMap.get(s.id)!,
          board_id: boardId,
          x: s.x + (s.kind === "connector" ? 0 : offset),
          y: s.y + (s.kind === "connector" ? 0 : offset),
          z: s.kind === "frame" ? s.z : (z += 1),
          from_item_id: s.from_item_id ? idMap.get(s.from_item_id) ?? null : null,
          to_item_id: s.to_item_id ? idMap.get(s.to_item_id) ?? null : null,
          source_actor: null,
          source_label: null,
          rev: 0,
        });
      }
      if (copies.length) {
        commit(copies);
        setSelection(new Set(copies.map((c) => c.id)));
      }
      return copies;
    },
    [boardId, commit, setSelection, topZ]
  );

  const selectedItems = useCallback(() => {
    const out: WhiteboardItem[] = [];
    const seen = new Set<string>();
    for (const id of selection) {
      const it = itemsById.get(id);
      if (!it || seen.has(id)) continue;
      out.push(it);
      seen.add(id);
      if (it.kind === "frame") {
        for (const d of descendantsOf(it, items)) {
          if (!seen.has(d.id)) {
            out.push(d);
            seen.add(d.id);
          }
        }
      }
    }
    // Connectors between selected items come with them.
    for (const it of items) {
      if (it.kind === "connector" && !seen.has(it.id) && seen.has(it.from_item_id ?? "") && seen.has(it.to_item_id ?? "")) {
        out.push(it);
        seen.add(it.id);
      }
    }
    return out;
  }, [items, itemsById, selection]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.duplicateSelection = () => void duplicate(selectedItems());
  }, [controlsRef, duplicate, selectedItems]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      // Leave shortcuts alone while a dialog or menu is open.
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (e.key === " " && !e.repeat) {
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        setSelection(new Set(items.filter((i) => i.kind !== "connector").map((i) => i.id)));
        return;
      }
      if (mod && (key === "c" || key === "x") && selection.size) {
        const copied = selectedItems();
        // The system clipboard gets the words, so pasting into a note or a
        // chat works; pasting back here recognises them and clones the items.
        const text = copied.map((i) => i.text.trim()).filter(Boolean).join("\n") || "Whiteboard items";
        clipboard.current = { items: copied, text };
        navigator.clipboard?.writeText(text).catch(() => {});
        if (key === "x" && canEdit) {
          commit([], copied.map((i) => i.id));
          setSelection(new Set());
        }
        return;
      }
      if (mod && key === "d" && canEdit) {
        e.preventDefault();
        duplicate(selectedItems());
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        zoomAt(1.2);
        return;
      }
      if (mod && key === "-") {
        e.preventDefault();
        zoomAt(1 / 1.2);
        return;
      }
      if (e.shiftKey && (key === "1" || key === "!")) {
        zoomToFit();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && canEdit && selection.size) {
        e.preventDefault();
        commit([], [...selectedItems().map((i) => i.id)]);
        setSelection(new Set());
        return;
      }
      if (e.key === "Escape") {
        setSelection(new Set());
        setTool("select");
        return;
      }
      if (e.key === "Enter" && selection.size === 1 && canEdit) {
        const it = itemsById.get([...selection][0]);
        if (it && it.kind !== "connector" && it.kind !== "ink" && it.kind !== "card") {
          e.preventDefault();
          setEditingId(it.id);
        }
        return;
      }
      if (e.key.startsWith("Arrow") && selection.size && canEdit) {
        e.preventDefault();
        const step = e.shiftKey ? 40 : 4;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        commit(
          selectedItems()
            .filter((i) => i.kind !== "connector")
            .map((i) => ({ ...i, x: i.x + dx, y: i.y + dy }))
        );
        return;
      }
      if (mod || e.altKey) return;
      const tools: Record<string, Tool> = {
        v: "select",
        h: "hand",
        s: "sticky",
        t: "text",
        r: "shape",
        f: "frame",
        c: "connector",
        l: "connector",
        p: "pen",
        e: "eraser",
      };
      if (tools[key] && (canEdit || key === "v" || key === "h")) {
        setTool(tools[key]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    // Pasting text from elsewhere makes stickies, one per line.
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!canEdit || !boardId) return;
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      const own = clipboard.current;
      if (own.items.length && text === own.text.trim()) {
        const copies = duplicate(own.items);
        // Paste again lands one step further on, not on top of this copy.
        clipboard.current = { items: copies, text: own.text };
        return;
      }
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/i, "").trim())
        .filter(Boolean)
        .slice(0, 100);
      const [cx, cy] = controlsRef.current?.viewCenter() ?? [0, 0];
      const size = DEFAULT_SIZE.sticky;
      const spots = gridLayout(lines.map(() => size), 0, 0);
      const cols = Math.min(lines.length, 5);
      const width = cols * (size.w + 32) - 32;
      let z = topZ;
      const created = lines.map((line, i) =>
        makeItem(boardId, "sticky", {
          x: Math.round(cx - width / 2 + spots[i].x),
          y: Math.round(cy - size.h / 2 + spots[i].y),
          text: line.slice(0, 5000),
          color,
        }, (z += 1))
      );
      commit(created);
      setSelection(new Set(created.map((c) => c.id)));
      toast.success(`Added ${created.length} sticky note${created.length === 1 ? "" : "s"}`);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  }, [boardId, canEdit, color, commit, controlsRef, duplicate, items, itemsById, selectedItems, selection, setSelection, setTool, state, topZ, zoomAt, zoomToFit]);

  // ─── Render ────────────────────────────────────────────────────
  const spatial = items.filter((i) => i.kind !== "connector" && i.kind !== "ink");
  const frames = spatial.filter((i) => i.kind === "frame");
  const others = spatial.filter((i) => i.kind !== "frame");
  const connectors = items.filter((i) => i.kind === "connector");
  const inks = items.filter((i) => i.kind === "ink");
  const single = selection.size === 1 ? itemsById.get([...selection][0]) : undefined;
  const erased = drag?.mode === "erase" ? drag.erased : null;

  const cursor =
    drag?.mode === "pan" || spaceHeld || tool === "hand"
      ? drag?.mode === "pan"
        ? "grabbing"
        : "grab"
      : tool === "select"
        ? "default"
        : tool === "eraser"
          ? "cell"
          : "crosshair";

  const gridSize = 24 * camera.z;

  const renderItem = (it: WhiteboardItem) => (
    <ItemView
      key={it.id}
      item={it}
      selected={selection.has(it.id)}
      editing={editingId === it.id}
      zoom={camera.z}
      handles={!!single && single.id === it.id && canEdit && tool === "select" && editingId !== it.id}
      cardRef={it.kind === "card" ? refs[`${it.ref_type}:${it.ref_id}`] : undefined}
      onCommitText={commitText}
      onToggleTask={onToggleTask}
      onOpenNoteBoard={onOpenNoteBoard}
    />
  );

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-muted/30"
      style={{
        cursor,
        backgroundImage: gridSize >= 8 ? "radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 30%, transparent) 1px, transparent 1px)" : undefined,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Whiteboard canvas"
      aria-roledescription="whiteboard"
    >
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, transformOrigin: "0 0" }}
      >
        {frames.map(renderItem)}

        {/* Connectors sit above frames and below everything else. */}
        <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ pointerEvents: "none" }} aria-hidden>
          <defs>
            <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
          </defs>
          {connectors.map((c) => {
            const ends = connectorEnds(c, itemsById);
            if (!ends) return null;
            const [x1, y1] = ends.start;
            const [x2, y2] = ends.end;
            const sel = selection.has(c.id);
            return (
              <g key={c.id} className={cn(sel ? "text-primary" : COLOR_STYLES[c.color]?.stroke ?? "text-zinc-500")}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16 / camera.z} style={{ pointerEvents: "stroke" }} data-item-id={c.id} />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="currentColor"
                  strokeWidth={sel ? 3 : 2}
                  markerEnd={c.props.arrow !== false ? "url(#wb-arrow)" : undefined}
                />
                {c.text && (
                  <foreignObject x={(x1 + x2) / 2 - 80} y={(y1 + y2) / 2 - 14} width={160} height={28} style={{ overflow: "visible" }}>
                    <div className="mx-auto w-fit max-w-[160px] truncate rounded bg-background px-1.5 text-center text-xs text-foreground shadow-sm" data-item-id={c.id} style={{ pointerEvents: "auto" }}>
                      {c.text}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
          {drag?.mode === "connect" &&
            (() => {
              const from = itemsById.get(drag.fromId);
              if (!from) return null;
              const r = itemRect(from);
              return (
                <line
                  x1={r.x + r.w / 2}
                  y1={r.y + r.h / 2}
                  x2={drag.x}
                  y2={drag.y}
                  className="text-primary"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  markerEnd="url(#wb-arrow)"
                />
              );
            })()}
        </svg>

        {others.map(renderItem)}

        {/* Ink is drawn over everything, as annotation. */}
        <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ pointerEvents: "none" }} aria-hidden>
          {inks.map((ink) => {
            if (erased?.has(ink.id)) return null;
            const pts = (ink.props.points ?? []).map(([x, y]) => [ink.x + x, ink.y + y] as [number, number]);
            const sel = selection.has(ink.id);
            return (
              <g key={ink.id} className={COLOR_STYLES[ink.color]?.stroke}>
                <path d={inkPath(pts)} fill="none" stroke="transparent" strokeWidth={14 / camera.z} strokeLinecap="round" style={{ pointerEvents: "stroke" }} data-item-id={ink.id} />
                <path
                  d={inkPath(pts)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={ink.props.strokeWidth ?? 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={sel ? 0.6 : 1}
                />
              </g>
            );
          })}
          {drag?.mode === "draw" && (
            <path
              d={inkPath(drag.points)}
              fill="none"
              className={COLOR_STYLES[color]?.stroke}
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {(drag?.mode === "marquee" || drag?.mode === "frame") &&
          (() => {
            const r = normRect(drag.startX, drag.startY, drag.x, drag.y);
            return (
              <div
                className={cn(
                  "pointer-events-none absolute border",
                  drag.mode === "frame" ? "rounded-xl border-2 border-dashed border-primary bg-primary/5" : "border-primary bg-primary/10"
                )}
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              />
            );
          })()}
      </div>

      {items.length === 0 && emptyState && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto">{emptyState}</div>
        </div>
      )}
    </div>
  );
}
