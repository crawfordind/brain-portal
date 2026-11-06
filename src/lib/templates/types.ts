/**
 * Note templates: shared shapes. Imports nothing, so the browser, the API
 * routes and the MCP server can all use it (same reasoning as
 * `chat/item-types.ts`).
 */

/** How a template came to exist. */
export type TemplateSource = "manual" | "note" | "ai_description" | "ai_notes" | "series";

export interface NoteTemplate {
  id: string;
  user_id: string;
  project_id: string | null;
  project_name?: string | null;
  name: string;
  description: string;
  /** Title for a new note, with variables, e.g. "Operations meeting {{date}}". */
  title_pattern: string;
  /** Body, HTML or markdown, with variables. */
  content: string;
  source: TemplateSource;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SectionKind = "text" | "list" | "checklist";

/** One block of a structured template: what the model proposes, and what the rules derive. */
export interface TemplateSection {
  heading: string;
  /** A one-line prompt for what goes here. Shown as placeholder text. */
  hint: string;
  kind: SectionKind;
  /** Starter list or checklist items (e.g. standing agenda items). */
  items: string[];
}

/** A proposed template, not yet saved. The user reviews and saves it. */
export interface TemplateDraft {
  name: string;
  description: string;
  title_pattern: string;
  sections: TemplateSection[];
  /** Rendered from `sections`; what the editor shows. */
  content: string;
  /** Why this draft looks the way it does, in one or two sentences. */
  rationale: string;
  source: TemplateSource;
  /** The notes the draft was read from. */
  source_note_ids: string[];
}

export type Cadence = "daily" | "weekly" | "biweekly" | "monthly" | "irregular";

/** A run of notes in a project that look like the same kind of note, written repeatedly. */
export interface SeriesSuggestion {
  /** Normalised title stem; the series' identity. */
  key: string;
  /** Human name, from the most recent title with dates stripped. */
  label: string;
  project_id: string | null;
  note_ids: string[];
  titles: string[];
  count: number;
  cadence: Cadence;
  /** Headings that appear in at least half of the notes, in order. */
  shared_headings: string[];
  /** Proposed title pattern, e.g. "Operations meeting {{date}}". */
  title_pattern: string;
  /** Plain-language reasons this looks like a series. */
  reasons: string[];
  /** True when a saved template already covers it. */
  has_template: boolean;
  score: number;
}

/** Variables a template may contain, for help text and the picker. */
export const TEMPLATE_VARIABLES: ReadonlyArray<{ token: string; meaning: string }> = [
  { token: "{{date}}", meaning: "Today, e.g. 2026-11-03" },
  { token: "{{date_long}}", meaning: "Today in words, e.g. Tuesday, November 3, 2026" },
  { token: "{{date+7}}", meaning: "A date relative to today (any number of days, + or -)" },
  { token: "{{weekday}}", meaning: "Day of the week" },
  { token: "{{time}}", meaning: "Current time, e.g. 09:30" },
  { token: "{{week}}", meaning: "ISO week number" },
  { token: "{{month}}", meaning: "Month name" },
  { token: "{{year}}", meaning: "Year" },
  { token: "{{project}}", meaning: "The note's project name" },
];

export const MAX_TEMPLATE_NAME = 120;
export const MAX_TEMPLATE_DESCRIPTION = 500;
export const MAX_TEMPLATE_TITLE = 200;
export const MAX_TEMPLATE_CONTENT = 100_000;
export const MAX_SECTIONS = 20;
export const MAX_SECTION_ITEMS = 15;
