import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db/client";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all counts in parallel
    const [notes, captures, tasks, journal, reminders, insights, connections, projects] =
      await Promise.all([
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM notes WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM captures WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM tasks WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM journal_entries WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM reminders WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM insights WHERE user_id = ? AND is_dismissed = FALSE`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM note_connections WHERE user_id = ?`,
          [user.id]
        ),
        query<{ count: number }>(
          `SELECT COUNT(*) as count FROM projects WHERE user_id = ?`,
          [user.id]
        ),
      ]);

    return NextResponse.json({
      counts: {
        notes: notes[0]?.count ?? 0,
        captures: captures[0]?.count ?? 0,
        tasks: tasks[0]?.count ?? 0,
        journal: journal[0]?.count ?? 0,
        reminders: reminders[0]?.count ?? 0,
        insights: insights[0]?.count ?? 0,
        connections: connections[0]?.count ?? 0,
        projects: projects[0]?.count ?? 0,
      },
    });
  } catch (error) {
    console.error("Failed to get export preview:", error);
    return NextResponse.json(
      { error: "Failed to get preview" },
      { status: 500 }
    );
  }
}
