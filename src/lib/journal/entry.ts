/**
 * Journal entries: the pure rules shared by every path that writes one.
 *
 * Imports nothing, so the API routes, the stream and the browser agree on what
 * a valid entry is, and the rules can be unit-tested without a database.
 */

/** Mirrors the `journal_entries.category` CHECK constraint. */
export const JOURNAL_CATEGORIES = [
  "general",
  "personal",
  "work",
  "health",
  "travel",
  "purchase",
  "project",
  "learning",
  "social",
  "maintenance",
] as const;

export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];

/** Generous for a journal entry, small enough to keep a day's note readable. */
export const MAX_ENTRY_CHARS = 20_000;
const MAX_TAGS = 10;
const MAX_TAG_CHARS = 40;
const MAX_MOOD_CHARS = 32;
const MAX_LOCATION_CHARS = 200;

/**
 * A category the CHECK constraint accepts. Anything else (a model's
 * "Gardening", a caller's typo) becomes "general" instead of failing the
 * insert after the note has already been written.
 */
export function normalizeCategory(value: unknown): JournalCategory {
  if (typeof value !== "string") return "general";
  const lower = value.trim().toLowerCase();
  return (JOURNAL_CATEGORIES as readonly string[]).includes(lower)
    ? (lower as JournalCategory)
    : "general";
}

export function normalizeMood(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_MOOD_CHARS);
  return trimmed || null;
}

export function normalizeLocation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_LOCATION_CHARS);
  return trimmed || null;
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_CHARS);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** A real calendar date in `YYYY-MM-DD` form ("2026-02-30" is not one). */
export function isValidJournalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/**
 * A client-chosen entry id, used as the row's primary key so a retried save
 * (the response was lost, the tab was closed mid-request) finds the entry it
 * already wrote instead of writing it twice.
 */
export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day `instant` falls on in `timeZone` (UTC if unknown). */
export function journalDay(instant: Date, timeZone?: string | null): string {
  if (timeZone && isValidTimeZone(timeZone)) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
  return instant.toISOString().slice(0, 10);
}

/**
 * "9:41 PM" in the writer's zone. The server runs in UTC, so formatting
 * without a zone stamped every evening entry with tomorrow-morning's time.
 */
export function formatEntryTime(instant: Date, timeZone?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (timeZone && isValidTimeZone(timeZone)) opts.timeZone = timeZone;
  else opts.timeZone = "UTC";
  return new Intl.DateTimeFormat("en-US", opts).format(instant);
}

/** "Thursday, October 22, 2026" for a `YYYY-MM-DD` date, independent of zone. */
export function formatJournalDateTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function journalNoteSlug(date: string): string {
  return `journal-${date}`;
}

/** The day's note before any entry is appended to it. */
export function journalNoteSeed(date: string): {
  title: string;
  slug: string;
  content: string;
} {
  const dateTitle = formatJournalDateTitle(date);
  return {
    title: `Journal - ${dateTitle}`,
    slug: journalNoteSlug(date),
    content: `# Journal - ${dateTitle}\n\n---\n`,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What to append to the day's note, in both dialects.
 *
 * The note starts as markdown, but once the user opens and edits it the editor
 * saves HTML. Appending markdown to HTML showed literal `###` in the note, so
 * the SQL picks one of these by looking at the stored content.
 */
export function buildEntryAppend(
  text: string,
  timeLabel: string
): { markdown: string; html: string; plain: string } {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return {
    markdown: `\n### ${timeLabel}\n${text}\n`,
    html: `<h3>${escapeHtml(timeLabel)}</h3>${paragraphs}`,
    plain: `\n${text}`,
  };
}

/** SQLite's CHECK failure, as libsql and Turso word it. */
export function isCheckConstraintError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /CHECK constraint failed/i.test(msg);
}

/** A UNIQUE or PRIMARY KEY collision. */
export function isUniqueConstraintError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /UNIQUE constraint failed|PRIMARY KEY/i.test(msg);
}

/**
 * Rule-based category, mood and tags. Free, instant and deterministic, so a
 * save never waits on (or fails because of) a model.
 */
