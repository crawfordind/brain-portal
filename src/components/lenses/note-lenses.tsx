"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode, type TouchEvent } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  ChartBarBig,
  ChartLine,
  FileText,
  Gauge,
  IdCard,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepRead, Lens } from "@/lib/lenses/types";
import { LensChart } from "./lens-chart";
import {
  ActionsLens,
  ChecklistLens,
  FactsLens,
  MetricsLens,
  OutlineLens,
  TableLens,
  TimelineLens,
} from "./lens-panels";

const NOTE_TAB = "note";

function iconFor(lens: Lens): LucideIcon {
  switch (lens.kind) {
    case "chart":
      return lens.form === "line" ? ChartLine : ChartBarBig;
    case "checklist":
      return ListChecks;
    case "actions":
      return Lightbulb;
    case "timeline":
      return CalendarDays;
    case "metrics":
      return Gauge;
    case "table":
      return Table2;
    case "facts":
      return IdCard;
    case "outline":
      return LayoutGrid;
  }
}

// ─── Per-note default view ───────────────────────────────────────────────────
// Which lens a note opens on is a preference of this device, like stream
// density: localStorage, read through useSyncExternalStore.

const PIN_EVENT = "bp:lens-pin";
const pinKey = (noteId: string) => `bp:lens-default:${noteId}`;

function readPin(noteId: string): string | null {
  try {
    return localStorage.getItem(pinKey(noteId));
  } catch {
    return null;
  }
}

function writePin(noteId: string, lensId: string | null) {
  try {
    if (lensId) localStorage.setItem(pinKey(noteId), lensId);
    else localStorage.removeItem(pinKey(noteId));
  } catch {
    /* storage unavailable: the pin simply doesn't persist */
  }
  window.dispatchEvent(new Event(PIN_EVENT));
}

function subscribePin(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(PIN_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(PIN_EVENT, cb);
  };
}

function usePinnedLens(noteId: string) {
  return useSyncExternalStore(subscribePin, () => readPin(noteId), () => null);
}

// ─── Swipe ───────────────────────────────────────────────────────────────────

/**
 * A quick horizontal flick changes lens. Deliberately strict (fast, long and
 * clearly sideways), and ignored where a horizontal drag already means
 * something: selecting text, scrolling a wide table, scrubbing a chart.
 */
function useFlick(onFlick: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-swipe], table, pre, svg, input, textarea")) {
        start.current = null;
        return;
      }
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.t > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      onFlick(dx < 0 ? 1 : -1);
    },
  };
}

// ─── The strip ───────────────────────────────────────────────────────────────

interface NoteLensesProps {
  noteId: string;
  projectId: string | null;
  lenses: Lens[];
  deepRead: DeepRead | null;
  isStale: boolean;
  canReadDeeper: boolean;
  isReading: boolean;
  onReadDeeper: () => void;
  /** Tick a checkbox in the note body. Absent for viewers. */
  onToggleTask?: (taskIndex: number, done: boolean) => void;
  /** The note itself, always the first panel. */
  children: ReactNode;
}

