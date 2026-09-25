/**
 * Choosing: signals → lenses, by fixed rules.
 *
 * This is the deterministic half of the design. A model may *read* a note
 * (see `ai-extract.ts`), but the view for a given shape of data is always
 * picked here, so it never changes from one run to the next and every lens
 * can state in plain words why it was chosen. The rules follow the usual
 * "the data's job picks the form" guidance:
 *
 *   change over time          → line
 *   compare amounts           → bar, sorted so the biggest leads
 *   parts of a whole (≈100%)  → share bars on one 0–100 scale
 *   a few standalone numbers  → stat tiles, not a chart
 *   dated things              → timeline
 *   checkboxes / action lines → checklist
 *   rows and columns          → sortable table
 *   "key: value" details      → fact card
 *   headed sections           → outline of cards
 */

import { dedupeDated, dedupeFacts, dedupeMetrics } from "./sense";
import type { ChartForm, Lens, NoteSignals, Series } from "./types";

export const MAX_LENSES = 10;

export function chartFormFor(series: Series): ChartForm {
  if (series.temporal) return "line";
  const m = series.measures[0];
  if (m?.unit === "%" && series.measures.length === 1) {
    const total = m.values.reduce<number>((a, v) => a + (v ?? 0), 0);
    if (total >= 95 && total <= 105 && m.values.every((v) => v === null || v >= 0)) return "share";
  }
  return "bar";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function chartReason(form: ChartForm, s: Series): string {
  const n = s.labels.length;
  const measures = s.measures.length > 1 ? ` (${s.measures.length} measures, switch between them)` : "";
  switch (form) {
    case "line":
      return `${plural(n, "value")} over time, ${s.labels[0]} to ${s.labels[n - 1]}${measures}. A line shows the trend and where it turned.`;
    case "share":
      return `${plural(n, "percentage")} that add up to 100%. One scale shows each part's share of the whole.`;
    default:
      return s.ordinal
        ? `${plural(n, "amount")} in a set order${measures}. Bars keep that order so you can compare each step.`
        : `${plural(n, "amount")} across categories${measures}. Sorted bars put the biggest first.`;
  }
}

function seriesTitle(s: Series, form: ChartForm): string {
  if (s.title) return s.title;
  const m = s.measures[0]?.name;
  if (m && m !== "Value") return m;
  return form === "line" ? "Trend" : form === "share" ? "Breakdown" : "Comparison";
}

/** Merge two signal sets, the note's own first. */
export function mergeSignals(note: NoteSignals, ai: NoteSignals | null | undefined): NoteSignals {
  if (!ai) return note;
  const seriesKey = (s: Series) => s.labels.map((l) => l.toLowerCase().trim()).join("|");
  const noteSeries = new Set(note.series.map(seriesKey));
  const noteChecklist = new Set(note.checklist.map((c) => c.text.toLowerCase().trim()));
  return {
    series: [...note.series, ...ai.series.filter((s) => !noteSeries.has(seriesKey(s)))],
    tables: [...note.tables, ...ai.tables],
    dated: dedupeDated([...note.dated, ...ai.dated]),
    checklist: [
      ...note.checklist,
      ...ai.checklist.filter((c) => !noteChecklist.has(c.text.toLowerCase().trim())),
    ],
    facts: dedupeFacts([...note.facts, ...ai.facts]),
    metrics: dedupeMetrics([...note.metrics, ...ai.metrics]),
    outline: note.outline.length ? note.outline : ai.outline,
    suggestions: [...note.suggestions, ...ai.suggestions],
  };
}

export function chooseLenses(signals: NoteSignals, options: { today?: string } = {}): Lens[] {
  const lenses: Lens[] = [];
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  // Checklist: what is still open is what the reader came for.
  if (signals.checklist.length) {
    const open = signals.checklist.filter((c) => !c.done).length;
    const total = signals.checklist.length;
    const tickable = signals.checklist.some((c) => c.taskIndex !== undefined);
    lenses.push({
      id: "checklist",
      kind: "checklist",
      title: "To do",
      items: signals.checklist,
      reason: `${open} open of ${total}. ${
        tickable ? "Tick them off here and the note updates." : "Turn any of them into a task."
      }`,
      score: 80 + Math.min(open, 10),
      fromAi: signals.checklist.some((c) => c.origin === "ai"),
    });
  }

  if (signals.suggestions.length) {
    lenses.push({
      id: "actions",
      kind: "actions",
      title: "Next steps",
      actions: signals.suggestions,
      reason: `${plural(signals.suggestions.length, "step")} this note points to. Nothing is created until you add it.`,
      score: 78,
      fromAi: true,
    });
  }

  // Timeline: one dated line is a sentence, not a schedule, unless it's a deadline.
  const dated = [...signals.dated].sort((a, b) =>
    a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)
  );
  if (dated.length >= 2 || dated.some((d) => d.kind === "deadline")) {
    const upcoming = dated.filter((d) => d.date >= today).length;
    lenses.push({
      id: "timeline",
      kind: "timeline",
      title: "Timeline",
      items: dated,
      reason: `${plural(dated.length, "dated item")}${
        upcoming ? `, ${upcoming} still ahead` : ""
      }. In date order so what's next is obvious.`,
      score: 70 + Math.min(upcoming, 10),
      fromAi: dated.some((d) => d.origin === "ai"),
    });
  }

  signals.series.forEach((s, i) => {
    const form = chartFormFor(s);
    lenses.push({
      id: `chart-${i}`,
      kind: "chart",
      form,
      series: s,
      title: seriesTitle(s, form),
      reason: chartReason(form, s),
      score: 75 + Math.min(s.labels.length, 12) - i,
      fromAi: s.origin === "ai",
    });
  });

  // Stat tiles: a single number isn't a dashboard; a handful is.
  if (signals.metrics.length >= 2) {
    const metrics = signals.metrics.slice(0, 8);
    lenses.push({
      id: "metrics",
      kind: "metrics",
      title: "Key numbers",
      metrics,
      reason: `${plural(metrics.length, "standalone number")}. Tiles put the headline figures up front.`,
      score: 65 + metrics.length,
      fromAi: metrics.some((m) => m.origin === "ai"),
    });
  }

  // A numeric table is also a chart, usually under the same heading; the
  // table lens says which one it is so the two tabs aren't twins.
  const chartTitles = new Set(lenses.filter((l) => l.kind === "chart").map((l) => l.title));
  signals.tables.forEach((t, i) => {
    if (!t.rows.length) return;
    lenses.push({
      id: `table-${i}`,
      kind: "table",
      title: !t.title ? "Table" : chartTitles.has(t.title) ? `${t.title} table` : t.title,
      table: t,
      reason: `${plural(t.rows.length, "row")} × ${plural(t.headers.length, "column")}. Tap a header to sort.`,
      score: 60 - i,
      fromAi: false,
    });
  });

  if (signals.facts.length >= 2) {
    lenses.push({
      id: "facts",
      kind: "facts",
      title: "Details",
      facts: signals.facts,
      reason: `${plural(signals.facts.length, "detail")} pulled out as a quick-reference card.`,
      score: 50 + Math.min(signals.facts.length, 8),
      fromAi: signals.facts.some((f) => f.origin === "ai"),
    });
  }

  if (signals.outline.length >= 2) {
    lenses.push({
      id: "outline",
      kind: "outline",
      title: "Sections",
      sections: signals.outline,
      reason: `${plural(signals.outline.length, "section")}, each as a card you can skim.`,
      score: 40 + Math.min(signals.outline.length, 8),
      fromAi: false,
    });
  }

  return lenses.sort((a, b) => b.score - a.score).slice(0, MAX_LENSES);
}
