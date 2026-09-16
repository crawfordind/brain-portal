/**
 * Semantic highlight annotations.
 *
 * A highlight colour is not decoration here — it is an instruction. The user
 * highlights a passage in a note and the colour says what they want done with
 * it ("expand this", "cut this", "I like this, keep it"). Every LLM that later
 * reads the note is handed the same meanings, so the user gets a review that
 * responds to their markup without writing a single sentence of instruction.
 *
 * This module is the single source of truth for that vocabulary and is pure —
 * it is imported by the editor (browser), the sanitizer, and the agent prompt
 * builder (server) alike.
 */

export type AnnotationIntentId =
  | "approve"
  | "edit"
  | "expand"
  | "condense"
  | "cut"
  | "verify"
  | "question";

export interface AnnotationIntent {
  id: AnnotationIntentId;
  /** Short name shown on the highlight menu. */
  label: string;
  /** What the colour means, in the user's words. Shown in the picker. */
  meaning: string;
  /** Instruction handed to the reviewing model for every passage marked this way. */
  directive: string;
  /** Swatch colour for menus. Matches the mark background in globals.css. */
  swatch: string;
  /** Editor keyboard shortcut, also shown in the picker. */
  shortcut: string;
}

/**
 * Ordered so the picker reads roughly positive → negative, which is what makes
 * the palette guessable without reading the labels.
 */
export const ANNOTATION_INTENTS: readonly AnnotationIntent[] = [
  {
    id: "approve",
    label: "Approve",
    meaning: "I like this — keep it as is",
    directive:
      "The user approves of this passage. Keep it intact: do not rewrite, reword, or restructure it. Preserve its wording and voice in anything you produce, and treat it as a model for the rest.",
    swatch: "#22c55e",
    shortcut: "Mod-Alt-1",
  },
  {
    id: "edit",
    label: "Edit",
    meaning: "Rework this — it's not right yet",
    directive:
      "The user wants this passage reworked. Rewrite it for clarity, wording, and flow while keeping the underlying point. Show the replacement text.",
    swatch: "#eab308",
    shortcut: "Mod-Alt-2",
  },
  {
    id: "expand",
    label: "Expand",
    meaning: "Say more here — go deeper",
    directive:
      "The user wants more here. Develop this passage further with added depth, detail, examples, or supporting reasoning. Do not merely restate it.",
    swatch: "#3b82f6",
    shortcut: "Mod-Alt-3",
  },
  {
    id: "condense",
    label: "Condense",
    meaning: "Too long — tighten it up",
    directive:
      "The user finds this passage too long. Tighten it: same substance, fewer words. Show the shortened version.",
    swatch: "#a855f7",
    shortcut: "Mod-Alt-4",
  },
  {
    id: "cut",
    label: "Cut",
    meaning: "Remove this — or I disagree with it",
    directive:
      "The user wants this passage removed, or disagrees with it. Recommend cutting it, explain briefly why it does not belong, and say what (if anything) should take its place.",
    swatch: "#ef4444",
    shortcut: "Mod-Alt-5",
  },
  {
    id: "verify",
    label: "Verify",
    meaning: "Check this — I'm not sure it's right",
    directive:
      "The user is unsure this passage is correct. Fact-check the claim, state how confident you are, and flag anything wrong, outdated, or unsupported. Do not assert certainty you do not have.",
    swatch: "#f97316",
    shortcut: "Mod-Alt-6",
  },
  {
    id: "question",
    label: "Question",
    meaning: "I don't follow this — explain it",
    directive:
      "The user does not follow this passage. Explain it plainly, resolve the ambiguity, or answer the implicit question behind the highlight.",
    swatch: "#ec4899",
    shortcut: "Mod-Alt-7",
  },
] as const;

const INTENTS_BY_ID = new Map<string, AnnotationIntent>(
  ANNOTATION_INTENTS.map((intent) => [intent.id, intent])
);

export function getAnnotationIntent(id: string | null | undefined): AnnotationIntent | null {
  if (!id) return null;
  return INTENTS_BY_ID.get(id.trim().toLowerCase()) ?? null;
}

export function isAnnotationIntentId(id: string | null | undefined): id is AnnotationIntentId {
  return getAnnotationIntent(id) !== null;
}

/** CSS class applied alongside `data-intent`, so a sanitizer that drops data
 *  attributes still leaves the colour (and the meaning) intact. */
export function annotationClass(intent: AnnotationIntentId): string {
  return `bp-annotation bp-annotation-${intent}`;
}
