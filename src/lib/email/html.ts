/**
 * Escaping for HTML that leaves the app by email.
 *
 * Task titles, note titles, project names and AI output are all interpolated
 * into email bodies. None of it is trusted: a title containing `<a href=…>`
 * used to render as a live link inside an email that looks like it came from
 * this app. Everything user- or model-authored goes through `escapeHtml`.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Escape, then keep line breaks visible. */
export function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Trim to `max` characters on a word boundary, with an ellipsis. */
export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Only http(s) URLs are ever placed in an href. */
export function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : "#";
}
