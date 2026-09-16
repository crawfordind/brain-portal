/**
 * Normalizing a Web Share payload.
 *
 * The Web Share Target spec gives a target three fields — `title`, `text`,
 * `url` — and Android apps disagree wildly about which one carries what:
 *
 *   Chrome            → url: "https://…",  title: "Page title"
 *   Twitter / Reddit  → text: "Some title https://t.co/…",  url: ""
 *   Most note apps    → text: "the copied text",  url: ""
 *   Some share sheets → text: "https://…"  (the URL and nothing else)
 *
 * If we trusted `url` alone, sharing a link from half the apps on the phone
 * would silently save a "thought" containing a raw URL string. So this module
 * normalizes all three into one shape, and it is pure so the ambiguity can be
 * pinned down in tests rather than discovered on a phone.
 */

/** Anything longer than this is almost certainly a paste, not a share. */
const MAX_CONTENT_LENGTH = 20000;
const MAX_TITLE_LENGTH = 200;

export interface SharedInput {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

export interface ParsedShare {
  /** What the user is really sharing. */
  kind: "link" | "text";
  /** The URL, when one could be found in any field. */
  url: string | null;
  /** A human title — page title, first line of text, or the URL's host. */
  title: string;
  /** Everything the user shared that isn't the title or the bare URL. */
  body: string;
  /** Ready-to-save content, with nothing duplicated. */
  content: string;
  /** The capture_type to use if this is saved as a capture. */
  captureType: "link" | "thought";
  /** True when the share carried nothing usable. */
  isEmpty: boolean;
}

/** Trailing punctuation that gets swept up by a greedy URL match. */
const TRAILING_JUNK = /[.,;:!?)\]}'"»›]+$/;

function clean(value: string | null | undefined): string {
  return (value || "").trim();
}

/**
 * `isValidUrl` from utils is deliberately not reused here: this module must stay
 * pure and dependency-light so it runs identically in the browser, in the route
 * handler, and in tests. `URL` is available in all three.
 */
function isHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** First http(s) URL in a string, with trailing sentence punctuation trimmed. */
export function findUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  const candidate = match[0].replace(TRAILING_JUNK, "");
  return isHttpUrl(candidate) ? candidate : null;
}

/** Host without "www.", for use as a fallback title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function parseSharedPayload(input: SharedInput): ParsedShare {
  const rawTitle = clean(input.title);
  const rawText = clean(input.text);
  const rawUrl = clean(input.url);

  // Field precedence: an explicit `url` wins, then a URL embedded in the shared
  // text, then one embedded in the title.
  const url =
    (isHttpUrl(rawUrl) ? rawUrl : null) ??
    findUrl(rawText) ??
    findUrl(rawTitle);

  // Remove the URL from the free text so it isn't stored twice. Apps that share
  // "Title https://…" leave a useful title behind; apps that share the bare URL
  // leave nothing, which is correct.
  let body = rawText;
  if (url && body.includes(url)) {
    body = body.replace(url, "").trim();
  }

  let title = rawTitle;
  if (url && title === url) title = "";
  if (title && url && title.includes(url)) {
    title = title.replace(url, "").trim();
  }

  // No title from the sharing app? Promote the first line of the shared text —
  // which is exactly where apps like Twitter put it. When a line is promoted it
  // is removed from the body, or it would be stored twice.
  if (!title && body) {
    const [firstLine, ...rest] = body.split("\n");
    const remainder = rest.join("\n").trim();

    if (remainder) {
      // Multi-line: the first line reads as a heading.
      title = firstLine.trim();
      body = remainder;
    } else if (url) {
      // One line plus a link: that line is the link's title.
      title = truncate(firstLine.trim(), MAX_TITLE_LENGTH);
      body = "";
    }
    // One line and no link: it is the content, not a title. Leave both alone.
  }

  // Still nothing, but we have a link: name it after its host.
  if (!title && url) title = hostOf(url);

  title = truncate(title, MAX_TITLE_LENGTH);

  const kind: "link" | "text" = url ? "link" : "text";

  // Assemble content without repeating anything. Order: title, body, url —
  // which reads correctly both as a capture and as note content.
  const parts: string[] = [];
  if (title) parts.push(title);
  if (body && body !== title) parts.push(body);
  if (url) parts.push(url);

  const content = truncate(parts.join("\n\n").trim(), MAX_CONTENT_LENGTH);

  return {
    kind,
    url,
    title,
    body: truncate(body, MAX_CONTENT_LENGTH),
    content,
    captureType: url ? "link" : "thought",
    isEmpty: content.length === 0,
  };
}

/**
 * Build a shared payload from a URLSearchParams, tolerating the parameter names
 * used by the manifest as well as the shorter ones a hand-written iOS Shortcut
 * or bookmarklet is likely to send.
 */
export function sharedInputFromParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>
): SharedInput {
  const get = (key: string): string => {
    if (params instanceof URLSearchParams) return params.get(key) || "";
    const value = params[key];
    if (Array.isArray(value)) return value[0] || "";
    return value || "";
  };

  return {
    title: get("title") || get("name") || get("subject"),
    text: get("text") || get("body") || get("content") || get("q"),
    url: get("url") || get("link") || get("href"),
  };
}
