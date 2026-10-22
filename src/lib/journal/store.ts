/**
 * Writing journal entries. Every path that adds one (the Journal page, the
 * stream's Brain Bar) goes through `saveJournalEntry`, so they cannot drift.
 *
 * What made the journal fail, and what each step below does about it:
 *
 * 1. **The note_type CHECK.** `notes.note_type` only gained 'journal' in the
 *    schema file; a database created before that still has the old CHECK, and
 *    SQLite cannot widen a CHECK in place. Every first entry of a day failed
 *    with "CHECK constraint failed", so no journal note could ever exist.
 *    `ensureNote` tries 'journal', then the older types, and the slug plus
 *    `metadata.journal_date` keep identifying the note either way.
 * 2. **Two saves racing for a new day.** Both saw no note, the second INSERT
 *    hit UNIQUE(user_id, slug) and 500'd. The insert is now
 *    `ON CONFLICT DO NOTHING` followed by a read, so both land in one note.
 * 3. **Lost appends.** The note was read, concatenated in JS and written back,
 *    so two quick entries overwrote each other. The append is now one SQL
 *    expression.
 * 4. **Half-written entries.** The note was appended to, then the entry row
 *    inserted; a failure between them left text in the note with no entry, and
 *    the user's retry wrote it twice. Both now run in one transaction.
 * 5. **Retries.** The client sends its own entry id; a retried save finds the
 *    row it already wrote and returns it.
 */

import { db, queryOne } from "@/lib/db/client";
import { v4 as uuid } from "uuid";
import {
  buildEntryAppend,
  categorizeEntry,
  formatEntryTime,
  isCheckConstraintError,
  isUniqueConstraintError,
  isValidClientId,
  isValidJournalDate,
  isValidTimeZone,
  journalDay,
  journalNoteSeed,
  MAX_ENTRY_CHARS,
  normalizeCategory,
  normalizeLocation,
  normalizeMood,
  normalizeTags,
} from "./entry";

export class JournalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalInputError";
  }
}

export interface SaveJournalEntryInput {
  userId: string;
  text: string;
  /** `YYYY-MM-DD`. Defaults to today in `timeZone`. */
  date?: string | null;
  /** Client-chosen id that makes the save safe to retry. */
  clientId?: string | null;
  /** The writer's IANA zone, for the date default and the time heading. */
  timeZone?: string | null;
  category?: string | null;
  mood?: string | null;
  tags?: unknown;
  location?: string | null;
  /** Extra fields recorded in the entry's metadata. */
  metadata?: Record<string, unknown>;
}

export interface SavedJournalEntry {
  id: string;
  note_id: string;
  date: string;
  entry_text: string;
  category: string;
  tags: string[];
  mood: string | null;
  location: string | null;
  title: string;
  created_at: string;
}

export interface SaveJournalEntryResult {
  entry: SavedJournalEntry;
  note: { id: string; title: string; slug: string };
  /** True when this was a retry of an entry that was already saved. */
  duplicate: boolean;
}

interface EntryRow {
  id: string;
  user_id: string;
  note_id: string;
  date: string;
  entry_text: string;
  category: string;
  tags: string | null;
  mood: string | null;
  location: string | null;
  created_at: string;
}

