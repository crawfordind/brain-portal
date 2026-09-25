"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChartForm, Series } from "@/lib/lenses/types";

// ─── Formatting ──────────────────────────────────────────────────────────────

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

export function formatValue(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return "—";
  const n = Math.abs(value) >= 100_000 ? compact.format(value) : plain.format(value);
  if (!unit) return n;
  if (unit === "%") return `${n}%`;
  if (/^[$€£]$/.test(unit)) return value < 0 ? `-${unit}${n.slice(1)}` : `${unit}${n}`;
  return `${n} ${unit}`;
}

/** Round-number ticks spanning [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
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

// ─── Bars ────────────────────────────────────────────────────────────────────

function Bars({ series, measure, form }: { series: Series; measure: number; form: ChartForm }) {
  const m = series.measures[measure];
  const [hover, setHover] = useState<number | null>(null);

  const rows = useMemo(() => {
    const r = series.labels.map((label, i) => ({ label, value: m.values[i] }));
    // Keep a written order when the labels carry one; otherwise biggest first.
    return series.ordinal ? r : [...r].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  }, [series, m]);

  const maxAbs =
    form === "share" ? 100 : Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), Number.EPSILON);

  return (
    <ul className="space-y-1" onPointerLeave={() => setHover(null)}>
      {rows.map((r, i) => {
        const pct = r.value === null ? 0 : (Math.abs(r.value) / maxAbs) * 100;
        return (
          <li
            key={`${r.label}-${i}`}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 min-h-9 rounded-md px-1 -mx-1"
            onPointerEnter={() => setHover(i)}
            title={`${r.label}: ${formatValue(r.value, m.unit)}`}
          >
            <span className="truncate text-sm">{r.label}</span>
            <span className="relative h-5">
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity",
                  r.value !== null && r.value < 0 ? "bg-muted-foreground" : "bg-primary",
                  hover !== null && hover !== i && "opacity-35"
                )}
                style={{ width: `${Math.max(pct, r.value ? 0.75 : 0)}%` }}
              />
            </span>
            <span className="text-sm tabular-nums text-muted-foreground text-right">
              {formatValue(r.value, m.unit)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Line ────────────────────────────────────────────────────────────────────

const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

function Line({ series, measure }: { series: Series; measure: number }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = series.measures[measure];
  const n = series.labels.length;

  const geo = useMemo(() => {
    const vals = m.values.filter((v): v is number => v !== null);
    if (!vals.length || width <= PAD.left + PAD.right) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    // Anchor at zero when the data is well away from it; a trend line that
    // hugs the top of a zero-based axis shows no trend at all otherwise.
    const ticks = niceTicks(min >= 0 && min < max * 0.5 ? 0 : min, max);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const innerW = width - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

    let path = "";
    let area = "";
    let segStart: number | null = null;
    m.values.forEach((v, i) => {
      if (v === null) {
        if (segStart !== null) area += `L${x(i - 1)},${y(lo)}L${x(segStart)},${y(lo)}Z`;
        segStart = null;
        return;
      }
      path += `${segStart === null ? "M" : "L"}${x(i)},${y(v)}`;
      area += `${segStart === null ? "M" : "L"}${x(i)},${y(v)}`;
      if (segStart === null) segStart = i;
    });
    if (segStart !== null) area += `L${x(n - 1)},${y(lo)}L${x(segStart)},${y(lo)}Z`;

    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));
    const xTicks = series.labels
      .map((l, i) => ({ l, i }))
      .filter(({ i }) => i === 0 || i === n - 1 || (i % every === 0 && n - 1 - i >= every / 2));
    return { ticks, x, y, path, area, xTicks, lo };
  }, [m, n, series.labels, width]);

  const lastIdx = m.values.findLastIndex((v) => v !== null);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const innerW = width - PAD.left - PAD.right;
    const i = Math.round(((e.clientX - rect.left - PAD.left) / (innerW || 1)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hv = hover !== null ? m.values[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: H }}>
      {geo && (
        <svg
          width={width}
          height={H}
          className="block touch-pan-y"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${m.name}: ${series.labels
            .map((l, i) => `${l} ${formatValue(m.values[i], m.unit)}`)
            .join(", ")}`}
        >
          {geo.ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={geo.y(t)}
                y2={geo.y(t)}
                className={t === geo.lo ? "stroke-muted-foreground/40" : "stroke-border"}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={geo.y(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {formatValue(t, m.unit)}
              </text>
            </g>
          ))}
          {geo.xTicks.map(({ l, i }) => (
            <text
              key={i}
              x={geo.x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[11px]"
            >
              {l}
            </text>
          ))}
          <path d={geo.area} className="fill-primary/10" />
          <path
            d={geo.path}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hover !== null && (
            <line
              x1={geo.x(hover)}
              x2={geo.x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
            />
          )}
          {(hover !== null ? (hv !== null ? [hover] : []) : lastIdx >= 0 ? [lastIdx] : []).map((i) => (
            <circle
              key={i}
              cx={geo.x(i)}
              cy={geo.y(m.values[i]!)}
              r={4.5}
              className="fill-primary stroke-background"
              strokeWidth={2}
            />
          ))}
        </svg>
      )}
      {geo && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(geo.x(hover) - 60, 0), Math.max(0, width - 120)),
          }}
        >
          <div className="text-muted-foreground">{series.labels[hover]}</div>
          <div className="font-medium tabular-nums">{formatValue(hv, m.unit)}</div>
        </div>
      )}
    </div>
  );
}

// ─── The lens body ───────────────────────────────────────────────────────────

export function LensChart({ series, form }: { series: Series; form: ChartForm }) {
  const [measure, setMeasure] = useState(0);
  const [asTable, setAsTable] = useState(false);
  const m = series.measures[Math.min(measure, series.measures.length - 1)];
  const idx = series.measures.indexOf(m);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {series.measures.length > 1 &&
          series.measures.map((mm, i) => (
            <button
              key={mm.name + i}
              type="button"
              onClick={() => setMeasure(i)}
              aria-pressed={i === idx}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm transition-colors",
                i === idx ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {mm.name}
            </button>
          ))}
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="ml-auto min-h-9 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">&nbsp;</th>
                {series.measures.map((mm, i) => (
                  <th key={i} className="py-2 pr-4 font-medium text-right">
                    {mm.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.labels.map((l, r) => (
                <tr key={r} className="border-b last:border-0">
                  <td className="py-2 pr-4">{l}</td>
                  {series.measures.map((mm, i) => (
                    <td key={i} className="py-2 pr-4 text-right tabular-nums">
                      {formatValue(mm.values[r], mm.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : form === "line" ? (
        <Line series={series} measure={idx} />
      ) : (
        <Bars series={series} measure={idx} form={form} />
      )}
      {form === "share" && !asTable && (
        <p className="text-xs text-muted-foreground">Each bar is a share of 100%.</p>
      )}
    </div>
  );
}
