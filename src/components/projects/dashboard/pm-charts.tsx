"use client";

/**
 * Charts for the project dashboard. Hand-drawn SVG/HTML, like the note lenses,
 * so the page carries no chart library. Colours are the `.pm-viz` roles in
 * globals.css; status always travels with an icon and a word.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDot, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addDays,
  diffDays,
  weekStart,
  type PmHealth,
  type PmProject,
  type PmWeek,
  type PmWorkloadRow,
} from "@/lib/projects/dashboard";

// ─── Shared bits ────────────────────────────────────────────────────────

const shortDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });

export function formatDay(day: string | null): string {
  if (!day) return "—";
  return shortDate.format(new Date(`${day}T00:00:00Z`));
}

export function relativeDay(day: string, today: string): string {
  const d = diffDays(today, day);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d < 0) return `${-d}d overdue`;
  return `in ${d}d`;
}

function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A tooltip positioned inside a `relative` parent. */
function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 max-w-[240px] -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= value / 4) ?? mag;
  return Math.ceil(value / step) * step;
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="inline-block h-2.5 w-2.5 rounded-[3px]"
        style={
          dashed
            ? { border: `1.5px dashed ${color}` }
            : { background: color }
        }
      />
      {label}
    </span>
  );
}

// ─── Health ─────────────────────────────────────────────────────────────

export const HEALTH_META: Record<PmHealth, { label: string; color: string; Icon: typeof AlertTriangle }> = {
  at_risk: { label: "At risk", color: "var(--pm-critical)", Icon: AlertTriangle },
  attention: { label: "Watch", color: "var(--pm-warning)", Icon: CircleDot },
  on_track: { label: "On track", color: "var(--pm-good)", Icon: CheckCircle2 },
  quiet: { label: "Quiet", color: "var(--pm-ink-muted)", Icon: MinusCircle },
};

export function HealthBadge({ health, className }: { health: PmHealth; className?: string }) {
  const { label, color, Icon } = HEALTH_META[health];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} aria-hidden />
      {label}
    </span>
  );
}

// ─── Progress (stacked: done / in progress / to do) ─────────────────────

export function ProgressBar({ done, inProgress, todo }: { done: number; inProgress: number; todo: number }) {
  const total = done + inProgress + todo;
  if (total === 0) {
    return <div className="h-2 w-full rounded-full" style={{ background: "var(--pm-track)" }} />;
  }
  const parts = [
    { n: done, color: "var(--pm-done)", label: "done" },
    { n: inProgress, color: "var(--pm-progress)", label: "in progress" },
    { n: todo, color: "var(--pm-track)", label: "to do" },
  ].filter((p) => p.n > 0);
  return (
    <div
      className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
      role="img"
      aria-label={parts.map((p) => `${p.n} ${p.label}`).join(", ")}
    >
      {parts.map((p) => (
        <div key={p.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: p.n, background: p.color }} />
      ))}
    </div>
  );
}

export function ProgressLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <LegendSwatch color="var(--pm-done)" label="Done" />
      <LegendSwatch color="var(--pm-progress)" label="In progress" />
      <LegendSwatch color="var(--pm-track)" label="To do" />
    </div>
  );
}

// ─── Timeline (Gantt) ───────────────────────────────────────────────────

const WEEKS_BEFORE = 4;
const MIN_WEEKS = 16;
const MAX_WEEKS = 30;

/**
 * One row per project across a window of weeks: the planned span (start to
 * latest due date) with its completed share filled in, the forecast finish as
 * a dashed extension when it runs past plan, each dated open task as a
 * diamond, and a line for today.
 */
