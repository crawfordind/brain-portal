import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { DailyNote, Note } from "@/lib/db/schema";
import { format } from "date-fns";

const DAILY_NOTE_TEMPLATE = `## Journal

Start your journal for today. What happened? What did you do, learn, or experience?

---

`;

const LEGACY_DAILY_TEMPLATE = `## Morning Focus
What's the one thing that matters most today?

## Tasks
- [ ]

## Work Log


## Captures & Ideas


## End of Day
### What went well?

### What could be improved?

### Key insight from today
`;

// GET /api/daily - Get daily note for a date (or today)
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const dateParam = searchParams.get("date");
    const date = dateParam || format(new Date(), "yyyy-MM-dd");

    // Get daily note metadata
    const dailyNote = await queryOne<DailyNote>(
      "SELECT * FROM daily_notes WHERE user_id = ? AND date = ?",
      [user.id, date]
    );

    if (!dailyNote) {
      return NextResponse.json({ dailyNote: null, note: null, date });
    }

    // Get the associated note content
    const note = await queryOne<Note>(
      "SELECT * FROM notes WHERE id = ?",
      [dailyNote.note_id]
    );

    return NextResponse.json({ dailyNote, note, date });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch daily note" }, { status: 500 });
  }
}

// POST /api/daily - Create or get today's daily note
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const dateParam = body.date;
    const date = dateParam || format(new Date(), "yyyy-MM-dd");
    const title = format(new Date(date), "EEEE, MMMM d, yyyy");
    const slug = `daily-${date}`;

    // Check if daily note already exists
    const existing = await queryOne<DailyNote>(
      "SELECT * FROM daily_notes WHERE user_id = ? AND date = ?",
      [user.id, date]
    );

    if (existing) {
      const note = await queryOne<Note>(
        "SELECT * FROM notes WHERE id = ?",
        [existing.note_id]
      );
      return NextResponse.json({ dailyNote: existing, note, date });
    }

    // Create the note as a journal note (transformed from daily notes)
    const journalSlug = `journal-${date}`;
    const useJournalFormat = body.format !== "legacy";
    const noteSlug = useJournalFormat ? journalSlug : slug;
    const noteType = useJournalFormat ? "journal" : "daily";
    const noteTitle = useJournalFormat ? `Journal - ${title}` : title;
    const noteContent = useJournalFormat ? `# Journal - ${title}\n\n---\n\n` : LEGACY_DAILY_TEMPLATE;

    await db.execute({
      sql: `
        INSERT INTO notes (user_id, title, slug, content, note_type, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [user.id, noteTitle, noteSlug, noteContent, noteType, JSON.stringify({ journal_date: date })],
    });

    const note = await queryOne<Note>(
      "SELECT * FROM notes WHERE user_id = ? AND slug IN (?, ?)",
      [user.id, noteSlug, slug]
    );

    if (!note) {
      return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
    }

    // Create daily note metadata
    await db.execute({
      sql: `
        INSERT INTO daily_notes (user_id, date, note_id)
        VALUES (?, ?, ?)
      `,
      args: [user.id, date, note.id],
    });

    const dailyNote = await queryOne<DailyNote>(
      "SELECT * FROM daily_notes WHERE user_id = ? AND date = ?",
      [user.id, date]
    );

    return NextResponse.json({ dailyNote, note, date }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create daily note" }, { status: 500 });
  }
}

// GET /api/daily/calendar - Get dates with daily notes (for calendar view)
export async function OPTIONS(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const year = searchParams.get("year") || new Date().getFullYear().toString();
    const month = searchParams.get("month");

    let query = `
      SELECT date, mood, energy_level
      FROM daily_notes
      WHERE user_id = ? AND strftime('%Y', date) = ?
    `;
    const args: (string | number)[] = [user.id, year];

    if (month) {
      query += " AND strftime('%m', date) = ?";
      args.push(month.padStart(2, "0"));
    }

    query += " ORDER BY date DESC";

    const dates = await queryAll<{ date: string; mood?: string; energy_level?: number }>(query, args);

    return NextResponse.json({ dates });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch calendar dates" }, { status: 500 });
  }
}
