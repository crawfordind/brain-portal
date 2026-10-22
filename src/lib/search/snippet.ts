/**
 * Search result previews: readable text with the matched words marked.
 *
 * Imports nothing, so the search route and the browser share it.
 *
 * Notes are stored as TipTap HTML (or markdown, when an MCP client wrote
 * them), and `content_plain` only has its tags removed: entities such as
 * `&amp;` and markdown syntax survive. The dropdown used to print
 * `notes.content` as-is, so a result read `<p><strong>Plan</strong>...`.
 *
 * Highlights travel as two control characters rather than `<mark>` tags.
 * A note that literally contains `<mark>` (or `<img onerror=...>`) is then
 * just text, and the client renders segments with React instead of
 * `dangerouslySetInnerHTML`.
 */

/** Start of a highlighted run. Passed to FTS5's `snippet()` as well. */
export const HIGHLIGHT_START = "\u0002";
/** End of a highlighted run. */
export const HIGHLIGHT_END = "\u0003";
/** FTS5 `snippet()` ellipsis; kept identical to ours so both read the same. */
export const ELLIPSIS = "…";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
};

const BLOCK_TAGS =
  "p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|pre|section|article|figure|figcaption|hr";

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      // Never let an entity forge one of our highlight markers.
      if (code === 2 || code === 3) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Turns note HTML, markdown, or text that was once one of those into a single
 * line of readable text. Highlight markers already in the input are kept.
 */
export function toSearchText(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw;

  // HTML: drop invisible elements, turn block boundaries into spaces, drop tags.
  text = text
    .replace(/<(script|style|head|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    // A window cut through a tag leaves "<span class=" at the end.
    .replace(/<[a-z/][^>]*$/i, "");

  text = decodeEntities(text);

  // Markdown: keep the words, lose the syntax.
  text = text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/==\[[a-z]+\]\s*/gi, "")
    .replace(/==/g, "")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/(^|\n)\s*>\s?/g, "$1")
    .replace(/(^|\n)\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/g, "$1")
    .replace(/(^|\n)\s*(?:-{3,}|\*{3,}|_{3,})\s*(?=\n|$)/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1");

  return text.replace(/\s+/g, " ").trim();
}

/**
 * The words of a search query, as the user meant them: quotes, FTS operators
 * and stray punctuation removed, longest first so "plans" is marked before
 * "plan" can split it.
 */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of query.split(/\s+/)) {
    const term = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!term || /^(AND|OR|NOT|NEAR)$/.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.sort((a, b) => b.length - a.length);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(terms.map(escapeRegExp).join("|"), "giu");
}

/** Wraps every occurrence of a term in highlight markers. */
export function highlightTerms(text: string, terms: string[]): string {
  const pattern = termPattern(terms);
  if (!pattern) return text;
  return text.replace(pattern, (m) => `${HIGHLIGHT_START}${m}${HIGHLIGHT_END}`);
}

/**
 * A window of `text` around the first match, cut on word boundaries, with the
 * terms marked. No match means the opening of the text.
 */
export function buildSnippet(text: string, terms: string[], maxLength = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const pattern = termPattern(terms);
  const first = pattern ? clean.search(pattern) : -1;

  let start = 0;
  if (first > 0 && clean.length > maxLength) {
    // Lead in with a little context so the match is not the first word.
    start = Math.max(0, Math.min(first - Math.floor(maxLength / 4), clean.length - maxLength));
    if (start > 0) {
      const space = clean.indexOf(" ", start);
      start = space !== -1 && space < first ? space + 1 : start;
    }
  }

  let end = Math.min(clean.length, start + maxLength);
  if (end < clean.length) {
    const space = clean.lastIndexOf(" ", end);
    if (space > start + maxLength / 2) end = space;
  }

  let window = clean.slice(start, end).trim();
  window = highlightTerms(window, terms);
  return `${start > 0 ? ELLIPSIS : ""}${window}${end < clean.length ? ELLIPSIS : ""}`;
}

/**
 * Cleans an FTS5 `snippet()` result, which is cut from `content_plain` and so
 * may still carry entities and markdown. Unbalanced markers are repaired.
 */
export function cleanFtsSnippet(snippet: string | null | undefined): string {
  const text = toSearchText(snippet);
  return parseSnippet(text)
    .map((s) => (s.highlight ? `${HIGHLIGHT_START}${s.text}${HIGHLIGHT_END}` : s.text))
    .join("");
}

/** True when the snippet marks at least one match. */
export function hasHighlight(snippet: string): boolean {
  return snippet.includes(HIGHLIGHT_START);
}

/** Removes highlight markers, leaving plain text. */
export function stripHighlights(snippet: string): string {
  return snippet.split(HIGHLIGHT_START).join("").split(HIGHLIGHT_END).join("");
}

export interface SnippetSegment {
  text: string;
  highlight: boolean;
}

/**
 * Splits a marked snippet into plain and highlighted runs for rendering.
 * Tolerates unbalanced or nested markers rather than trusting the input.
 */
export function parseSnippet(snippet: string | null | undefined): SnippetSegment[] {
  if (!snippet) return [];
  const segments: SnippetSegment[] = [];
  let highlight = false;
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    const last = segments[segments.length - 1];
    if (last && last.highlight === highlight) last.text += buffer;
    else segments.push({ text: buffer, highlight });
    buffer = "";
  };

  for (const ch of snippet) {
    if (ch === HIGHLIGHT_START || ch === HIGHLIGHT_END) {
      flush();
      highlight = ch === HIGHLIGHT_START;
    } else {
      buffer += ch;
    }
  }
  flush();
  return segments;
}
