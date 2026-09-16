/**
 * Reading semantic highlights back out of note HTML.
 *
 * Note bodies are stored as HTML, and `content_plain` (what the agents
 * normally see) has every tag stripped — so by the time a note reaches a
 * prompt, the user's highlights are gone. These helpers parse the annotations
 * out of the raw HTML and turn them into an explicit block of instructions the
 * model can act on.
 *
 * Deliberately regex-based rather than DOM-based: this runs on the server, in
 * the Node route handlers and the agent executor, where there is no `document`.
 */

import {
  ANNOTATION_INTENTS,
  type AnnotationIntent,
  type AnnotationIntentId,
  getAnnotationIntent,
} from "./intents";

export interface Annotation {
  intent: AnnotationIntentId;
  /** The highlighted passage, as plain text. */
  text: string;
  /** Optional note the user attached to this specific highlight. */
  comment?: string;
}

const MARK_TAG = /<mark\b([^>]*)>([\s\S]*?)<\/mark>/gi;
const INTENT_ATTR = /\bdata-intent\s*=\s*["']?\s*([a-z-]+)/i;
const INTENT_CLASS = /\bbp-annotation-([a-z-]+)/i;
const COMMENT_ATTR = /\bdata-note\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Inner HTML of a highlight → the plain passage the user actually marked. */
function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Highlights can be split across inline marks; cap what reaches the prompt. */
const MAX_PASSAGE_CHARS = 600;
const MAX_ANNOTATIONS = 40;

function truncatePassage(text: string): string {
  if (text.length <= MAX_PASSAGE_CHARS) return text;
  return `${text.slice(0, MAX_PASSAGE_CHARS).trimEnd()}…`;
}

/**
 * Pull every semantically-highlighted passage out of note HTML, in document
 * order. Plain `<mark>` tags with no recognised intent are ignored — they are
 * decoration, not instruction.
 */
export function extractAnnotations(html: string | null | undefined): Annotation[] {
  if (!html || !html.includes("<mark")) return [];

  const annotations: Annotation[] = [];
  // Contiguous marks that TipTap split across inline nodes read as one thought;
  // merging them keeps the quoted passage whole for the model.
  let previous: { annotation: Annotation; end: number } | null = null;

  MARK_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARK_TAG.exec(html)) !== null) {
    const [full, attrs, inner] = match;
    const intent = getAnnotationIntent(
      attrs.match(INTENT_ATTR)?.[1] ?? attrs.match(INTENT_CLASS)?.[1]
    );
    if (!intent) {
      previous = null;
      continue;
    }

    const text = toPlainText(inner);
    if (!text) {
      previous = null;
      continue;
    }

    const commentMatch = attrs.match(COMMENT_ATTR);
    const comment = decodeEntities(commentMatch?.[1] ?? commentMatch?.[2] ?? "").trim();

    const adjacent =
      previous &&
      previous.annotation.intent === intent.id &&
      previous.annotation.comment === (comment || undefined) &&
      html.slice(previous.end, match.index).trim() === "";

    if (adjacent && previous) {
      previous.annotation.text = `${previous.annotation.text} ${text}`.trim();
      previous.end = match.index + full.length;
      continue;
    }

    const annotation: Annotation = { intent: intent.id, text };
    if (comment) annotation.comment = comment;
    annotations.push(annotation);
    previous = { annotation, end: match.index + full.length };

    if (annotations.length >= MAX_ANNOTATIONS) break;
  }

  return annotations.map((a) => ({ ...a, text: truncatePassage(a.text) }));
}

export function hasAnnotations(html: string | null | undefined): boolean {
  return extractAnnotations(html).length > 0;
}

/** Counts per intent, in palette order, omitting intents that weren't used. */
export function summarizeAnnotations(
  annotations: Annotation[]
): Array<{ intent: AnnotationIntent; count: number }> {
  const counts = new Map<AnnotationIntentId, number>();
  for (const annotation of annotations) {
    counts.set(annotation.intent, (counts.get(annotation.intent) ?? 0) + 1);
  }
  return ANNOTATION_INTENTS.filter((intent) => counts.has(intent.id)).map((intent) => ({
    intent,
    count: counts.get(intent.id)!,
  }));
}

/**
 * Render the annotations as a prompt block.
 *
 * Only the intents the user actually used are explained — a legend of seven
 * colours when the user highlighted two passages is noise that competes with
 * the instructions that matter. Returns "" when there is nothing to say, so
 * callers can concatenate unconditionally.
 */
export function formatAnnotationsForPrompt(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";

  const used = summarizeAnnotations(annotations);

  const legend = used
    .map(({ intent }) => `- ${intent.id.toUpperCase()} — ${intent.directive}`)
    .join("\n");

  const items = annotations
    .map((annotation, index) => {
      const lines = [`${index + 1}. [${annotation.intent.toUpperCase()}] "${annotation.text}"`];
      if (annotation.comment) lines.push(`   User's note on this passage: ${annotation.comment}`);
      return lines.join("\n");
    })
    .join("\n");

  return `The user marked up the content with coloured highlights. Each highlight is a
direct instruction about that specific passage — treat it as if the user had
written the request out longhand.

What each marking means:
${legend}

Marked passages, in order:
${items}

Address every marked passage explicitly, quoting enough of it that the user can
tell which one you mean. Where markings conflict with the general instructions,
the markings win — they are the user's most specific statement of what they want.`;
}

/**
 * Convenience wrapper: raw note HTML → prompt block (or "").
 */
export function buildAnnotationPromptSection(html: string | null | undefined): string {
  return formatAnnotationsForPrompt(extractAnnotations(html));
}
