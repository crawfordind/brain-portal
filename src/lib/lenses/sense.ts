/**
 * Sensing: read a note body into signals (series, dates, checklists, facts).
 *
 * Pure and synchronous, so the lens strip can follow the note as it is typed.
 * Nothing here calls a model; `ai-extract.ts` contributes signals of the same
 * shape for notes too loose for rules to read (brain dumps, transcripts).
 */

import * as chrono from "chrono-node";
import { toBlocks, type Block } from "./blocks";
import {
  emptySignals,
  type ChecklistItem,
  type DatedItem,
  type Fact,
  type Metric,
  type NoteSignals,
  type OutlineSection,
  type Series,
  type TableData,
} from "./types";

export interface SenseOptions {
  /** What relative dates ("Friday", "next week") are relative to. */
  referenceDate?: Date;
}

// ─── Numbers ─────────────────────────────────────────────────────────────────

export interface Quantity {
  value: number;
  unit?: string;
}

const QUANTITY =
  /^[~≈]?\s*([-+]?)\s*([$€£])?\s*([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(bn|mm|[kKmMbB](?![a-zA-Z]))?\s*(%|[a-zA-Z][a-zA-Z/]{0,11})?\s*(.*)$/;

/**
 * Read a leading number with its currency, scale and unit: "$1.2M", "45%",
 * "12 hrs", "1,200 users". Anything after that must be short (an aside like
 * "(up 10%)"), or the text is a sentence that happens to start with a number.
 */
export function parseQuantity(input: string): Quantity | null {
  const m = input.trim().match(QUANTITY);
  if (!m) return null;
  const [, sign, currency, digits, scale, unitWord, rest] = m;
  if (rest && rest.replace(/^[,;]\s*/, "").length > 24 && !/^\(.*\)$/.test(rest)) return null;

  let value = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (sign === "-") value = -value;

  let unit: string | undefined = currency;
  if (scale) {
    const s = scale.toLowerCase();
    if (s === "k") value *= 1e3;
    else if (s === "b" || s === "bn") value *= 1e9;
    // A lowercase "m" is minutes or metres unless it follows a currency.
    else if (s === "mm" || scale === "M" || currency) value *= 1e6;
    else unit = unit ?? "m";
  }
  if (unitWord) unit = unitWord === "%" ? "%" : (unit ?? unitWord.toLowerCase());
  return { value, unit };
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];
const MONTH_LABEL =
  /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+['’]?(\d{2}|\d{4}))?$/i;
const QUARTER_LABEL = /^(?:q([1-4])\s*['’]?(\d{2}|\d{4})?|(\d{4})\s*q([1-4]))$/i;
const YEAR_LABEL = /^(?:fy\s*)?['’]?((?:19|20)\d{2})$/i;
const ISO_LABEL = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const SLASH_DATE_LABEL = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/;
const PERIOD_LABEL = /^(?:week|wk|w|day|month|sprint)\s*#?\d{1,3}$/i;
const WEEKDAY_LABEL = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|urday|sday)?\.?$/i;
const ORDINAL_LABEL = /^(?:stage|step|phase|round|level|tier|version|v|#)\s*\d+/i;

const fullYear = (y?: string) => (!y ? 0 : y.length === 2 ? 2000 + Number(y) : Number(y));

/** A sortable key for a temporal label, or null when it has no absolute order. */
export function temporalKey(label: string): number | null {
  const l = label.trim();
  let m: RegExpMatchArray | null;
  if ((m = l.match(MONTH_LABEL))) {
    return fullYear(m[2]) * 12 + MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  }
  if ((m = l.match(QUARTER_LABEL))) {
    const q = Number(m[1] ?? m[4]);
    return fullYear(m[2] ?? m[3]) * 4 + q;
  }
  if ((m = l.match(YEAR_LABEL))) return Number(m[1]);
  if ((m = l.match(ISO_LABEL))) return Number(m[1]) * 400 + Number(m[2]) * 32 + Number(m[3] ?? 0);
  if ((m = l.match(PERIOD_LABEL))) return Number(l.match(/\d+/)![0]);
  return null;
}

export function isTemporalLabel(label: string): boolean {
  const l = label.trim();
  return (
    temporalKey(l) !== null || SLASH_DATE_LABEL.test(l) || WEEKDAY_LABEL.test(l)
  );
}

// ─── Label/value lines ───────────────────────────────────────────────────────

interface LabelValue {
  label: string;
  value: string;
}

const LABEL_VALUE = /^(.{1,48}?)\s*(?::|=|\s[-–—]\s)\s*(.+)$/;

/** "Revenue: $1.2M", "Owner = Dana", "Q1 — 120". */
export function splitLabelValue(text: string): LabelValue | null {
  const m = text.match(LABEL_VALUE);
  if (!m) return null;
  const label = m[1].replace(/^[-*•]\s*/, "").trim();
  const value = m[2].trim();
  if (!label || !value) return null;
  if (/https?$|^www\b/i.test(label) || /^\/\//.test(value)) return null;
  if (label.split(/\s+/).length > 6) return null;
  return { label, value };
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const DEADLINE_WORDS = /\b(due|by|deadline|before|until|no later than|submit|deliver)\b/i;
const IGNORED_DATE_TEXT = /^(now|right now|currently)$/i;

const pad2 = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function findDates(text: string, referenceDate: Date): DatedItem[] {
  const results = chrono.parse(text, referenceDate, { forwardDate: true });
  const out: DatedItem[] = [];
  for (const r of results) {
    if (IGNORED_DATE_TEXT.test(r.text.trim())) continue;
    // A bare number chrono read as a day of the month is almost never a date.
    if (/^\d{1,2}$/.test(r.text.trim())) continue;
    const d = r.start.date();
    out.push({
      date: localDay(d),
      time: r.start.isCertain("hour") ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : undefined,
      text,
      kind: DEADLINE_WORDS.test(text) ? "deadline" : "event",
      origin: "note",
    });
    break; // one date per line; the first is the one the sentence is about
  }
  return out;
}

// ─── Actions worded in prose ─────────────────────────────────────────────────

const ACTION_PREFIX = /^(?:todo|to-do|action(?:\s+item)?|next\s+steps?|follow[- ]?up)\s*[:\-–]\s*(.+)$/i;

// ─── Tables ──────────────────────────────────────────────────────────────────

function tableToSeries(t: { headers: string[]; rows: string[][] }, title?: string): Series | null {
  if (t.rows.length < 2 || t.headers.length < 2) return null;
  const parsed = t.rows.map((r) => r.map((c) => (c ? parseQuantity(c) : null)));
  const numericCols: number[] = [];
  for (let c = 1; c < t.headers.length; c++) {
    const filled = t.rows.filter((r) => r[c]).length;
    const numeric = parsed.filter((r) => r[c]).length;
    if (filled > 0 && numeric / filled >= 0.6) numericCols.push(c);
  }
  // The label column must be words, or every column is a measure and there is
  // nothing to label the bars with.
  const labelNumeric = parsed.filter((r) => r[0]).length / t.rows.length;
  if (!numericCols.length || (labelNumeric > 0.5 && !t.rows.every((r) => isTemporalLabel(r[0])))) {
    return null;
  }
  const labels = t.rows.map((r) => r[0] || "—");
  return finishSeries({
    title,
    labels,
    measures: numericCols.map((c) => {
      const units = parsed.map((r) => r[c]?.unit).filter(Boolean);
      return {
        name: t.headers[c] || `Column ${c + 1}`,
        unit: units.length ? units[0] : undefined,
        values: parsed.map((r) => r[c]?.value ?? null),
      };
    }),
  });
}

/** Fill in temporal/ordinal and put a time series in chronological order. */
function finishSeries(s: Omit<Series, "temporal" | "ordinal" | "origin">): Series {
  const temporal = s.labels.every(isTemporalLabel);
  const ordinal = !temporal && s.labels.every((l) => ORDINAL_LABEL.test(l.trim()));
  const series: Series = { ...s, temporal, ordinal, origin: "note" };
  if (temporal) {
    const keys = s.labels.map(temporalKey);
    const known = keys.every((k): k is number => k !== null);
    if (known && keys.every((k, i) => i === 0 || k < keys[i - 1])) {
      // Written newest-first; a line chart reads left to right in time.
      series.labels = [...s.labels].reverse();
      series.measures = s.measures.map((m) => ({ ...m, values: [...m.values].reverse() }));
    }
  }
  return series;
}

// ─── The pass ────────────────────────────────────────────────────────────────

const MIN_SERIES_POINTS = 3;

export function senseNote(content: string, options: SenseOptions = {}): NoteSignals {
  const referenceDate = options.referenceDate ?? new Date();
  const blocks = toBlocks(content);
  const signals = emptySignals();

  const headingFor = new Map<number, string>();
  let sectionNo = 0;
  for (const b of blocks) if (b.type === "heading") headingFor.set(++sectionNo, b.text);

  // Runs of consecutive "label: number" lines in one section become a series;
  // shorter runs are headline numbers.
  let run: { section: number; points: { label: string; q: Quantity }[] } | null = null;
  const closeRun = () => {
    if (!run) return;
    const { points, section } = run;
    const units = new Set(points.map((p) => p.q.unit ?? ""));
    if (points.length >= MIN_SERIES_POINTS && units.size === 1) {
      const unit = points[0].q.unit;
      const title = headingFor.get(section);
      signals.series.push(
        finishSeries({
          title,
          labels: points.map((p) => p.label),
          measures: [{ name: title ?? "Value", unit, values: points.map((p) => p.q.value) }],
        })
      );
    } else {
      for (const p of points) {
        signals.metrics.push({ label: p.label, value: p.q.value, unit: p.q.unit, origin: "note" });
      }
    }
    run = null;
  };

  let current: OutlineSection | null = null;

  for (const b of blocks) {
    if (b.type === "heading") {
      closeRun();
      current = b.level <= 3 ? { heading: b.text, items: [] } : current;
      if (b.level <= 3 && current) signals.outline.push(current);
      continue;
    }

    if (b.type === "table") {
      closeRun();
      const title = headingFor.get(b.section);
      const table: TableData = { title, headers: b.headers, rows: b.rows };
      signals.tables.push(table);
      const series = tableToSeries(b, title);
      if (series) signals.series.push(series);
      continue;
    }

    const text = b.text;
    if (current && current.items.length < 50) current.items.push(text);

    if (b.type === "item" && b.checked !== undefined) {
      closeRun();
      const item: ChecklistItem = { text, done: b.checked, taskIndex: b.taskIndex, origin: "note" };
      signals.checklist.push(item);
      if (!b.checked) signals.dated.push(...findDates(text, referenceDate));
      continue;
    }

    const action = text.match(ACTION_PREFIX);
    if (action) {
      closeRun();
      signals.checklist.push({ text: action[1].trim(), done: false, origin: "note" });
      signals.dated.push(...findDates(text, referenceDate));
      continue;
    }

    const lv = splitLabelValue(text);
    const q = lv ? parseQuantity(lv.value) : null;
    if (lv && q) {
      if (run && run.section !== sectionOf(b)) closeRun();
      run ??= { section: sectionOf(b), points: [] };
      run.points.push({ label: lv.label, q });
      continue;
    }
    closeRun();

    const dates = findDates(text, referenceDate);
    if (dates.length) {
      signals.dated.push(...dates);
      continue;
    }

    if (lv && lv.value.length <= 80 && lv.label.split(/\s+/).length <= 4) {
      signals.facts.push({ key: lv.label, value: lv.value, origin: "note" });
    }
  }
  closeRun();

  signals.outline = signals.outline.filter((s) => s.items.length > 0);
  signals.dated = dedupeDated(signals.dated);
  signals.facts = dedupeFacts(signals.facts);
  return signals;
}

function sectionOf(b: Block): number {
  return "section" in b ? b.section : 0;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function dedupeDated(items: DatedItem[]): DatedItem[] {
  const seen = new Set<string>();
  return items.filter((d) => {
    const k = `${d.date}|${norm(d.text)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function dedupeFacts(facts: Fact[]): Fact[] {
  const seen = new Set<string>();
  return facts.filter((f) => {
    const k = norm(f.key);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function dedupeMetrics(metrics: Metric[]): Metric[] {
  const seen = new Set<string>();
  return metrics.filter((m) => {
    const k = norm(m.label);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