export function GanttTimeline({ projects, today }: { projects: PmProject[]; today: string }) {
  const [hover, setHover] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { from, weeks } = useMemo(() => {
    const from = addDays(weekStart(today), -7 * WEEKS_BEFORE);
    let last = addDays(from, MIN_WEEKS * 7);
    for (const p of projects) {
      for (const d of [p.planEnd, p.forecastEnd]) if (d && d > last) last = d;
    }
    const weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Math.ceil(diffDays(from, last) / 7) + 1));
    return { from, weeks };
  }, [projects, today]);

  const span = weeks * 7;
  const to = addDays(from, span);
  const pct = (day: string) => Math.min(100, Math.max(0, (diffDays(from, day) / span) * 100));
  const todayPct = pct(today);

  const months = useMemo(() => {
    const out: { label: string; left: number }[] = [];
    for (let i = 0; i <= span; i++) {
      const d = addDays(from, i);
      if (d.endsWith("-01")) out.push({ label: monthName.format(new Date(`${d}T00:00:00Z`)), left: (i / span) * 100 });
    }
    return out;
  }, [from, span]);

  const show = (e: React.PointerEvent, body: ReactNode) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ x: e.clientX - box.left, y: e.clientY - box.top, body });
  };

  const rows = projects.filter((p) => p.total > 0 || p.planEnd);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No project has tasks yet, so there is nothing to schedule.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <LegendSwatch color="var(--pm-plan)" label="Planned span" />
        <LegendSwatch color="var(--pm-done)" label="Completed share" />
        <LegendSwatch color="var(--pm-serious)" label="Forecast past plan" dashed />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rotate-45 rounded-[1px]" style={{ background: "var(--pm-today)" }} /> Task due
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rotate-45 rounded-[1px]" style={{ background: "var(--pm-critical)" }} /> Overdue
        </span>
      </div>

      <div ref={wrapRef} className="relative pb-5" onPointerLeave={() => setHover(null)}>
        {/* Month header, aligned with the tracks */}
        <div className="flex">
          <div className="w-28 shrink-0 sm:w-44" />
          <div className="relative h-5 flex-1 text-[11px] text-muted-foreground">
            {months.map((m) => (
              <span key={m.left} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: `${m.left}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          {/* Week grid + today line behind every track */}
          <div className="pointer-events-none absolute inset-y-0 right-0 left-28 sm:left-44" aria-hidden>
            {Array.from({ length: weeks + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute inset-y-0 w-px"
                style={{ left: `${(i / weeks) * 100}%`, background: "var(--pm-grid)" }}
              />
            ))}
            <div className="absolute inset-y-0 w-[2px] -translate-x-1/2" style={{ left: `${todayPct}%`, background: "var(--pm-today)" }} />
            <span
              className="absolute -bottom-5 -translate-x-1/2 rounded bg-foreground px-1 text-[10px] font-medium text-background"
              style={{ left: `${todayPct}%` }}
            >
              Today
            </span>
          </div>

          {rows.map((p) => {
            const start = p.start && p.start > from ? p.start : from;
            const planEnd = p.planEnd ?? today;
            const barFrom = pct(start < planEnd ? start : planEnd);
            const barTo = pct(planEnd > start ? planEnd : start);
            const width = Math.max(barTo - barFrom, 0.8);
            const clippedLeft = !!p.start && p.start < from;
            const clippedRight = planEnd > to;
            const slip = p.forecastEnd && p.planEnd && p.forecastEnd > p.planEnd;

            return (
              <div key={p.id} className="flex min-h-11 items-center border-b border-border/40 last:border-b-0">
                <div className="w-28 shrink-0 pr-2 sm:w-44">
                  <Link href={`/projects/${p.slug}`} className="block truncate text-xs font-medium hover:underline sm:text-sm">
                    {p.name}
                  </Link>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {p.percentDone}% · {p.planEnd ? `ends ${formatDay(p.planEnd)}` : "no due dates"}
                  </span>
                </div>
                <div className="relative h-11 flex-1">
                  {/* Planned span */}
                  <div
                    className={cn(
                      "absolute top-1/2 h-3.5 -translate-y-1/2 overflow-hidden",
                      clippedLeft ? "rounded-l-none" : "rounded-l-[4px]",
                      clippedRight ? "rounded-r-none" : "rounded-r-[4px]",
                      !p.planEnd && "opacity-60"
                    )}
                    style={{ left: `${barFrom}%`, width: `${width}%`, background: "var(--pm-plan)" }}
                    onPointerMove={(e) =>
                      show(
                        e,
                        <>
                          <div className="font-medium">{p.name}</div>
                          <div>
                            {p.done}/{p.total} done ({p.percentDone}%) · {p.inProgress} in progress
                          </div>
                          <div>
                            Plan: {formatDay(p.start)} → {p.planEnd ? formatDay(p.planEnd) : "no due dates"}
                          </div>
                          <div>
                            Forecast: {p.forecastEnd ? formatDay(p.forecastEnd) : "no recent pace"}
                            {p.slipDays !== null && p.slipDays !== 0 && ` (${p.slipDays > 0 ? `${p.slipDays}d late` : `${-p.slipDays}d early`})`}
                          </div>
                        </>
                      )
                    }
                  >
                    <div className="h-full" style={{ width: `${p.percentDone}%`, background: "var(--pm-done)" }} />
                  </div>

                  {/* Forecast past plan */}
                  {slip && (
                    <div
                      className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-r-[4px]"
                      style={{
                        left: `${barTo}%`,
                        width: `${Math.max(pct(p.forecastEnd!) - barTo, 0.5)}%`,
                        border: "1.5px dashed var(--pm-serious)",
                        borderLeft: "none",
                      }}
                      aria-hidden
                    />
                  )}

                  {/* Task due markers */}
                  {p.milestones.map((m) => {
                    if (m.date < from || m.date > to) return null;
                    return (
                      <Link
                        key={m.taskId}
                        href={`/tasks?task=${m.taskId}`}
                        aria-label={`${m.title}, due ${formatDay(m.date)}`}
                        className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                        style={{ left: `${pct(m.date)}%` }}
                        onPointerMove={(e) => {
                          e.stopPropagation();
                          show(
                            e,
                            <>
                              <div className="font-medium">{m.title}</div>
                              <div>
                                {formatDay(m.date)} · {relativeDay(m.date, today)}
                              </div>
                            </>
                          );
                        }}
                      >
                        <span
                          className="block h-2.5 w-2.5 rotate-45 rounded-[1px] ring-2 ring-background"
                          style={{ background: m.overdue ? "var(--pm-critical)" : "var(--pm-today)" }}
                        />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {hover && (
          <Tip x={hover.x} y={hover.y}>
            {hover.body}
          </Tip>
        )}
      </div>
    </div>
  );
}

// ─── Workload heatmap (projects × weeks ahead) ──────────────────────────

const HEAT_STEPS = ["--pm-heat-1", "--pm-heat-2", "--pm-heat-3", "--pm-heat-4", "--pm-heat-5"];

export function WorkloadHeatmap({ weeks, rows, today }: { weeks: string[]; rows: PmWorkloadRow[]; today: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.counts));
  const totals = weeks.map((_, i) => rows.reduce((s, r) => s + r.counts[i], 0));

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing open is due in the next {weeks.length} weeks.</p>;
  }

  const cell = (n: number) => {
    if (n === 0) return { background: "transparent", color: "var(--pm-ink-muted)" };
    const step = Math.min(HEAT_STEPS.length - 1, Math.floor(((n - 1) / max) * HEAT_STEPS.length));
    return {
      background: `var(${HEAT_STEPS[step]})`,
      color: step >= 3 ? "var(--pm-heat-ink-high)" : "var(--pm-heat-ink-low)",
    };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-xs">
        <caption className="sr-only">Open tasks due per project per week</caption>
        <thead>
          <tr>
            <th className="w-28 text-left font-normal text-muted-foreground sm:w-44" scope="col">
              Project
            </th>
            {weeks.map((w, i) => (
              <th key={w} scope="col" className="min-w-9 text-center font-normal tabular-nums text-muted-foreground">
                {i === 0 ? "This wk" : formatDay(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.projectId}>
              <th scope="row" className="max-w-28 truncate pr-2 text-left font-medium sm:max-w-44">
                <Link href={`/projects/${r.projectSlug}`} className="hover:underline">
                  {r.projectName}
                </Link>
              </th>
              {r.counts.map((n, i) => (
                <td
                  key={i}
                  className="h-9 rounded-[4px] text-center tabular-nums"
                  style={cell(n)}
                  title={`${r.projectName}: ${n} due ${i === 0 ? "this week (incl. overdue)" : `week of ${formatDay(weeks[i])}`}`}
                >
                  {n || "·"}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-1 pr-2 text-left font-normal text-muted-foreground">
              All projects
            </th>
            {totals.map((n, i) => (
              <td key={i} className="pt-1 text-center font-semibold tabular-nums">
                {n}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Darker = more due. This week includes anything overdue (as of {formatDay(today)}).
      </p>
    </div>
  );
}

// ─── Throughput: created vs completed per week ──────────────────────────

const CHART_H = 180;
const PAD = { top: 12, right: 8, bottom: 22, left: 28 };

export function ThroughputChart({ history }: { history: PmWeek[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...history.flatMap((w) => [w.created, w.completed])));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const slot = history.length ? innerW / history.length : 0;
  const barW = Math.max(2, Math.min(14, (slot - 6) / 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4">
        <LegendSwatch color="var(--pm-created)" label="Added" />
        <LegendSwatch color="var(--pm-done)" label="Completed" />
      </div>
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={CHART_H} role="img" aria-label="Tasks added and completed per week">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--pm-axis)" : "var(--pm-grid)"} />
                <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--pm-ink-muted)" className="tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {history.map((w, i) => {
              const cx = PAD.left + slot * i + slot / 2;
              return (
                <g key={w.weekStart}>
                  {hover === i && <rect x={cx - slot / 2} y={PAD.top} width={slot} height={innerH} fill="var(--pm-grid)" opacity={0.5} />}
                  {[
                    { v: w.created, color: "var(--pm-created)", x: cx - barW - 1 },
                    { v: w.completed, color: "var(--pm-done)", x: cx + 1 },
                  ].map((b, j) =>
                    b.v > 0 ? (
                      <path key={j} d={roundedTopBar(b.x, y(b.v), barW, y(0) - y(b.v))} fill={b.color} />
                    ) : null
                  )}
                  {(i % 2 === history.length % 2 || slot > 48) && (
                    <text x={cx} y={CHART_H - 6} textAnchor="middle" fontSize={10} fill="var(--pm-ink-muted)">
                      {formatDay(w.weekStart)}
                    </text>
                  )}
                  <rect
                    x={cx - slot / 2}
                    y={0}
                    width={slot}
                    height={CHART_H}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tip x={PAD.left + slot * hover + slot / 2} y={PAD.top + 8}>
            <div className="font-medium">Week of {formatDay(history[hover].weekStart)}</div>
            <div>{history[hover].created} added</div>
            <div>{history[hover].completed} completed</div>
            <div className="text-muted-foreground">
              Net {history[hover].created - history[hover].completed >= 0 ? "+" : ""}
              {history[hover].created - history[hover].completed} open
            </div>
          </Tip>
        )}
      </div>
    </div>
  );
}

function roundedTopBar(x: number, top: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
}

// ─── Burn-up: scope vs done, cumulative ─────────────────────────────────

export function BurnupChart({ history }: { history: PmWeek[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const LABEL_W = 64;
  const max = niceMax(Math.max(1, ...history.map((w) => w.scope)));
  const innerW = Math.max(0, width - PAD.left - PAD.right - LABEL_W);
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (history.length > 1 ? (i / (history.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const line = (key: "scope" | "doneTotal") => history.map((w, i) => `${i ? "L" : "M"}${x(i)},${y(w[key])}`).join(" ");
  const last = history[history.length - 1];
  const ticks = [0, max / 2, max];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left - PAD.left;
    const i = Math.round((rel / Math.max(innerW, 1)) * (history.length - 1));
    setHover(Math.min(history.length - 1, Math.max(0, i)));
  };

  // Keep the two end labels from colliding.
  let scopeLabelY = y(last?.scope ?? 0);
  let doneLabelY = y(last?.doneTotal ?? 0);
  if (Math.abs(scopeLabelY - doneLabelY) < 14) {
    const mid = (scopeLabelY + doneLabelY) / 2;
    scopeLabelY = mid - 7;
    doneLabelY = mid + 7;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4">
        <LegendSwatch color="var(--pm-created)" label="Total scope" />
        <LegendSwatch color="var(--pm-done)" label="Done" />
      </div>
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {width > 0 && last && (
          <svg width={width} height={CHART_H} role="img" aria-label="Cumulative scope and completed tasks" onPointerMove={onMove}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--pm-axis)" : "var(--pm-grid)"} />
                <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--pm-ink-muted)" className="tabular-nums">
                  {t}
                </text>
              </g>
            ))}
            {/* Gap between the lines is the work still open */}
            <path
              d={`${line("scope")} ${history
                .map((_, i) => history.length - 1 - i)
                .map((i) => `L${x(i)},${y(history[i].doneTotal)}`)
                .join(" ")} Z`}
              fill="var(--pm-plan)"
              opacity={0.35}
            />
            <path d={line("scope")} fill="none" stroke="var(--pm-created)" strokeWidth={2} strokeLinejoin="round" />
            <path d={line("doneTotal")} fill="none" stroke="var(--pm-done)" strokeWidth={2} strokeLinejoin="round" />
            <text x={x(history.length - 1) + 6} y={scopeLabelY + 3} fontSize={10} fill="currentColor" className="tabular-nums">
              {last.scope} scope
            </text>
            <text x={x(history.length - 1) + 6} y={doneLabelY + 3} fontSize={10} fill="currentColor" className="tabular-nums">
              {last.doneTotal} done
            </text>
            {[0, history.length - 1].map((i) => (
              <text key={i} x={x(i)} y={CHART_H - 6} textAnchor={i ? "end" : "start"} fontSize={10} fill="var(--pm-ink-muted)">
                {formatDay(history[i].weekStart)}
              </text>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--pm-axis)" />
                <circle cx={x(hover)} cy={y(history[hover].scope)} r={4} fill="var(--pm-created)" stroke="var(--background)" strokeWidth={2} />
                <circle cx={x(hover)} cy={y(history[hover].doneTotal)} r={4} fill="var(--pm-done)" stroke="var(--background)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {hover !== null && width > 0 && (
          <Tip x={x(hover)} y={PAD.top + 8}>
            <div className="font-medium">Week of {formatDay(history[hover].weekStart)}</div>
            <div>{history[hover].scope} in scope</div>
            <div>{history[hover].doneTotal} done</div>
            <div className="text-muted-foreground">{history[hover].scope - history[hover].doneTotal} still open</div>
          </Tip>
        )}
      </div>
    </div>
  );
}
