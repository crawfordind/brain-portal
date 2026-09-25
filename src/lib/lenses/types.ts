/**
 * Note Lenses: the shapes shared by sensing, choosing and rendering.
 *
 * A note is the source of truth. A *lens* is a derived view of it (a chart, a
 * timeline, a checklist) that the reader swipes to. Sensing reads the note
 * into *signals*; choosing turns signals into lenses by fixed rules. A model
 * may contribute signals ("read deeper"), but never picks the view, so the
 * same data always gets the same lens and every lens can say why it exists.
 *
 * Imports nothing, for the same reason as `chat/item-types.ts`: the browser
 * bundle, the API route and the AI extractor all read these types.
 */

/** Where a signal came from. Only `note` items can be written back. */
export type SignalOrigin = "note" | "ai";

/** One measured quantity across the series' labels. */
export interface Measure {
  name: string;
  /** "$", "%", "€", "£" or a trailing word ("hrs", "users"). */
  unit?: string;
  /** Aligned with `Series.labels`; null where the source row had no number. */
  values: (number | null)[];
}

/** Labelled numbers: a list of "Jan: 120" lines, or a table's numeric columns. */
export interface Series {
  title?: string;
  labels: string[];
  /** Every label reads as a point in time, in order. */
  temporal: boolean;
  /** Labels carry their own order ("Stage 1", "Step 2"), so don't re-sort. */
  ordinal: boolean;
  measures: Measure[];
  origin: SignalOrigin;
}

export interface DatedItem {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** HH:MM when the source named a time. */
  time?: string;
  text: string;
  kind: "event" | "deadline";
  origin: SignalOrigin;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
  /**
   * Position among the note's own checkbox items, so ticking it in a lens can
   * tick it in the note. Absent for items that were only *worded* as actions
   * ("TODO: call Dana"), which can become tasks but have no box to tick.
   */
  taskIndex?: number;
  origin: SignalOrigin;
}

export interface TableData {
  title?: string;
  headers: string[];
  rows: string[][];
}

export interface Fact {
  key: string;
  value: string;
  origin: SignalOrigin;
}

/** A single headline number that is not part of any series. */
export interface Metric {
  label: string;
  value: number;
  unit?: string;
  origin: SignalOrigin;
}

export interface OutlineSection {
  heading: string;
  items: string[];
}

/** A next step the model recommends. Never auto-created; the user adds it. */
export interface SuggestedAction {
  text: string;
  dueDate?: string;
  why?: string;
}

export interface NoteSignals {
  series: Series[];
  /** Tables with nothing to chart. Charted tables live in `series`. */
  tables: TableData[];
  dated: DatedItem[];
  checklist: ChecklistItem[];
  facts: Fact[];
  metrics: Metric[];
  outline: OutlineSection[];
  suggestions: SuggestedAction[];
}

export type LensKind =
  | "actions"
  | "checklist"
  | "chart"
  | "timeline"
  | "metrics"
  | "table"
  | "facts"
  | "outline";

/** How a chart lens draws its series; chosen by rule in `choose.ts`. */
export type ChartForm = "line" | "bar" | "share";

interface LensBase {
  /** Stable across edits while the note keeps the same shape. */
  id: string;
  title: string;
  /** One sentence, shown on the lens: what it found and why this view. */
  reason: string;
  score: number;
  /** True when any of this lens's data came from the model. */
  fromAi: boolean;
}

export type Lens =
  | (LensBase & { kind: "chart"; form: ChartForm; series: Series })
  | (LensBase & { kind: "timeline"; items: DatedItem[] })
  | (LensBase & { kind: "checklist"; items: ChecklistItem[] })
  | (LensBase & { kind: "metrics"; metrics: Metric[] })
  | (LensBase & { kind: "table"; table: TableData })
  | (LensBase & { kind: "facts"; facts: Fact[] })
  | (LensBase & { kind: "outline"; sections: OutlineSection[] })
  | (LensBase & { kind: "actions"; actions: SuggestedAction[] });

/** What the "read deeper" endpoint returns. */
export interface DeepRead {
  /** `contentFingerprint` of the note body that was read. */
  fingerprint: string;
  signals: NoteSignals;
  /** One or two sentences: what the note is, for the top of the lens strip. */
  summary?: string;
  generatedAt: string;
}

export function emptySignals(): NoteSignals {
  return {
    series: [],
    tables: [],
    dated: [],
    checklist: [],
    facts: [],
    metrics: [],
    outline: [],
    suggestions: [],
  };
}
