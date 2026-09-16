import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { generateWeeklyReview } from "@/lib/ai/client";
import { Note, Task, Capture, DailyNote, WeeklyReview } from "@/lib/db/schema";
import { format, startOfWeek, endOfWeek, getWeek, getYear, subWeeks } from "date-fns";
import { getCompiledGuardrails } from "@/lib/guardrails";

// POST /api/weekly/generate - Generate a weekly review
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const targetDate = body.date ? new Date(body.date) : new Date();

  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(targetDate, { weekStartsOn: 1 });
  const weekNumber = getWeek(targetDate, { weekStartsOn: 1 });
  const year = getYear(targetDate);

  // Check if review already exists
  const existing = await queryOne<WeeklyReview>(
    "SELECT * FROM weekly_reviews WHERE user_id = ? AND year = ? AND week_number = ?",
    [user.id, year, weekNumber]
  );

  if (existing) {
    const note = existing.note_id
      ? await queryOne<Note>("SELECT * FROM notes WHERE id = ?", [existing.note_id])
      : null;
    return NextResponse.json({
      message: "Weekly review already exists",
      review: existing,
      note,
    });
  }

  // Gather daily notes for the week
  const dailyNotes = await queryAll<DailyNote & { content: string; title: string }>(
    `SELECT dn.*, n.content, n.title
     FROM daily_notes dn
     JOIN notes n ON dn.note_id = n.id
     WHERE dn.user_id = ? AND dn.date >= ? AND dn.date <= ?
     ORDER BY dn.date ASC`,
    [user.id, format(weekStart, "yyyy-MM-dd"), format(weekEnd, "yyyy-MM-dd")]
  );

  // Gather tasks completed this week
  const completedTasks = await queryAll<Task>(
    `SELECT t.*, p.name as project_name
     FROM tasks t
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE t.user_id = ? AND t.completed_at >= ? AND t.completed_at <= ?`,
    [user.id, format(weekStart, "yyyy-MM-dd"), format(weekEnd, "yyyy-MM-dd")]
  );

  // Gather pending/in-progress tasks (carried over or still open)
  const pendingTasks = await queryAll<Task & { project_name?: string }>(
    `SELECT t.*, p.name as project_name
     FROM tasks t
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE t.user_id = ? AND t.status IN ('pending', 'in_progress')
       AND t.created_at <= ?
     ORDER BY t.priority DESC, t.due_date ASC
     LIMIT 30`,
    [user.id, format(weekEnd, "yyyy-MM-dd")]
  );

  // Gather captures from this week
  const captures = await queryAll<Capture>(
    `SELECT * FROM captures
     WHERE user_id = ? AND created_at >= ? AND created_at <= ?
     ORDER BY created_at ASC`,
    [user.id, format(weekStart, "yyyy-MM-dd"), format(weekEnd, "yyyy-MM-dd")]
  );

  // Gather notes created/updated this week
  const activeNotes = await queryAll<Note>(
    `SELECT n.*, p.name as project_name
     FROM notes n
     LEFT JOIN projects p ON n.project_id = p.id
     WHERE n.user_id = ? AND n.note_type != 'daily'
       AND (n.created_at >= ? OR n.updated_at >= ?)
       AND n.updated_at <= ?
     ORDER BY n.updated_at DESC`,
    [
      user.id,
      format(weekStart, "yyyy-MM-dd"),
      format(weekStart, "yyyy-MM-dd"),
      format(weekEnd, "yyyy-MM-dd"),
    ]
  );

  // Fetch previous week's stats for comparison
  const prevWeekStart = subWeeks(weekStart, 1);
  const prevWeekEnd = subWeeks(weekEnd, 1);
  const prevFmt = (d: Date) => format(d, "yyyy-MM-dd");

  const [prevTasks, prevCaptures, prevNotes, prevDailies] = await Promise.all([
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND completed_at >= ? AND completed_at <= ?`,
      [user.id, prevFmt(prevWeekStart), prevFmt(prevWeekEnd)]
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM captures WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
      [user.id, prevFmt(prevWeekStart), prevFmt(prevWeekEnd)]
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM notes WHERE user_id = ? AND note_type != 'daily' AND (created_at >= ? OR updated_at >= ?) AND updated_at <= ?`,
      [user.id, prevFmt(prevWeekStart), prevFmt(prevWeekStart), prevFmt(prevWeekEnd)]
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM daily_notes WHERE user_id = ? AND date >= ? AND date <= ?`,
      [user.id, prevFmt(prevWeekStart), prevFmt(prevWeekEnd)]
    ),
  ]);

  const previousWeekStats = {
    tasksCompleted: prevTasks?.count ?? 0,
    capturesCount: prevCaptures?.count ?? 0,
    notesWorkedOn: prevNotes?.count ?? 0,
    dailyNotesCount: prevDailies?.count ?? 0,
  };

  // Fetch previous week's review for continuity — extract "Next Week's Focus"
  let previousFocus: string | undefined;
  const prevWeekNumber = getWeek(prevWeekStart, { weekStartsOn: 1 });
  const prevYear = getYear(prevWeekStart);
  const prevReview = await queryOne<WeeklyReview>(
    "SELECT * FROM weekly_reviews WHERE user_id = ? AND year = ? AND week_number = ?",
    [user.id, prevYear, prevWeekNumber]
  );
  if (prevReview?.note_id) {
    const prevNote = await queryOne<Note>(
      "SELECT content FROM notes WHERE id = ?",
      [prevReview.note_id]
    );
    if (prevNote?.content) {
      const focusMatch = prevNote.content.match(/## Next Week's Focus\n([\s\S]*?)(?=\n## |\n$|$)/);
      if (focusMatch) {
        previousFocus = focusMatch[1].trim();
      }
    }
  }

  // Format data for AI
  const context = {
    weekStart: format(weekStart, "MMMM d, yyyy"),
    weekEnd: format(weekEnd, "MMMM d, yyyy"),
    weekNumber,
    year,
    dailyNotes: dailyNotes.map((d) => ({
      date: d.date,
      mood: d.mood != null ? String(d.mood) : undefined,
      energyLevel: d.energy ?? undefined,
      content: d.content.substring(0, 1500),
    })),
    completedTasks: completedTasks.map((t) => ({
      content: t.content,
      project: (t as Task & { project_name?: string }).project_name,
    })),
    pendingTasks: pendingTasks.map((t) => ({
      content: t.title || t.content,
      project: t.project_name,
      status: t.status,
      dueDate: t.due_date || undefined,
    })),
    captures: captures.map((c) => ({
      content: c.content,
      type: c.capture_type,
    })),
    activeNotes: activeNotes.map((n) => ({
      title: n.title,
      type: n.note_type,
      project: (n as Note & { project_name?: string }).project_name,
      wordCount: n.word_count,
    })),
    stats: {
      dailyNotesCount: dailyNotes.length,
      tasksCompleted: completedTasks.length,
      capturesCount: captures.length,
      notesWorkedOn: activeNotes.length,
    },
    previousWeekStats,
    previousFocus,
  };

  try {
    // Fetch user guardrails for personalized review
    let guardrails: string | undefined;
    try {
      const compiled = await getCompiledGuardrails(user.id);
      if (compiled) guardrails = compiled;
    } catch {
      // Non-fatal
    }

    // Generate review content using AI
    const reviewContent = await generateWeeklyReview(context, { guardrails });

    // Create the review note
    const noteTitle = `Week ${weekNumber} Review - ${format(weekStart, "MMM d")} to ${format(weekEnd, "MMM d, yyyy")}`;
    const noteSlug = `weekly-${year}-w${weekNumber.toString().padStart(2, "0")}`;

    await db.execute({
      sql: `
        INSERT INTO notes (user_id, title, slug, content, note_type)
        VALUES (?, ?, ?, ?, 'weekly')
      `,
      args: [user.id, noteTitle, noteSlug, reviewContent],
    });

    const note = await queryOne<Note>(
      "SELECT * FROM notes WHERE user_id = ? AND slug = ?",
      [user.id, noteSlug]
    );

    if (!note) {
      return NextResponse.json({ error: "Failed to create review note" }, { status: 500 });
    }

    // Create weekly review record
    await db.execute({
      sql: `
        INSERT INTO weekly_reviews (user_id, year, week_number, start_date, end_date, note_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        user.id,
        year,
        weekNumber,
        format(weekStart, "yyyy-MM-dd"),
        format(weekEnd, "yyyy-MM-dd"),
        note.id,
      ],
    });

    const review = await queryOne<WeeklyReview>(
      "SELECT * FROM weekly_reviews WHERE user_id = ? AND year = ? AND week_number = ?",
      [user.id, year, weekNumber]
    );

    return NextResponse.json({
      message: "Weekly review generated",
      review,
      note,
    }, { status: 201 });
  } catch (error) {
    console.error("Weekly review generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate weekly review" },
      { status: 500 }
    );
  }
}
