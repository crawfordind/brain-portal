/**
 * Saving journal entries against a real in-memory SQLite database, including
 * one whose notes table predates the 'journal' note type, which is what made
 * every first entry of a day fail.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => ({
  db: testDb,
  queryOne: async (sql: string, args: unknown[] = []) => {
    const r = await testDb.execute({ sql, args });
    return r.rows[0] ? { ...r.rows[0] } : null;
  },
}));

import { saveJournalEntry, saveMonthlyJournal, JournalInputError } from "@/lib/journal/store";

const CURRENT_TYPES = `'note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal'`;
const LEGACY_TYPES = `'note', 'daily', 'weekly', 'insight'`;

async function reset(noteTypes = CURRENT_TYPES) {
  for (const t of ["monthly_journals", "journal_entries", "daily_notes", "notes", "notification_preferences", "users"]) {
    await testDb.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  await testDb.execute(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
  await testDb.execute(`INSERT INTO users (id) VALUES ('u1'), ('u2')`);
  await testDb.execute(`CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    content_plain TEXT,
    note_type TEXT DEFAULT 'note' CHECK (note_type IN (${noteTypes})),
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, slug)
  )`);
  await testDb.execute(`CREATE TABLE daily_notes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    note_id TEXT NOT NULL REFERENCES notes(id),
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    UNIQUE(user_id, date)
  )`);
  await testDb.execute(`CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL REFERENCES notes(id),
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    entry_text TEXT NOT NULL,
    category TEXT DEFAULT 'general' CHECK (category IN ('general', 'personal', 'work', 'health', 'travel', 'purchase', 'project', 'learning', 'social', 'maintenance')),
    tags TEXT DEFAULT '[]',
    mood TEXT,
    location TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  await testDb.execute(`CREATE TABLE monthly_journals (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    entry_count INTEGER DEFAULT 0,
    summary TEXT,
    categories TEXT DEFAULT '{}',
    highlights TEXT DEFAULT '[]',
    compiled_at TEXT,
    updated_at TEXT,
    UNIQUE(user_id, year, month)
  )`);
}

const rows = async (sql: string, args: unknown[] = []) =>
  (await testDb.execute({ sql, args })).rows.map((r: Record<string, unknown>) => ({ ...r }));

describe("saveJournalEntry", () => {
  beforeEach(() => reset());

  it("creates the day's note, the entry and the daily link", async () => {
    const r = await saveJournalEntry({ userId: "u1", text: "Planted tomatoes", date: "2026-10-22", timeZone: "UTC" });

    expect(r.duplicate).toBe(false);
    expect(r.entry).toMatchObject({ date: "2026-10-22", entry_text: "Planted tomatoes", category: "maintenance" });
    const [note] = await rows("SELECT * FROM notes");
    expect(note).toMatchObject({ slug: "journal-2026-10-22", note_type: "journal", title: "Journal - Thursday, October 22, 2026" });
    expect(note.content).toContain("Planted tomatoes");
    expect(await rows("SELECT * FROM journal_entries")).toHaveLength(1);
    expect(await rows("SELECT * FROM daily_notes")).toHaveLength(1);
  });

  it("saves on a database whose note_type CHECK predates 'journal'", async () => {
    await reset(LEGACY_TYPES);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await saveJournalEntry({ userId: "u1", text: "First entry", date: "2026-10-22" });
    const second = await saveJournalEntry({ userId: "u1", text: "Second entry", date: "2026-10-22" });

    const notes = await rows("SELECT * FROM notes");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ slug: "journal-2026-10-22", note_type: "daily" });
    expect(second.note.id).toBe(r.note.id);
    expect(await rows("SELECT * FROM journal_entries")).toHaveLength(2);
  });

  it("is safe to retry: the same clientId writes the entry once", async () => {
    const clientId = "0b6b2c1e-5c8a-4a40-9f3c-2d0b8f1a7e11";
    const first = await saveJournalEntry({ userId: "u1", text: "Once", date: "2026-10-22", clientId });
    const again = await saveJournalEntry({ userId: "u1", text: "Once", date: "2026-10-22", clientId });

    expect(first.entry.id).toBe(clientId);
    expect(again.duplicate).toBe(true);
    expect(again.entry.id).toBe(clientId);
    expect(await rows("SELECT * FROM journal_entries")).toHaveLength(1);
    const [note] = await rows("SELECT content FROM notes");
    expect(String(note.content).match(/Once/g)).toHaveLength(1);
  });

  it("keeps every entry when several saves race for a new day", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        saveJournalEntry({ userId: "u1", text: `Entry ${i}`, date: "2026-10-22" })
      )
    );

    expect(await rows("SELECT * FROM notes")).toHaveLength(1);
    expect(await rows("SELECT * FROM journal_entries")).toHaveLength(5);
    const [note] = await rows("SELECT content FROM notes");
    for (let i = 0; i < 5; i++) expect(note.content).toContain(`Entry ${i}`);
  });

  it("appends HTML once the note has been edited in the editor", async () => {
    const r = await saveJournalEntry({ userId: "u1", text: "Morning", date: "2026-10-22" });
    await testDb.execute({ sql: "UPDATE notes SET content = '<h1>Journal</h1><p>Morning</p>' WHERE id = ?", args: [r.note.id] });

    await saveJournalEntry({ userId: "u1", text: "Evening <b>walk</b>", date: "2026-10-22", timeZone: "UTC" });

    const [note] = await rows("SELECT content FROM notes");
    expect(note.content).toMatch(/<h3>.+<\/h3><p>Evening &lt;b&gt;walk&lt;\/b&gt;<\/p>$/);
    expect(note.content).not.toContain("###");
  });

  it("appends to content_plain even when it was NULL", async () => {
    const r = await saveJournalEntry({ userId: "u1", text: "One", date: "2026-10-22" });
    await testDb.execute({ sql: "UPDATE notes SET content_plain = NULL WHERE id = ?", args: [r.note.id] });
    await saveJournalEntry({ userId: "u1", text: "Two", date: "2026-10-22" });

    const [note] = await rows("SELECT content_plain FROM notes");
    expect(note.content_plain).toContain("Two");
  });

  it("turns an unknown category into 'general' instead of failing the insert", async () => {
    const r = await saveJournalEntry({ userId: "u1", text: "Hello", date: "2026-10-22", category: "Gardening" });
    expect(r.entry.category).toBe("general");
  });

  it("defaults the date to the writer's day, not UTC's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T02:30:00Z")); // 10:30pm on the 22nd in New York
    try {
      const r = await saveJournalEntry({ userId: "u1", text: "Late night", timeZone: "America/New_York" });
      expect(r.entry.date).toBe("2026-10-22");
      const [note] = await rows("SELECT content FROM notes");
      expect(note.content).toContain("### 10:30 PM");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects empty text, overlong text and impossible dates", async () => {
    await expect(saveJournalEntry({ userId: "u1", text: "   " })).rejects.toBeInstanceOf(JournalInputError);
    await expect(saveJournalEntry({ userId: "u1", text: "x".repeat(20_001) })).rejects.toBeInstanceOf(JournalInputError);
    await expect(saveJournalEntry({ userId: "u1", text: "Hi", date: "2026-02-30" })).rejects.toBeInstanceOf(JournalInputError);
    expect(await rows("SELECT * FROM notes")).toHaveLength(0);
  });

  it("does not hand one account another's entry by id", async () => {
    const clientId = "shared-client-id-123";
    await saveJournalEntry({ userId: "u1", text: "Mine", date: "2026-10-22", clientId });
    const other = await saveJournalEntry({ userId: "u2", text: "Theirs", date: "2026-10-22", clientId });

    expect(other.duplicate).toBe(false);
    expect(other.entry.id).not.toBe(clientId);
    expect(other.entry.entry_text).toBe("Theirs");
  });

  it("still saves the entry if the daily_notes link cannot be written", async () => {
    await testDb.execute("DROP TABLE daily_notes");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await saveJournalEntry({ userId: "u1", text: "Still here", date: "2026-10-22" });
    expect(r.entry.entry_text).toBe("Still here");
    expect(await rows("SELECT * FROM journal_entries")).toHaveLength(1);
  });
});

describe("saveMonthlyJournal", () => {
  beforeEach(() => reset());

  const month = {
    userId: "u1",
    year: 2026,
    month: 10,
    title: "October 2026 Journal",
    content: "# October",
    entryCount: 3,
    summary: "A month",
    categories: { general: 3 },
    highlights: ["One"],
  };

  it("creates once and recompiles in place", async () => {
    const first = await saveMonthlyJournal(month);
    const second = await saveMonthlyJournal({ ...month, content: "# October, again", entryCount: 4 });

    expect(second.noteId).toBe(first.noteId);
    expect(await rows("SELECT * FROM notes")).toHaveLength(1);
    const [mj] = await rows("SELECT * FROM monthly_journals");
    expect(mj.entry_count).toBe(4);
  });

  it("works on a database whose note_type CHECK predates 'monthly_journal'", async () => {
    await reset(LEGACY_TYPES);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await saveMonthlyJournal(month);
    const [note] = await rows("SELECT * FROM notes WHERE id = ?", [r.noteId]);
    expect(note.note_type).toBe("note");
  });
});
