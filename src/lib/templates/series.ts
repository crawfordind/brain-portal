/**
 * Finding recurring notes: "Ops meeting 2026-10-06", "Ops meeting 10/13",
 * "Ops Meeting – Oct 20" are one series. Pure and rule-based: the rules decide
 * which notes belong together and why; a model is only asked, afterwards and
 * on request, to draft a template from them (see `ai.ts`).
 */

import { extractHeadings, headingKey } from "./content";
import type { Cadence, SeriesSuggestion } from "./types";

export interface SeriesNote {
  id: string;
  title: string;
  content: string;
  project_id: string | null;
  created_at: string;
}

export interface TemplateRef {
  name: string;
  title_pattern: string;
  project_id: string | null;
}

/** Fewest notes that make a series on title alone. */
export const MIN_SERIES = 3;
/** Two notes count when they also share this many headings. */
export const MIN_HEADINGS_FOR_PAIR = 3;

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAYS = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";

/** Every date-ish or counter-ish fragment a recurring title varies by. */
const VARYING: RegExp[] = [
  /\{\{[^}]*\}\}/g,
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
  /\b\d{1,2}[-/.]\d{1,2}(?:[-/.]\d{2,4})?\b/g,
  new RegExp(`\\b(?:${MONTHS})\\.?(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b(?:${WEEKDAYS})\\b\\.?`, "gi"),
  /\b(?:week|wk|w|sprint|q|quarter|no|number|issue|ep|episode)\s*\.?\s*#?\s*\d+\b/gi,
  /#\s*\d+\b/g,
  /\b\d+\b/g,
];

function stripVarying(title: string): string {
  let out = title;
  for (const re of VARYING) out = out.replace(re, " ");
  return out;
}

/** A title's identity once dates and counters are gone. */
export function titleStem(title: string): string {
  return stripVarying(title || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A readable name from a title, dates removed, original casing kept. */
export function seriesLabel(title: string): string {
  return stripVarying(title || "")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\s*[-–—:|,/]\s*){2,}/g, " – ")
    .replace(/^[\s\-–—:|,/]+|[\s\-–—:|,/]+$/g, "")
    .trim();
}

function hadVaryingPart(title: string): boolean {
  return titleStem(title) !== (title || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** SQLite's `datetime('now')` has no zone marker and is UTC. */
function parseTimestamp(value: string): number {
  if (!value) return NaN;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(iso);
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How often the notes were written, from the median gap between them. */
export function detectCadence(timestamps: string[]): Cadence {
  const times = timestamps.map(parseTimestamp).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length < 2) return "irregular";
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86_400_000);
  const m = median(gaps);
  if (m <= 1.5) return "daily";
  if (m >= 5 && m <= 9) return "weekly";
  if (m >= 12 && m <= 16) return "biweekly";
  if (m >= 26 && m <= 35) return "monthly";
  return "irregular";
}

/** Headings found in at least half of the notes, ordered as they usually appear. */
export function sharedHeadings(contents: string[]): string[] {
  if (!contents.length) return [];
  const threshold = Math.max(2, Math.ceil(contents.length / 2));
  const stats = new Map<string, { label: string; count: number; positions: number[] }>();
  for (const content of contents) {
    const headings = extractHeadings(content);
    headings.forEach((h, i) => {
      const key = headingKey(h);
      const entry = stats.get(key) ?? { label: h, count: 0, positions: [] };
      entry.count += 1;
      entry.positions.push(headings.length > 1 ? i / (headings.length - 1) : 0);
      stats.set(key, entry);
    });
  }
  return [...stats.values()]
    .filter((s) => s.count >= threshold)
    .sort((a, b) => median(a.positions) - median(b.positions))
    .map((s) => s.label);
}

const CADENCE_WORDS: Record<Cadence, string> = {
  daily: "about daily",
  weekly: "about weekly",
  biweekly: "about every two weeks",
  monthly: "about monthly",
  irregular: "",
};

function templateStems(templates: TemplateRef[]): Set<string> {
  const stems = new Set<string>();
  for (const t of templates) {
    const a = titleStem(t.name);
    const b = titleStem(t.title_pattern);
    if (a) stems.add(a);
    if (b) stems.add(b);
  }
  return stems;
}

/**
 * Group notes into recurring series. Newest note first within a series;
 * strongest series first overall, with ones a template already covers last.
 */
export function findSeries(notes: SeriesNote[], templates: TemplateRef[] = []): SeriesSuggestion[] {
  const groups = new Map<string, SeriesNote[]>();
  for (const note of notes) {
    const stem = titleStem(note.title);
    if (!stem) continue;
    const key = `${note.project_id ?? ""}::${stem}`;
    const list = groups.get(key) ?? [];
    list.push(note);
    groups.set(key, list);
  }

  const covered = templateStems(templates);
  const out: SeriesSuggestion[] = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at));
    const shared = sharedHeadings(members.map((m) => m.content));
    if (members.length < MIN_SERIES && shared.length < MIN_HEADINGS_FOR_PAIR) continue;

    const stem = key.split("::")[1];
    const label = seriesLabel(members[0].title) || members[0].title.trim();
    const dated = members.filter((m) => hadVaryingPart(m.title)).length;
    const cadence = detectCadence(members.map((m) => m.created_at));
    const title_pattern = dated * 2 >= members.length ? `${label} {{date}}` : label;
    const has_template = covered.has(stem);

    const reasons = [`${members.length} notes titled like “${label}”`];
    if (cadence !== "irregular") reasons.push(`Written ${CADENCE_WORDS[cadence]}`);
    if (shared.length) {
      const shown = shared.slice(0, 5).join(", ");
      reasons.push(`${shared.length} heading${shared.length === 1 ? "" : "s"} repeat across them: ${shown}${shared.length > 5 ? "…" : ""}`);
    }
    if (has_template) reasons.push("A template with this name already exists");

    const score =
      members.length * 2 + (cadence !== "irregular" ? 3 : 0) + Math.min(shared.length, 8) - (has_template ? 100 : 0);

    out.push({
      key: stem,
      label,
      project_id: members[0].project_id,
      note_ids: members.map((m) => m.id),
      titles: members.map((m) => m.title),
      count: members.length,
      cadence,
      shared_headings: shared,
      title_pattern,
      reasons,
      has_template,
      score,
    });
  }

  return out.sort((a, b) => b.score - a.score || b.count - a.count || a.label.localeCompare(b.label));
}
