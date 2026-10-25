"use client";

/**
 * A whiteboard's state in the browser: the items, what still has to be
 * saved, and undo history.
 *
 * - **Local first.** Every edit lands on screen at once and is saved in the
 *   background, batched, with client-minted ids so a retried save cannot
 *   duplicate anything.
 * - **Live.** The board is polled with `?since=<version>`, so stickies an
 *   agent adds over MCP, or a collaborator adds in another tab, appear
 *   within seconds. An item with unsaved local edits is never overwritten by
 *   the poll; the last writer wins per item, never per board.
 * - **Undo is local.** It replays the before-state of a change as a new
 *   edit, which is what makes undoing safe next to other writers.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardScope, CardRef, Whiteboard, WhiteboardItem } from "@/lib/whiteboards/types";
import type { TargetAccess } from "@/lib/whiteboards/store";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ItemChange {
  id: string;
  before: WhiteboardItem | null;
  after: WhiteboardItem | null;
}

interface BoardPayload {
  board: Whiteboard | null;
  access: TargetAccess;
  items?: WhiteboardItem[];
  ids?: string[];
  refs?: Record<string, CardRef>;
}

const POLL_MS = 3000;
const SAVE_DEBOUNCE_MS = 450;
const HISTORY_LIMIT = 200;

export function useWhiteboard(target: { scope: BoardScope; id: string } | null) {
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<Whiteboard | null>(null);
  const [access, setAccess] = useState<TargetAccess | null>(null);
  const [items, setItems] = useState<Map<string, WhiteboardItem>>(new Map());
  const [refs, setRefs] = useState<Record<string, CardRef>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  /** Items another writer just added, for the "an agent added N" notice. */
  const [incoming, setIncoming] = useState<{ count: number; label: string | null; at: number } | null>(null);

  // The latest items, readable synchronously by handlers. Written only
  // through `updateItems`, so two edits in one tick both see each other.
  const itemsRef = useRef(items);
  const boardRef = useRef<Whiteboard | null>(null);
  useLayoutEffect(() => {
    boardRef.current = board;
  }, [board]);
  const updateItems = useCallback(
    (next: Map<string, WhiteboardItem> | ((prev: Map<string, WhiteboardItem>) => Map<string, WhiteboardItem>)) => {
      const value = typeof next === "function" ? next(itemsRef.current) : next;
      itemsRef.current = value;
      setItems(value);
    },
    []
  );
  const syncHistory = useCallback(
    () => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length }),
    []
  );
  const seenVersion = useRef(0);
  const dirty = useRef(new Map<string, WhiteboardItem>());
  const deleted = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const undoStack = useRef<ItemChange[][]>([]);
  const redoStack = useRef<ItemChange[][]>([]);
  /** Set while the user is dragging, so a poll never yanks an item mid-move. */
  const interacting = useRef(false);

  const targetKey = target ? `${target.scope}:${target.id}` : "";

  // ─── Load ───────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!target) return;
    setStatus("loading");
    setError(null);
    try {
      // POST opens the board, starting it on first use for anyone who can
      // edit; a viewer is answered 403, and falls back to reading.
      let res = await fetch("/api/whiteboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (res.status === 403) {
        res = await fetch(`/api/whiteboards?scope=${target.scope}&id=${encodeURIComponent(target.id)}`);
      }
      const data = (await res.json().catch(() => ({}))) as BoardPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't open the whiteboard");
      setAccess(data.access);
      if (!data.board) {
        setBoard(null);
        updateItems(new Map());
        setStatus("empty");
        return;
      }
      setBoard(data.board);
      boardRef.current = data.board;
      seenVersion.current = data.board.version;
      updateItems(new Map((data.items ?? []).map((i) => [i.id, i])));
      setRefs(data.refs ?? {});
      dirty.current.clear();
      deleted.current.clear();
      undoStack.current = [];
      redoStack.current = [];
      syncHistory();
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the whiteboard");
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Save ───────────────────────────────────────────────────────
  const flush = useCallback(async (): Promise<void> => {
    const b = boardRef.current;
    if (!b || saving.current) return;
    if (!dirty.current.size && !deleted.current.size) return;
    saving.current = true;
    const upserts = [...dirty.current.values()];
    const deletes = [...deleted.current];
    dirty.current.clear();
    deleted.current.clear();
    upserts.forEach((u) => inFlight.current.add(u.id));
    setSaveState("saving");
    try {
      const res = await fetch(`/api/whiteboards/${b.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upserts, deletes }),
        keepalive: upserts.length < 200,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      if (Array.isArray(data.errors) && data.errors.length) {
        // A refused item (e.g. a card whose note was deleted meanwhile) is
        // dropped locally too, so the screen matches what was kept.
        const refused = new Set<string>(
          data.errors.map((e: { id: string | null }) => e.id).filter(Boolean)
        );
        if (refused.size) {
          updateItems((prev) => {
            const next = new Map(prev);
            refused.forEach((id) => next.delete(id));
            return next;
          });
        }
      }
      setSaveState(dirty.current.size || deleted.current.size ? "saving" : "saved");
    } catch {
      // Put the work back, newest edit winning, and try again shortly.
      for (const u of upserts) if (!dirty.current.has(u.id) && !deleted.current.has(u.id)) dirty.current.set(u.id, u);
      for (const d of deletes) if (!dirty.current.has(d)) deleted.current.add(d);
      setSaveState("error");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), 4000);
    } finally {
      upserts.forEach((u) => inFlight.current.delete(u.id));
      saving.current = false;
      if (dirty.current.size || deleted.current.size) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
      }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Save on leaving the page or switching tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush, targetKey]);

  // ─── Edit ───────────────────────────────────────────────────────
  const canEdit = access ? access.role !== "viewer" : false;

  const applyChanges = useCallback(
    (changes: ItemChange[]) => {
      if (!changes.length) return;
      updateItems((prev) => {
        const next = new Map(prev);
        for (const c of changes) {
          if (c.after) next.set(c.id, c.after);
          else next.delete(c.id);
        }
        return next;
      });
      for (const c of changes) {
        if (c.after) {
          dirty.current.set(c.id, c.after);
          deleted.current.delete(c.id);
        } else {
          dirty.current.delete(c.id);
          deleted.current.add(c.id);
        }
      }
      scheduleSave();
    },
    [scheduleSave, updateItems]
  );

  /** Make a change, saved and undoable. `before` defaults to what is on screen now. */
  const commit = useCallback(
    (after: WhiteboardItem[], removed: string[] = [], before?: Map<string, WhiteboardItem | null>) => {
      if (!canEdit) return;
      const current = itemsRef.current;
      const changes: ItemChange[] = [
        ...after.map((a) => ({ id: a.id, before: before?.has(a.id) ? before.get(a.id)! : current.get(a.id) ?? null, after: a })),
        ...removed.map((id) => ({ id, before: before?.get(id) ?? current.get(id) ?? null, after: null })),
      ].filter((c) => c.before !== null || c.after !== null);
      // Removing an item removes the connectors attached to it.
      if (removed.length) {
        const gone = new Set(removed);
        for (const item of current.values()) {
          if (item.kind === "connector" && !gone.has(item.id) && (gone.has(item.from_item_id ?? "") || gone.has(item.to_item_id ?? ""))) {
            changes.push({ id: item.id, before: item, after: null });
            gone.add(item.id);
          }
        }
      }
      if (!changes.length) return;
      applyChanges(changes);
      undoStack.current.push(changes);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      syncHistory();
    },
    [applyChanges, canEdit, syncHistory]
  );

  /** Show a change without saving it (live drag). `commit` it at the end. */
  const preview = useCallback(
    (after: WhiteboardItem[]) => {
      updateItems((prev) => {
        const next = new Map(prev);
        for (const a of after) next.set(a.id, a);
        return next;
      });
    },
    [updateItems]
  );

  const undo = useCallback(() => {
    const changes = undoStack.current.pop();
    if (!changes) return;
    applyChanges(changes.map((c) => ({ id: c.id, before: c.after, after: c.before })));
    redoStack.current.push(changes);
    syncHistory();
  }, [applyChanges, syncHistory]);

  const redo = useCallback(() => {
    const changes = redoStack.current.pop();
    if (!changes) return;
    applyChanges(changes);
    undoStack.current.push(changes);
    syncHistory();
  }, [applyChanges, syncHistory]);

  // ─── Follow other writers ──────────────────────────────────────
  const poll = useCallback(async (full = false) => {
    const b = boardRef.current;
    if (!b || interacting.current) return;
    try {
      const res = await fetch(`/api/whiteboards/${b.id}${full ? "" : `?since=${seenVersion.current}`}`);
      if (!res.ok) return;
      const data = (await res.json()) as BoardPayload;
      if (!data.board) return;
      const remoteVersion = data.board.version;
      if (!full && remoteVersion <= seenVersion.current && !(data.items ?? []).length) return;
      const pending = (id: string) => dirty.current.has(id) || deleted.current.has(id) || inFlight.current.has(id);
      const current = itemsRef.current;
      const arrivals = (data.items ?? []).filter((i) => !current.has(i.id) && !pending(i.id));
      updateItems((prev) => {
        const next = full ? new Map<string, WhiteboardItem>() : new Map(prev);
        if (full) {
          // Keep what is still unsaved locally.
          for (const [id, item] of prev) if (pending(id)) next.set(id, item);
        }
        for (const item of data.items ?? []) {
          if (!pending(item.id)) next.set(item.id, item);
        }
        if (!full && data.ids) {
          const present = new Set(data.ids);
          for (const id of [...next.keys()]) {
            if (!present.has(id) && !pending(id)) next.delete(id);
          }
        }
        return next;
      });
      setRefs((prev) => (full ? data.refs ?? {} : { ...prev, ...(data.refs ?? {}) }));
      setBoard((prev) => (prev ? { ...prev, version: Math.max(prev.version, remoteVersion), title: data.board!.title } : prev));
      seenVersion.current = Math.max(seenVersion.current, remoteVersion);
      const automated = arrivals.filter((a) => a.source_actor && a.source_actor !== "human");
      if (!full && automated.length) {
        setIncoming({ count: automated.length, label: automated[0].source_label, at: Date.now() });
      }
    } catch {
      // Offline: the next tick tries again.
    }
  }, [updateItems]);

  useEffect(() => {
    if (status !== "ready") return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      ticks += 1;
      // Every 20th tick is a full read, which also refreshes card titles and
      // task statuses changed elsewhere.
      void poll(ticks % 20 === 0);
    }, POLL_MS);
    const onFocus = () => void poll(true);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [status, poll]);

  const sorted = useMemo(
    () => [...items.values()].sort((a, b) => a.z - b.z || a.created_at.localeCompare(b.created_at)),
    [items]
  );

  return {
    status,
    error,
    board,
    access,
    canEdit,
    items: sorted,
    itemsById: items,
    refs,
    setRefs,
    saveState,
    commit,
    preview,
    undo,
    redo,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    /** The items as of now, for handlers that run after later edits. */
    getItems: () => itemsRef.current,
    setInteracting: (v: boolean) => {
      interacting.current = v;
    },
    reload: load,
    refresh: () => poll(true),
    flush,
    incoming,
    clearIncoming: () => setIncoming(null),
  };
}

export type WhiteboardState = ReturnType<typeof useWhiteboard>;