export function categorizeEntry(entryText: string): {
  category: JournalCategory;
  tags: string[];
  mood: string | null;
  title: string;
} {
  const lower = entryText.toLowerCase();

  const categoryPatterns: Array<{ pattern: RegExp; category: JournalCategory }> = [
    { pattern: /\b(bought|purchased|ordered|paid|spent|cost|price|shopping)\b/, category: "purchase" },
    { pattern: /\b(visited|went to|traveled|trip|flew|drove to|road trip|vacation|hotel|airport)\b/, category: "travel" },
    { pattern: /\b(planted|gardened|watered|harvested|pruned|mowed|weeded|composted|fertilized)\b/, category: "maintenance" },
    { pattern: /\b(installed|fixed|repaired|replaced|upgraded|updated|maintained|cleaned|organized)\b/, category: "maintenance" },
    { pattern: /\b(cooked|ate|recipe|meal|breakfast|lunch|dinner|restaurant|cafe)\b/, category: "personal" },
    { pattern: /\b(workout|exercised|ran|jogged|gym|yoga|walked|hiked|swam|biked|weight|health|doctor|dentist|medicine)\b/, category: "health" },
    { pattern: /\b(learned|studied|read|course|tutorial|class|lecture|book|article|discovery)\b/, category: "learning" },
    { pattern: /\b(met with|meeting|call with|talked to|hung out|party|dinner with|coffee with|friends|family)\b/, category: "social" },
    { pattern: /\b(deployed|shipped|coded|built|debugged|released|merged|committed|sprint|standup)\b/, category: "work" },
    { pattern: /\b(project|milestone|launched|completed|finished|delivered)\b/, category: "project" },
  ];

  let category: JournalCategory = "general";
  for (const p of categoryPatterns) {
    if (p.pattern.test(lower)) {
      category = p.category;
      break;
    }
  }

  const moodPatterns: Array<{ pattern: RegExp; mood: string }> = [
    { pattern: /\b(amazing|wonderful|fantastic|excited|thrilled|overjoyed|ecstatic)\b/, mood: "great" },
    { pattern: /\b(good|happy|pleased|satisfied|nice|enjoyed|glad|cheerful)\b/, mood: "good" },
    { pattern: /\b(okay|fine|alright|decent|not bad)\b/, mood: "neutral" },
    { pattern: /\b(tired|stressed|frustrated|annoyed|difficult|tough|hard|exhausted)\b/, mood: "low" },
    { pattern: /\b(terrible|awful|horrible|angry|upset|sad|depressed|anxious)\b/, mood: "bad" },
  ];

  let mood: string | null = null;
  for (const p of moodPatterns) {
    if (p.pattern.test(lower)) {
      mood = p.mood;
      break;
    }
  }

  const tagPatterns = [
    /\b(garden(?:ing)?|plants?|flowers?|vegetables?|herbs?)\b/i,
    /\b(cooking|baking|recipe)\b/i,
    /\b(exercise|fitness|running|yoga|gym)\b/i,
    /\b(reading|books?|article)\b/i,
    /\b(coding|programming|development)\b/i,
    /\b(shopping|groceries)\b/i,
    /\b(travel|vacation|trip)\b/i,
    /\b(meeting|work|office)\b/i,
    /\b(family|friends|social)\b/i,
    /\b(health|medical|doctor)\b/i,
    /\b(home improvement|renovation|repair)\b/i,
  ];

  const tags: string[] = [];
  for (const pattern of tagPatterns) {
    const match = lower.match(pattern);
    if (match && !tags.includes(match[1])) tags.push(match[1]);
  }

  const stripped = entryText
    .replace(/^(today i|i |this morning i|this afternoon i|this evening i|just )/i, "")
    .split(/[.\n]/)[0]
    ?.trim()
    .slice(0, 60);
  const title = stripped || entryText.trim().slice(0, 60);

  return {
    category,
    tags,
    mood,
    title: title.charAt(0).toUpperCase() + title.slice(1),
  };
}