export function NoteLenses({
  noteId,
  projectId,
  lenses,
  deepRead,
  isStale,
  canReadDeeper,
  isReading,
  onReadDeeper,
  onToggleTask,
  children,
}: NoteLensesProps) {
  const pinned = usePinnedLens(noteId);
  const [chosen, setChosen] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const ids = [NOTE_TAB, ...lenses.map((l) => l.id)];
  // An edit can remove the lens being viewed; fall back rather than go blank.
  const active =
    chosen && ids.includes(chosen) ? chosen : pinned && ids.includes(pinned) ? pinned : NOTE_TAB;
  const activeIndex = ids.indexOf(active);
  const lens = lenses.find((l) => l.id === active) ?? null;

  const go = (id: string, focus = false) => {
    setDirection(ids.indexOf(id) >= activeIndex ? 1 : -1);
    setChosen(id);
    const tab = tabRefs.current.get(id);
    tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (focus) tab?.focus();
  };

  const step = (dir: 1 | -1, focus = false) => {
    const next = ids[activeIndex + dir];
    if (next) go(next, focus);
  };
  const flick = useFlick((dir) => step(dir));

  if (!lenses.length && !canReadDeeper) return <>{children}</>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Ways to view this note"
          className="-mx-1 flex flex-1 gap-1 overflow-x-auto px-1 scrollbar-hide"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1, true);
            else if (e.key === "ArrowLeft") step(-1, true);
          }}
        >
          {[{ id: NOTE_TAB, title: "Note", Icon: FileText }, ...lenses.map((l) => ({ id: l.id, title: l.title, Icon: iconFor(l) }))].map(
            ({ id, title, Icon }) => (
              <button
                key={id}
                ref={(el) => {
                  if (el) tabRefs.current.set(id, el);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`lens-tab-${id}`}
                aria-selected={id === active}
                aria-controls={`lens-panel-${id}`}
                tabIndex={id === active ? 0 : -1}
                onClick={() => go(id)}
                className={cn(
                  "inline-flex min-h-11 md:min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                  id === active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="max-w-[10rem] truncate">{title}</span>
                {id === pinned && <Pin className="h-3 w-3 opacity-60" aria-label="default view" />}
              </button>
            )
          )}
        </div>
        {canReadDeeper && (
          <button
            type="button"
            onClick={onReadDeeper}
            disabled={isReading}
            className="inline-flex min-h-11 md:min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-primary hover:bg-primary/10 disabled:opacity-60"
            title="Have AI read this note for dates, numbers, tasks and next steps"
          >
            {isReading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : deepRead && isStale ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {isReading ? "Reading…" : deepRead ? "Read again" : "Read deeper"}
            </span>
          </button>
        )}
      </div>

      <div {...flick}>
        {/* The editor stays mounted so its cursor, undo history and autosave
            survive a trip through the lenses. */}
        <div
          role="tabpanel"
          id={`lens-panel-${NOTE_TAB}`}
          aria-labelledby={`lens-tab-${NOTE_TAB}`}
          hidden={active !== NOTE_TAB}
        >
          {children}
        </div>

        {lens && (
          <motion.section
            key={lens.id}
            role="tabpanel"
            id={`lens-panel-${lens.id}`}
            aria-labelledby={`lens-tab-${lens.id}`}
            initial={{ opacity: 0, x: 24 * direction }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="rounded-xl border bg-card p-4 md:p-6"
          >
            <header className="mb-5 flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <h2 className="text-lg font-semibold">{lens.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {lens.reason}
                  {lens.fromAi && (
                    <span className="ml-1">
                      {isStale ? "Some of this came from an AI read of an earlier draft." : "Includes an AI read of the note."}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => writePin(noteId, pinned === lens.id ? null : lens.id)}
                className="inline-flex min-h-11 min-w-11 md:min-h-9 md:min-w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                title={pinned === lens.id ? "Stop opening this note here" : "Open this note here by default"}
                aria-pressed={pinned === lens.id}
              >
                {pinned === lens.id ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </header>

            {deepRead?.summary && (
              <p className="mb-5 rounded-lg bg-muted/50 px-3 py-2 text-sm">{deepRead.summary}</p>
            )}

            <LensBody lens={lens} noteId={noteId} projectId={projectId} onToggleTask={onToggleTask} />
          </motion.section>
        )}
      </div>
    </div>
  );
}

function LensBody({
  lens,
  noteId,
  projectId,
  onToggleTask,
}: {
  lens: Lens;
  noteId: string;
  projectId: string | null;
  onToggleTask?: (taskIndex: number, done: boolean) => void;
}) {
  switch (lens.kind) {
    case "chart":
      return <LensChart series={lens.series} form={lens.form} />;
    case "checklist":
      return <ChecklistLens items={lens.items} noteId={noteId} projectId={projectId} onToggle={onToggleTask} />;
    case "actions":
      return <ActionsLens actions={lens.actions} noteId={noteId} projectId={projectId} />;
    case "timeline":
      return <TimelineLens items={lens.items} noteId={noteId} projectId={projectId} />;
    case "metrics":
      return <MetricsLens metrics={lens.metrics} />;
    case "table":
      return <TableLens table={lens.table} />;
    case "facts":
      return <FactsLens facts={lens.facts} />;
    case "outline":
      return <OutlineLens sections={lens.sections} />;
  }
}
