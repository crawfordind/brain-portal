/**
 * Preparing a note body for someone other than its owner.
 *
 * Highlights are instructions to the owner's AI ("cut this", "I disagree"),
 * and each one can carry a private comment in `data-note`. Neither belongs on
 * a public page, so annotation marks are unwrapped to their text before the
 * HTML is sanitized. A plain `<mark>` the owner used as an ordinary highlight
 * is kept.
 *
 * Notes written over MCP are markdown, not editor HTML; they are converted so
 * a public link shows formatted text rather than raw `#` and `**`.
 */

import { smartConvertToHtml } from "@/lib/markdown/utils";

const ANNOTATION_MARK =
  /<mark\b(?=[^>]*(?:\bdata-intent\s*=|\bbp-annotation\b))[^>]*>([\s\S]*?)<\/mark>/gi;

/** Remove semantic-highlight marks (and their private comments), keeping the text. */
export function stripAnnotations(html: string): string {
  let previous: string;
  let current = html;
  // Repeat so a mark the editor split around another one is fully unwrapped.
  do {
    previous = current;
    current = current.replace(ANNOTATION_MARK, "$1");
  } while (current !== previous);
  return current;
}

/** Body HTML ready for a sanitizer: markdown rendered, annotations removed. */
export function prepareSharedHtml(content: string | null | undefined): string {
  if (!content) return "";
  return stripAnnotations(smartConvertToHtml(content));
}

/** A one-line description for link previews, from plain text. */
export function sharedExcerpt(plain: string | null | undefined, max = 160): string {
  const text = (plain ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
