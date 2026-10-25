"use client";

/**
 * One whiteboard with its tools: the tool rail, the selection bar, zoom and
 * history controls, and the actions that connect the board to the rest of
 * the app (stickies → tasks, board → note, ask about it, send it to the
 * agent, organise with AI).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bot,
  Circle,
  Copy,
  Diamond,
  Eraser,
  FileDown,
  FileText,
  Frame as FrameIcon,
  Hand,
  Keyboard,
  LayoutGrid,
  ListTodo,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  ScanSearch,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAskAbout } from "@/hooks/use-ask-about";
import { useSendToAgent } from "@/hooks/use-send-to-agent";
import { SendToAgentLabel } from "@/components/agents/send-to-agent-label";
import { gridLayout } from "@/lib/whiteboards/layout";
import {
  BOARD_COLORS,
  DEFAULT_SIZE,
  SHAPES,
  type BoardColor,
  type BoardScope,
  type CardRef,
  type ShapeKind,
} from "@/lib/whiteboards/types";
import { COLOR_STYLES } from "./board-styles";
import { CardPicker } from "./card-picker";
import { useWhiteboard } from "./use-whiteboard";
import { makeItem, WhiteboardCanvas, type Camera, type CanvasHandle, type Tool } from "./whiteboard-canvas";

const TOOLS: Array<{ tool: Tool; label: string; key: string; icon: typeof StickyNote; edit: boolean }> = [
  { tool: "select", label: "Select", key: "V", icon: MousePointer2, edit: false },
  { tool: "hand", label: "Pan", key: "H", icon: Hand, edit: false },
  { tool: "sticky", label: "Sticky note", key: "S", icon: StickyNote, edit: true },
  { tool: "text", label: "Text", key: "T", icon: Type, edit: true },
  { tool: "shape", label: "Shape", key: "R", icon: Square, edit: true },
  { tool: "frame", label: "Frame", key: "F", icon: FrameIcon, edit: true },
  { tool: "connector", label: "Arrow (drag from one item to another)", key: "C", icon: MoveUpRight, edit: true },
  { tool: "pen", label: "Pen", key: "P", icon: Pencil, edit: true },
  { tool: "eraser", label: "Eraser (removes pen strokes)", key: "E", icon: Eraser, edit: true },
];

const SHAPE_ICONS: Record<ShapeKind, typeof Square> = { rect: Square, ellipse: Circle, diamond: Diamond };

const SHORTCUTS: Array<[string, string]> = [
  ["V / H", "Select / pan (or hold Space)"],
  ["S, T, R, F", "Sticky, text, shape, frame"],
  ["C, P, E", "Arrow, pen, eraser"],
  ["Double-click", "Add a sticky, or edit what you clicked"],
  ["Enter / Esc", "Edit selected / stop"],
  ["⌘/Ctrl + Z, ⇧⌘Z", "Undo, redo"],
  ["⌘/Ctrl + C, X, V, D", "Copy, cut, paste, duplicate"],
  ["⌘/Ctrl + A", "Select all"],
  ["Delete", "Remove selected"],
  ["Arrows (⇧ for more)", "Nudge"],
  ["⌘/Ctrl + wheel, pinch", "Zoom"],
  ["⇧1", "Zoom to fit"],
  ["Paste a list", "One sticky per line"],
];

function readCamera(boardId: string): Camera | null {
  try {
    const raw = localStorage.getItem(`whiteboard-camera:${boardId}`);
    const c = raw ? JSON.parse(raw) : null;
    return c && [c.x, c.y, c.z].every((v: unknown) => typeof v === "number" && Number.isFinite(v)) ? c : null;
  } catch {
    return null;
  }
}

function writeCamera(boardId: string, c: Camera) {
  try {
    localStorage.setItem(`whiteboard-camera:${boardId}`, JSON.stringify(c));
  } catch {
    // Private mode: the view just isn't remembered.
  }
}

function IconButton({
  label,
  active,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 md:h-9 md:w-9",
        active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        className
      )}
    >
      {children}
    </button>
  );
}

function Swatches({ value, onChange }: { value?: BoardColor; onChange: (c: BoardColor) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Colour">
      {BOARD_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_STYLES[c].label}
          title={COLOR_STYLES[c].label}
          onClick={() => onChange(c)}
          className={cn(
            "h-8 w-8 rounded-full ring-offset-2 ring-offset-background",
            COLOR_STYLES[c].swatch,
            value === c && "ring-2 ring-primary"
          )}
        />
      ))}
    </div>
  );
}

export interface WhiteboardBoardProps {
  scope: BoardScope;
  /** Project id, or note id / slug. */
  targetId: string;
  /** Open another note's board (the workspace switches tabs). */
  onOpenNoteBoard?: (noteId: string) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function WhiteboardBoard({ scope, targetId, onOpenNoteBoard, fullscreen, onToggleFullscreen }: WhiteboardBoardProps) {
  const target = useMemo(() => ({ scope, id: targetId }), [scope, targetId]);
  const state = useWhiteboard(target);
  const { board, access, canEdit, items, itemsById, commit, setRefs } = state;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { askAbout } = useAskAbout();
  const { sendToAgent } = useSendToAgent();

  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<BoardColor>("yellow");
  const [shape, setShape] = useState<ShapeKind>("rect");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const controls = useRef<CanvasHandle | null>(null);
  const placedCamera = useRef<string | null>(null);

  const setCamera = useCallback((next: Camera | ((c: Camera) => Camera)) => {
    setCameraState((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  // Remember the view per board, per device (like stream density).
  useEffect(() => {
    if (!board) return;
    const t = setTimeout(() => writeCamera(board.id, camera), 300);
    return () => clearTimeout(t);
  }, [board, camera]);

  // Place the camera once per board: where the viewer left it, else fitted.
  useEffect(() => {
    if (state.status !== "ready" || !board || placedCamera.current === board.id) return;
    placedCamera.current = board.id;
    const saved = readCamera(board.id);
    if (saved) setCamera(saved);
    else requestAnimationFrame(() => controls.current?.zoomToFit());
  }, [state.status, board, setCamera]);

  // Selection only holds what exists.
  useEffect(() => {
    if (![...selection].some((id) => !itemsById.has(id))) return;
    setSelection(new Set([...selection].filter((id) => itemsById.has(id))));
  }, [itemsById, selection]);

  // Say so when an agent's work lands on the open board.
  const { incoming, clearIncoming } = state;
  useEffect(() => {
    if (!incoming) return;
    toast(`${incoming.label || "An agent"} added ${incoming.count} item${incoming.count === 1 ? "" : "s"}`, {
      icon: <Bot className="h-4 w-4" />,
      action: { label: "Show", onClick: () => controls.current?.zoomToFit() },
    });
    clearIncoming();
  }, [incoming, clearIncoming]);

  const selected = useMemo(() => [...selection].map((id) => itemsById.get(id)).filter(Boolean) as typeof items, [selection, itemsById]);
  const convertible = selected.filter((i) => (i.kind === "sticky" || i.kind === "text" || i.kind === "shape") && i.text.trim());
  const topZ = items.reduce((m, i) => Math.max(m, i.z), 0);
  const minZ = items.filter((i) => i.kind !== "frame").reduce((m, i) => Math.min(m, i.z), 0);

  // ─── Actions ───────────────────────────────────────────────────
  const recolor = (c: BoardColor) => {
    setColor(c);
    if (canEdit && selected.length) commit(selected.map((i) => ({ ...i, color: c })));
  };

  const reshape = (s: ShapeKind) => {
    setShape(s);
    const shapes = selected.filter((i) => i.kind === "shape");
    if (canEdit && shapes.length) commit(shapes.map((i) => ({ ...i, props: { ...i.props, shape: s } })));
  };

  const resizeText = (delta: number) => {
    const texts = selected.filter((i) => i.kind === "sticky" || i.kind === "text" || i.kind === "shape");
    if (!texts.length) return;
    commit(
      texts.map((i) => {
        const base = i.props.fontSize ?? (i.kind === "text" ? 20 : i.kind === "sticky" ? 18 : 16);
        return { ...i, props: { ...i.props, fontSize: Math.min(160, Math.max(8, base + delta)) } };
      })
    );
  };

  const restack = (front: boolean) => {
    let z = front ? topZ : minZ;
    const movable = selected.filter((i) => i.kind !== "frame");
    if (!movable.length) return;
    commit(movable.map((i) => ({ ...i, z: front ? (z += 1) : (z -= 1) })));
  };

  const removeSelected = () => {
    commit([], selected.map((i) => i.id));
    setSelection(new Set());
  };

  const duplicateSelected = () => controls.current?.duplicateSelection();

  // A server-side change (organise, tidy) is undone by writing the old
  // positions back and removing the frames it made, as one local edit, so it
  // also lands in the undo history.
  const restore = (snapshot: Map<string, (typeof items)[number]>, createdIds: string[]) => {
    const now = state.getItems();
    const changed = [...snapshot.values()].filter((old) => {
      const cur = now.get(old.id);
      return !cur || cur.x !== old.x || cur.y !== old.y || cur.w !== old.w || cur.h !== old.h;
    });
    commit(changed, createdIds.filter((id) => now.has(id)));
  };

  const runAction = async (action: string, body: Record<string, unknown> = {}, label = "Working…") => {
    if (!board) return null;
    setBusy(label);
    try {
      await state.flush();
      const res = await fetch(`/api/whiteboards/${board.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work");
      await state.refresh();
      return data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const makeTasks = async () => {
    const data = await runAction("convert_to_tasks", { itemIds: convertible.map((i) => i.id) }, "Creating tasks…");
    if (data?.tasks) {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`Created ${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"}`, {
        action: { label: "Open tasks", onClick: () => router.push("/tasks") },
      });
    }
  };

  const organize = async () => {
    const ids = selected.length >= 3 ? selected.map((i) => i.id) : [];
    const snapshot = new Map(itemsById);
    const data = await runAction("organize", { itemIds: ids }, "Organising…");
    if (data?.frames) {
      const frameIds = (data.frames as Array<{ id: string }>).map((f) => f.id);
      toast.success(`Grouped into ${data.frames.length} theme${data.frames.length === 1 ? "" : "s"}`, {
        action: { label: "Undo", onClick: () => restore(snapshot, frameIds) },
      });
      setSelection(new Set());
      requestAnimationFrame(() => controls.current?.zoomToFit());
    }
  };

  const tidy = async () => {
    const snapshot = new Map(itemsById);
    const data = await runAction("tidy", {}, "Tidying…");
    if (data) {
      toast.success(data.moved ? `Tidied ${data.moved} item${data.moved === 1 ? "" : "s"}` : "Already tidy", {
        action: data.moved ? { label: "Undo", onClick: () => restore(snapshot, []) } : undefined,
      });
    }
  };

  const saveAsNote = async () => {
    const data = await runAction("save_as_note", {}, "Saving as a note…");
    if (data?.note) {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      toast.success(`Saved "${data.note.title}"`, {
        action: { label: "Open", onClick: () => router.push(`/notes/${data.note.slug}`) },
      });
    }
  };

  const toggleTask = useCallback(
    async (ref: CardRef) => {
      const status = ref.status === "completed" ? "pending" : "completed";
      const key = `task:${ref.id}`;
      setRefs((prev) => ({ ...prev, [key]: { ...ref, status } }));
      // Operations' PATCH: a status change without delegation side effects
      // (a recurring task still spawns its next occurrence).
      const res = await fetch(`/api/operations/items/${ref.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setRefs((prev) => ({ ...prev, [key]: ref }));
        toast.error("Couldn't update the task");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    [queryClient, setRefs]
  );

  const addCards = (picked: CardRef[]) => {
    if (!board || !picked.length) return;
    const [cx, cy] = controls.current?.viewCenter() ?? [0, 0];
    const size = DEFAULT_SIZE.card;
    const spots = gridLayout(picked.map(() => size), 0, 0, Math.min(4, picked.length));
    const cols = Math.min(4, picked.length);
    const width = cols * (size.w + 32) - 32;
    let z = topZ;
    const cards = picked.map((ref, i) =>
      makeItem(board.id, "card", {
        x: Math.round(cx - width / 2 + spots[i].x),
        y: Math.round(cy - size.h / 2 + spots[i].y),
        text: ref.title,
        color: "white",
        ref_type: ref.type,
        ref_id: ref.id,
      }, (z += 1))
    );
    setRefs((prev) => ({ ...prev, ...Object.fromEntries(picked.map((r) => [`${r.type}:${r.id}`, r])) }));
    commit(cards);
    setSelection(new Set(cards.map((c) => c.id)));
  };

  const onCards = new Set(items.filter((i) => i.kind === "card").map((i) => `${i.ref_type}:${i.ref_id}`));

  // ─── Render ────────────────────────────────────────────────────
  if (state.status === "loading") {
    return <Skeleton className="h-full w-full rounded-none" />;
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium">Couldn&apos;t open this whiteboard</p>
        <p className="max-w-sm text-sm text-muted-foreground">{state.error}</p>
        <Button onClick={() => state.reload()} className="min-h-11 md:min-h-9">Try again</Button>
      </div>
    );
  }
  if (state.status === "empty" || !board || !access) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-medium">No whiteboard yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Someone who can edit {access?.scope === "note" ? "this note" : "this project"} has to start it.
        </p>
      </div>
    );
  }

  const emptyState = canEdit ? (
    <div className="max-w-sm rounded-xl border bg-background/95 p-5 text-center shadow-lg">
      <p className="font-semibold">An empty board</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Double-click anywhere for a sticky, paste a list to get one per line, or lay out
        {scope === "project" ? " this project's notes and tasks" : " related notes"} as live cards.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          className="min-h-11 md:min-h-9"
          onClick={() => {
            const [cx, cy] = controls.current?.viewCenter() ?? [0, 0];
            const item = makeItem(board.id, "sticky", { x: cx - 100, y: cy - 100, color }, topZ);
            commit([item]);
            setSelection(new Set([item.id]));
          }}
        >
          <StickyNote className="mr-1.5 h-4 w-4" /> Add a sticky
        </Button>
        <Button size="sm" variant="outline" className="min-h-11 md:min-h-9" onClick={() => setPickerOpen(true)}>
          <FileText className="mr-1.5 h-4 w-4" /> Add cards
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 md:min-h-9"
          onClick={() =>
            sendToAgent({
              id: access.targetId,
              type: scope,
              title: `Whiteboard: ${board.title}`,
              projectId: access.projectId,
            })
          }
        >
          <Bot className="mr-1.5 h-4 w-4" /> <SendToAgentLabel />
        </Button>
      </div>
    </div>
  ) : (
    <div className="rounded-xl border bg-background/95 p-5 text-center text-sm text-muted-foreground shadow">
      Nothing on this board yet.
    </div>
  );

  const shapeSelected = selected.some((i) => i.kind === "shape");
  const textSelected = selected.some((i) => i.kind === "sticky" || i.kind === "text" || i.kind === "shape");
  const ShapeIcon = SHAPE_ICONS[shape];

  return (
    <div className="relative h-full w-full">
      <WhiteboardCanvas
        state={state}
        tool={tool}
        setTool={setTool}
        color={color}
        shape={shape}
        selection={selection}
        setSelection={setSelection}
        camera={camera}
        setCamera={setCamera}
        onToggleTask={toggleTask}
        onOpenNoteBoard={onOpenNoteBoard}
        controlsRef={controls}
        emptyState={emptyState}
      />

      {/* Tool rail: left on desktop, along the bottom on a phone. */}
      {canEdit && (
        <div
          // On a phone it stops short of the right edge, where the voice button sits.
          className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-6.5rem)] items-center gap-0.5 overflow-x-auto rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur md:bottom-auto md:top-1/2 md:max-w-none md:-translate-y-1/2 md:flex-col md:overflow-visible"
          role="toolbar"
          aria-label="Whiteboard tools"
        >
          {TOOLS.map(({ tool: t, label, key, icon: Icon }) =>
            t === "shape" ? (
              <Popover key={t}>
                <PopoverTrigger asChild>
                  <span>
                    <IconButton label={`${label} (${key})`} active={tool === t} onClick={() => setTool(t)}>
                      <ShapeIcon className="h-4 w-4" />
                    </IconButton>
                  </span>
                </PopoverTrigger>
                <PopoverContent side="right" className="w-auto p-1">
                  <div className="flex gap-1">
                    {SHAPES.map((s) => {
                      const I = SHAPE_ICONS[s];
                      return (
                        <IconButton key={s} label={s} active={shape === s} onClick={() => { setShape(s); setTool("shape"); }}>
                          <I className="h-4 w-4" />
                        </IconButton>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <IconButton key={t} label={`${label} (${key})`} active={tool === t} onClick={() => setTool(t)}>
                <Icon className="h-4 w-4" />
              </IconButton>
            )
          )}
          <span className="mx-0.5 h-6 w-px shrink-0 bg-border md:mx-0 md:my-0.5 md:h-px md:w-6" aria-hidden />
          <IconButton label="Add notes and tasks as cards" onClick={() => setPickerOpen(true)}>
            <FileText className="h-4 w-4" />
          </IconButton>
          <Popover>
            <PopoverTrigger asChild>
              <span>
                <IconButton label="Colour for new items">
                  <span className={cn("h-5 w-5 rounded-full", COLOR_STYLES[color].swatch)} />
                </IconButton>
              </span>
            </PopoverTrigger>
            <PopoverContent side="right" className="w-auto">
              <Swatches value={color} onChange={setColor} />
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Top-right: status, history, zoom, actions. */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur">
        {!canEdit && (
          <Badge variant="secondary" className="mx-1 gap-1">
            <Eye className="h-3 w-3" /> View only
          </Badge>
        )}
        {canEdit && (
          <span className="hidden px-2 text-xs text-muted-foreground sm:inline" aria-live="polite">
            {busy ?? (state.saveState === "saving" ? "Saving…" : state.saveState === "error" ? "Offline, retrying" : state.saveState === "saved" ? "Saved" : "")}
          </span>
        )}
        {canEdit && (
          <>
            <IconButton label="Undo (⌘Z)" onClick={state.undo} disabled={!state.canUndo}>
              <Undo2 className="h-4 w-4" />
            </IconButton>
            <IconButton label="Redo (⇧⌘Z)" onClick={state.redo} disabled={!state.canRedo} className="hidden sm:inline-flex">
              <Redo2 className="h-4 w-4" />
            </IconButton>
          </>
        )}
        <IconButton label="Zoom out" onClick={() => controls.current?.zoomBy(1 / 1.25)} className="hidden sm:inline-flex">
          <Minus className="h-4 w-4" />
        </IconButton>
        <button
          type="button"
          onClick={() => controls.current?.resetZoom()}
          className="hidden min-h-9 min-w-12 rounded-md px-1 text-xs tabular-nums text-muted-foreground hover:bg-muted sm:block"
          title="Reset to 100%"
        >
          {Math.round(camera.z * 100)}%
        </button>
        <IconButton label="Zoom in" onClick={() => controls.current?.zoomBy(1.25)} className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" />
        </IconButton>
        <IconButton label="Zoom to fit (⇧1)" onClick={() => controls.current?.zoomToFit()}>
          <ScanSearch className="h-4 w-4" />
        </IconButton>
        <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={onToggleFullscreen}>
          {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Board actions"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted md:h-9 md:w-9"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{board.title}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                if (fullscreen) onToggleFullscreen();
                askAbout({ id: board.id, type: "whiteboard", title: board.title });
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" /> Ask about this board
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem
                onClick={() => {
                  if (fullscreen) onToggleFullscreen();
                  sendToAgent({ id: access.targetId, type: scope, title: `Whiteboard: ${board.title}`, projectId: access.projectId });
                }}
              >
                <Bot className="mr-2 h-4 w-4" /> <SendToAgentLabel />
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={organize} disabled={!!busy}>
                  <Sparkles className="mr-2 h-4 w-4" /> Organise with AI
                </DropdownMenuItem>
                <DropdownMenuItem onClick={tidy} disabled={!!busy}>
                  <LayoutGrid className="mr-2 h-4 w-4" /> Tidy up
                </DropdownMenuItem>
                <DropdownMenuItem onClick={saveAsNote} disabled={!!busy || !items.length}>
                  <FileDown className="mr-2 h-4 w-4" /> Save as a note
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <Keyboard className="mr-2 h-4 w-4" /> Keyboard shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Selection bar */}
      {canEdit && selected.length > 0 && (
        <div
          className="absolute left-1/2 top-16 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur"
          role="toolbar"
          aria-label="Selected items"
        >
          <span className="px-2 text-xs text-muted-foreground whitespace-nowrap">{selected.length} selected</span>
          <Popover>
            <PopoverTrigger asChild>
              <span>
                <IconButton label="Colour">
                  <span className={cn("h-5 w-5 rounded-full", COLOR_STYLES[selected[0].color]?.swatch)} />
                </IconButton>
              </span>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <Swatches value={selected.length === 1 ? selected[0].color : undefined} onChange={recolor} />
            </PopoverContent>
          </Popover>
          {shapeSelected &&
            SHAPES.map((s) => {
              const I = SHAPE_ICONS[s];
              return (
                <IconButton key={s} label={`Make ${s}`} onClick={() => reshape(s)} active={selected.every((i) => i.kind !== "shape" || i.props.shape === s)}>
                  <I className="h-4 w-4" />
                </IconButton>
              );
            })}
          {textSelected && (
            <>
              <IconButton label="Smaller text" onClick={() => resizeText(-2)}>
                <span className="text-xs font-semibold">A−</span>
              </IconButton>
              <IconButton label="Larger text" onClick={() => resizeText(2)}>
                <span className="text-sm font-semibold">A+</span>
              </IconButton>
            </>
          )}
          <IconButton label="Bring to front" onClick={() => restack(true)}>
            <ArrowUpToLine className="h-4 w-4" />
          </IconButton>
          <IconButton label="Send to back" onClick={() => restack(false)}>
            <ArrowDownToLine className="h-4 w-4" />
          </IconButton>
          <IconButton label="Duplicate (⌘D)" onClick={duplicateSelected}>
            <Copy className="h-4 w-4" />
          </IconButton>
          {convertible.length > 0 && (
            <Button size="sm" variant="ghost" className="min-h-11 shrink-0 md:min-h-9" onClick={makeTasks} disabled={!!busy}>
              <ListTodo className="mr-1.5 h-4 w-4" /> Make {convertible.length === 1 ? "a task" : `${convertible.length} tasks`}
            </Button>
          )}
          {selected.length >= 3 && (
            <Button size="sm" variant="ghost" className="min-h-11 shrink-0 md:min-h-9" onClick={organize} disabled={!!busy}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Organise
            </Button>
          )}
          <IconButton label="Delete" onClick={removeSelected} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      <CardPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        projectId={access.projectId}
        onPick={addCards}
        excluded={onCards}
      />

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Everything here also has a button.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