function parseTags(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Find or create a note by slug, trying each note type in turn until the
 * table's CHECK accepts one. Safe to call concurrently.
 */
export async function ensureNote(opts: {
  userId: string;
  slug: string;
  title: string;
  content: string;
  contentPlain: string;
  metadata: Record<string, unknown>;
  noteTypes: string[];
}): Promise<{ id: string; title: string; slug: string }> {
  const find = () =>
    queryOne<{ id: string; title: string; slug: string }>(
      "SELECT id, title, slug FROM notes WHERE user_id = ? AND slug = ?",
      [opts.userId, opts.slug]
    );

  const existing = await find();
  if (existing) return existing;

  let lastError: unknown = null;
  for (const noteType of opts.noteTypes) {
    try {
      // ON CONFLICT, not INSERT OR IGNORE: OR IGNORE would also swallow the
      // CHECK failure this loop needs to see.
      await db.execute({
        sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, note_type, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id, slug) DO NOTHING`,
        args: [
          uuid(),
          opts.userId,
          opts.title,
          opts.slug,
          opts.content,
          opts.contentPlain,
          noteType,
          JSON.stringify(opts.metadata),
        ],
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!isCheckConstraintError(error)) break;
      console.warn(
        `[journal] notes.note_type rejects '${noteType}' (database predates it); trying the next type`
      );
    }
  }

  const note = await find();
  if (note) return note;
  throw lastError ?? new Error("Could not create the note");
}

async function findEntry(id: string): Promise<EntryRow | null> {
  return queryOne<EntryRow>(
    `SELECT id, user_id, note_id, date, entry_text, category, tags, mood, location, created_at
     FROM journal_entries WHERE id = ?`,
    [id]
  );
}

function toResult(
  row: EntryRow,
  note: { id: string; title: string; slug: string },
  duplicate: boolean
): SaveJournalEntryResult {
  return {
    entry: {
      id: row.id,
      note_id: row.note_id,
      date: row.date,
      entry_text: row.entry_text,
      category: row.category,
      tags: parseTags(row.tags),
      mood: row.mood,
      location: row.location,
      title: categorizeEntry(row.entry_text).title,
      created_at: row.created_at,
    },
    note,
    duplicate,
  };
}

async function noteForEntry(row: EntryRow) {
  return (
    (await queryOne<{ id: string; title: string; slug: string }>(
      "SELECT id, title, slug FROM notes WHERE id = ?",
      [row.note_id]
    )) ?? { id: row.note_id, title: "", slug: "" }
  );
}

/** The user's saved zone, or null. Never throws. */
export async function getStoredTimeZone(userId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ timezone: string | null }>(
      "SELECT timezone FROM notification_preferences WHERE user_id = ?",
      [userId]
    );
    return row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : null;
  } catch {
    return null;
  }
}

export async function saveJournalEntry(
  input: SaveJournalEntryInput
): Promise<SaveJournalEntryResult> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new JournalInputError("Write something first.");
  if (text.length > MAX_ENTRY_CHARS) {
    throw new JournalInputError(
      `That entry is ${text.length.toLocaleString()} characters; the limit is ${MAX_ENTRY_CHARS.toLocaleString()}.`
    );
  }

  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : null;
  const now = new Date();
  let date: string;
  if (input.date == null || input.date === "") {
    date = journalDay(now, timeZone);
  } else if (isValidJournalDate(input.date)) {
    date = input.date;
  } else {
    throw new JournalInputError("The date must be a real day, as YYYY-MM-DD.");
  }

  // A retry of a save that already landed: hand back what was written.
  let entryId = isValidClientId(input.clientId) ? input.clientId : uuid();
  if (isValidClientId(input.clientId)) {
    const prior = await findEntry(entryId);
    if (prior && prior.user_id === input.userId) {
      return toResult(prior, await noteForEntry(prior), true);
    }
    // Someone else's id (vanishingly unlikely): don't collide with it.
    if (prior) entryId = uuid();
  }

  const auto = categorizeEntry(text);
  const category = input.category ? normalizeCategory(input.category) : auto.category;
  const mood = input.mood !== undefined && input.mood !== null ? normalizeMood(input.mood) : auto.mood;
  const tags = Array.isArray(input.tags) ? normalizeTags(input.tags) : auto.tags;
  const location = normalizeLocation(input.location);

  const seed = journalNoteSeed(date);
  const note = await ensureNote({
    userId: input.userId,
    slug: seed.slug,
    title: seed.title,
    content: seed.content,
    contentPlain: "",
    metadata: { journal_date: date },
    noteTypes: ["journal", "daily", "note"],
  });

  const append = buildEntryAppend(text, formatEntryTime(now, timeZone));
  const createdAt = now.toISOString();

  try {
    await db.batch(
      [
        {
          sql: `INSERT INTO journal_entries
                  (id, note_id, user_id, date, entry_text, category, tags, mood, location, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            entryId,
            note.id,
            input.userId,
            date,
            text,
            category,
            JSON.stringify(tags),
            mood,
            location,
            JSON.stringify({
              ...(input.metadata ?? {}),
              auto: { category: auto.category, mood: auto.mood, tags: auto.tags },
              time_zone: timeZone,
            }),
            createdAt,
            createdAt,
          ],
        },
        {
          // One expression, so concurrent entries both land. The note is HTML
          // once the editor has saved it, markdown until then.
          sql: `UPDATE notes SET
                  content = CASE
                    WHEN ltrim(COALESCE(content, '')) LIKE '<%' THEN COALESCE(content, '') || ?
                    ELSE COALESCE(content, '') || ?
                  END,
                  content_plain = COALESCE(content_plain, '') || ?,
                  updated_at = datetime('now')
                WHERE id = ?`,
          args: [append.html, append.markdown, append.plain, note.id],
        },
      ],
      "write"
    );
  } catch (error) {
    // Two tabs retrying the same entry at once: the other one won.
    if (isUniqueConstraintError(error)) {
      const prior = await findEntry(entryId);
      if (prior && prior.user_id === input.userId) {
        return toResult(prior, await noteForEntry(prior), true);
      }
    }
    throw error;
  }

  // Older screens read the day through daily_notes. Not part of the save: a
  // failure here must not report a saved entry as failed.
  try {
    await db.execute({
      sql: `INSERT INTO daily_notes (user_id, date, note_id, metadata)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO NOTHING`,
      args: [input.userId, date, note.id, JSON.stringify({ is_journal: true })],
    });
  } catch (error) {
    console.warn("[journal] daily_notes link skipped:", error);
  }

  return {
    entry: {
      id: entryId,
      note_id: note.id,
      date,
      entry_text: text,
      category,
      tags,
      mood,
      location,
      title: auto.title,
      created_at: createdAt,
    },
    note,
    duplicate: false,
  };
}

