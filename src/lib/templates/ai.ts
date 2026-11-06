/**
 * Asking a model to draft a template. Pure: prompt builders and an answer
 * reader. The route makes the call (fast slot, the user's own key).
 *
 * The model proposes *structure* as JSON (name, title pattern, sections). It
 * never writes the HTML: `sectionsToHtml` renders the sections with every
 * string escaped. Which notes form a series is decided by the rules in
 * `series.ts`, not by the model.
 */

import { normalizeSections, plainForPrompt, sectionsToHtml } from "./content";
import type { TemplateDraft, TemplateSource } from "./types";
import { MAX_TEMPLATE_DESCRIPTION, MAX_TEMPLATE_NAME, MAX_TEMPLATE_TITLE } from "./types";

export const MAX_SAMPLE_NOTES = 8;
const SAMPLE_CHARS = 2500;
const TOTAL_CHARS = 16_000;

export const DRAFT_SYSTEM = `You design reusable note templates for a personal knowledge app.

A template is the skeleton a person fills in each time: section headings in a sensible order, a short hint under each saying what belongs there, and standing items only where they truly recur (a fixed agenda item, a checklist that is the same every time).

Rules:
- Keep it lean: 3 to 10 sections. No filler sections.
- Never copy one-off specifics (names of one week's topics, figures, decisions) into the template. Standing items that appear every time are fine.
- "kind" is "text" for prose, "list" for bullet points, "checklist" for action items or things to tick off.
- "title_pattern" may use {{date}}, {{date_long}}, {{weekday}}, {{week}}, {{month}}, {{year}} or {{project}}. Use {{date}} for anything that recurs on a date.
- Write in the same language as the material you are given.

Reply with JSON only:
{"name": string, "description": string, "title_pattern": string, "rationale": string,
 "sections": [{"heading": string, "hint": string, "kind": "text"|"list"|"checklist", "items": string[]}]}

"rationale" is one or two plain sentences on why the template is shaped this way.`;

/** Escape what goes inside a fenced block so a note cannot close the fence. */
function fence(text: string): string {
  return text.replace(/<\/?(note|notes|request|project)\b[^>]*>/gi, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
}

export function buildDescriptionPrompt(description: string, projectName?: string | null): string {
  return [
    projectName ? `The template is for the project “${fence(projectName)}”.` : "",
    "Design a template for this:",
    `<request>\n${fence(description.slice(0, 2000))}\n</request>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface SampleNote {
  id: string;
  title: string;
  content: string;
  created_at?: string;
}

export function buildNotesPrompt(
  notes: SampleNote[],
  options: { projectName?: string | null; sharedHeadings?: string[]; instructions?: string } = {}
): string {
  let budget = TOTAL_CHARS;
  const blocks: string[] = [];
  for (const note of notes.slice(0, MAX_SAMPLE_NOTES)) {
    if (budget <= 200) break;
    const body = plainForPrompt(note.content, Math.min(SAMPLE_CHARS, budget));
    budget -= body.length;
    const when = note.created_at ? ` written="${note.created_at.slice(0, 10)}"` : "";
    blocks.push(`<note title="${fence(note.title).replace(/"/g, "'")}"${when}>\n${fence(body)}\n</note>`);
  }
  return [
    options.projectName ? `These notes are from the project “${fence(options.projectName)}”.` : "",
    `Here are ${blocks.length} notes the person wrote that are the same kind of note. Design the template they would have wanted to start each one from: keep the structure they actually use, in the order they use it, and add what is clearly missing only if it is obvious.`,
    options.sharedHeadings?.length
      ? `Headings that recur across these notes: ${options.sharedHeadings.map(fence).join("; ")}.`
      : "",
    options.instructions ? `The person adds: ${fence(options.instructions.slice(0, 500))}` : "",
    `<notes>\n${blocks.join("\n\n")}\n</notes>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Read a model answer into a draft, or null when it has nothing usable. */
export function readDraftAnswer(
  raw: unknown,
  context: { source: TemplateSource; sourceNoteIds?: string[]; fallbackName?: string }
): TemplateDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sections = normalizeSections(r.sections);
  if (!sections.length) return null;
  const name = str(r.name, MAX_TEMPLATE_NAME) || context.fallbackName?.slice(0, MAX_TEMPLATE_NAME) || "New template";
  // A title pattern is a title, not markup.
  const title_pattern = str(r.title_pattern, MAX_TEMPLATE_TITLE).replace(/[<>]/g, "") || `${name} {{date}}`;
  return {
    name,
    description: str(r.description, MAX_TEMPLATE_DESCRIPTION),
    title_pattern,
    sections,
    content: sectionsToHtml(sections),
    rationale: str(r.rationale, 400),
    source: context.source,
    source_note_ids: context.sourceNoteIds ?? [],
  };
}

/**
 * A template from the headings a series shares, with no model. Offered beside
 * the AI draft, and the honest answer when no AI is configured.
 */
export function draftFromHeadings(input: {
  label: string;
  title_pattern: string;
  headings: string[];
  noteIds: string[];
}): TemplateDraft | null {
  const sections = normalizeSections(input.headings.map((heading) => ({ heading, kind: "text" })));
  if (!sections.length) return null;
  return {
    name: input.label.slice(0, MAX_TEMPLATE_NAME),
    description: `The headings your “${input.label}” notes share.`.slice(0, MAX_TEMPLATE_DESCRIPTION),
    title_pattern: input.title_pattern,
    sections,
    content: sectionsToHtml(sections),
    rationale: `Built from the ${sections.length} heading${sections.length === 1 ? "" : "s"} that appear in at least half of these notes.`,
    source: "series",
    source_note_ids: input.noteIds,
  };
}
