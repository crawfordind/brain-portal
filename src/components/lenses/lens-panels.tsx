"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, Check, Plus, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { parseQuantity } from "@/lib/lenses/sense";
import type {
  ChecklistItem,
  DatedItem,
  Fact,
  Metric,
  OutlineSection,
  SuggestedAction,
  TableData,
} from "@/lib/lenses/types";
import { formatValue } from "./lens-chart";

// ─── Turning something into a task ───────────────────────────────────────────

/**
 * A button that creates a real task linked to this note. Lenses never create
 * anything on their own; every task is one tap by the user.
 */
function AddTaskButton({
  text,
  dueDate,
  noteId,
  projectId,
  label = "Add task",
}: {
  text: string;
  dueDate?: string;
  noteId: string;
  projectId: string | null;
  label?: string;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const add = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, dueDate, noteId, projectId }),
      });
      if (!res.ok) throw new Error();
      setState("done");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task added");
    } catch {
      setState("idle");
      toast.error("Couldn't add that task");
    }
  };

  return (
    <button
      type="button"
      onClick={add}
      disabled={state !== "idle"}
      className={cn(
        "inline-flex min-h-11 md:min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
        state === "done"
          ? "text-muted-foreground"
          : "text-primary hover:bg-primary/10 disabled:opacity-60"
      )}
    >
      {state === "busy" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "done" ? (
        <Check className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {state === "done" ? "Added" : label}
    </button>
  );
}

const AiMark = () => (
  <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
    AI
  </span>
);

// ─── Checklist ───────────────────────────────────────────────────────────────

export function ChecklistLens({
  items,
  noteId,
  projectId,
  onToggle,
}: {
  items: ChecklistItem[];
  noteId: string;
  projectId: string | null;
  /** Absent when the viewer can't edit the note. */
  onToggle?: (taskIndex: number, done: boolean) => void;
}) {
  const done = items.filter((i) => i.done).length;
  const ordered = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="tabular-nums">
            {done} of {items.length} done
          </span>
        </div>
        <div className="h-2 rounded-full bg-primary/15" role="meter" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>
      <ul className="divide-y">
        {ordered.map((item, i) => {
          const tickable = item.taskIndex !== undefined && !!onToggle;
          return (
            <li key={`${item.text}-${i}`} className="flex items-center gap-3 min-h-12 py-1">
              {item.taskIndex !== undefined ? (
                <Checkbox
                  checked={item.done}
                  disabled={!tickable}
                  onCheckedChange={(v) => onToggle?.(item.taskIndex!, v === true)}
                  aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`}
                  className="h-5 w-5"
                />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" aria-hidden />
              )}
              <span className={cn("flex-1 text-sm", item.done && "text-muted-foreground line-through")}>
                {item.text}
                {item.origin === "ai" && <AiMark />}
              </span>
              {!item.done && (
                <AddTaskButton text={item.text} noteId={noteId} projectId={projectId} label="Task" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Suggested next steps ────────────────────────────────────────────────────

export function ActionsLens({
  actions,
  noteId,
  projectId,
}: {
  actions: SuggestedAction[];
  noteId: string;
  projectId: string | null;
}) {
  return (
    <ul className="space-y-2">
      {actions.map((a, i) => (
        <li key={`${a.text}-${i}`} className="flex items-start gap-3 rounded-lg border p-3">
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium">{a.text}</p>
            {a.why && <p className="text-sm text-muted-foreground">{a.why}</p>}
            {a.dueDate && <p className="text-xs text-muted-foreground">Suggested by {prettyDate(a.dueDate)}</p>}
          </div>
          <AddTaskButton text={a.text} dueDate={a.dueDate} noteId={noteId} projectId={projectId} />
        </li>
      ))}
    </ul>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");
function dayOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function prettyDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: y === new Date().getFullYear() ? undefined : "numeric",
  });
}

function prettyTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function TimelineLens({
  items,
  noteId,
  projectId,
}: {
  items: DatedItem[];
  noteId: string;
  projectId: string | null;
}) {
  const groups = useMemo(() => {
    const today = dayOffset(0);
    const weekEnd = dayOffset(7);
    const bucket = (d: string) =>
      d < today ? "Past" : d === today ? "Today" : d <= weekEnd ? "Next 7 days" : "Later";
    const order = ["Today", "Next 7 days", "Later", "Past"];
    const map = new Map<string, DatedItem[]>();
    for (const item of items) {
      const b = bucket(item.date);
      map.set(b, [...(map.get(b) ?? []), item]);
    }
    return order.filter((o) => map.has(o)).map((o) => ({ label: o, items: map.get(o)! }));
  }, [items]);

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
          <ol className="relative space-y-1 border-l pl-4">
            {g.items.map((item, i) => (
              <li key={`${item.date}-${i}`} className={cn("relative flex items-start gap-3 py-1.5", g.label === "Past" && "opacity-70")}>
                <span
                  className={cn(
                    "absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                    item.kind === "deadline" ? "bg-destructive" : "bg-primary"
                  )}
                  aria-hidden
                />
                <div className="w-20 sm:w-28 shrink-0 pt-0.5 text-sm tabular-nums">
                  <div>{prettyDate(item.date)}</div>
                  {item.time && <div className="text-xs text-muted-foreground">{prettyTime(item.time)}</div>}
                </div>
                <div className="flex-1 min-w-0 text-sm pt-0.5">
                  {item.kind === "deadline" && (
                    <span className="mr-1.5 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                      Due
                    </span>
                  )}
                  {item.text}
                  {item.origin === "ai" && <AiMark />}
                </div>
                {g.label !== "Past" && (
                  <AddTaskButton text={item.text} dueDate={item.date} noteId={noteId} projectId={projectId} label="Task" />
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

// ─── Key numbers ─────────────────────────────────────────────────────────────

export function MetricsLens({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {metrics.map((m, i) => (
        <div key={`${m.label}-${i}`} className="rounded-lg border bg-card p-4">
          <div className="truncate text-sm text-muted-foreground" title={m.label}>
            {m.label}
            {m.origin === "ai" && <AiMark />}
          </div>
          <div className="mt-1 text-2xl font-semibold md:text-3xl">{formatValue(m.value, m.unit)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

export function TableLens({ table }: { table: TableData }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const key = (cell: string) => parseQuantity(cell)?.value;
    return [...table.rows].sort((a, b) => {
      const ka = key(a[sort.col] ?? "");
      const kb = key(b[sort.col] ?? "");
      if (ka !== undefined && kb !== undefined) return (ka - kb) * sort.dir;
      return (a[sort.col] ?? "").localeCompare(b[sort.col] ?? "", undefined, { numeric: true }) * sort.dir;
    });
  }, [table.rows, sort]);

  return (
    <div className="overflow-x-auto rounded-lg border" data-no-swipe>
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {table.headers.map((h, c) => (
              <th
                key={c}
                className="p-0 text-left font-medium"
                aria-sort={sort?.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))
                  }
                  className="flex min-h-10 w-full items-center gap-1 px-3 text-left hover:bg-muted"
                >
                  {h}
                  <ArrowUpDown className={cn("h-3.5 w-3.5", sort?.col === c ? "text-foreground" : "text-muted-foreground/60")} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((cell, c) => (
                <td key={c} className={cn("px-3 py-2", parseQuantity(cell) && "tabular-nums")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Details ─────────────────────────────────────────────────────────────────

export function FactsLens({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid gap-x-6 sm:grid-cols-[minmax(0,12rem)_1fr] divide-y sm:divide-y-0">
      {facts.map((f, i) => (
        <div key={`${f.key}-${i}`} className="contents">
          <dt className="pt-3 text-sm text-muted-foreground sm:py-2 sm:border-t">{f.key}</dt>
          <dd className="pb-3 text-sm sm:py-2 sm:border-t">
            {f.value}
            {f.origin === "ai" && <AiMark />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

const OUTLINE_PREVIEW = 5;

export function OutlineLens({ sections }: { sections: OutlineSection[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sections.map((s, i) => (
        <section key={`${s.heading}-${i}`} className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">{s.heading}</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {s.items.slice(0, OUTLINE_PREVIEW).map((item, j) => (
              <li key={j} className="line-clamp-2">
                {item}
              </li>
            ))}
          </ul>
          {s.items.length > OUTLINE_PREVIEW && (
            <p className="mt-2 text-xs text-muted-foreground">+{s.items.length - OUTLINE_PREVIEW} more</p>
          )}
        </section>
      ))}
    </div>
  );
}