/**
 * Write a compiled month: its note and its `monthly_journals` row. Shared by
 * the Monthly view and the compile skill. Safe to repeat, and safe on a
 * database whose note_type CHECK predates 'monthly_journal'.
 */
export async function saveMonthlyJournal(opts: {
  userId: string;
  year: number;
  month: number;
  title: string;
  content: string;
  entryCount: number;
  summary: string | null;
  categories: Record<string, number>;
  highlights: string[];
}): Promise<{ noteId: string }> {
  const existing = await queryOne<{ id: string; note_id: string }>(
    "SELECT id, note_id FROM monthly_journals WHERE user_id = ? AND year = ? AND month = ?",
    [opts.userId, opts.year, opts.month]
  );

  let noteId = existing?.note_id ?? null;
  if (noteId) {
    const stillThere = await queryOne<{ id: string }>("SELECT id FROM notes WHERE id = ?", [noteId]);
    if (!stillThere) noteId = null;
  }
  if (!noteId) {
    const note = await ensureNote({
      userId: opts.userId,
      slug: `monthly-journal-${opts.year}-${String(opts.month).padStart(2, "0")}`,
      title: opts.title,
      content: opts.content,
      contentPlain: opts.content,
      metadata: { year: opts.year, month: opts.month },
      noteTypes: ["monthly_journal", "journal", "note"],
    });
    noteId = note.id;
  }

  await db.batch(
    [
      {
        sql: `UPDATE notes SET content = ?, content_plain = ?, updated_at = datetime('now') WHERE id = ?`,
        args: [opts.content, opts.content, noteId],
      },
      {
        sql: `INSERT INTO monthly_journals
                (id, note_id, user_id, year, month, entry_count, summary, categories, highlights, compiled_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id, year, month) DO UPDATE SET
                note_id = excluded.note_id,
                entry_count = excluded.entry_count,
                summary = excluded.summary,
                categories = excluded.categories,
                highlights = excluded.highlights,
                compiled_at = excluded.compiled_at,
                updated_at = datetime('now')`,
        args: [
          uuid(),
          noteId,
          opts.userId,
          opts.year,
          opts.month,
          opts.entryCount,
          opts.summary,
          JSON.stringify(opts.categories),
          JSON.stringify(opts.highlights),
        ],
      },
    ],
    "write"
  );

  return { noteId };
}
