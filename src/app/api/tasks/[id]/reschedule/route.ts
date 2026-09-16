import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { scheduled_at } = await request.json();

    if (!scheduled_at) {
      return NextResponse.json(
        { error: "scheduled_at is required" },
        { status: 400 }
      );
    }

    // Validate ISO date format
    const date = new Date(scheduled_at);
    if (isNaN(date.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use ISO 8601 format (e.g., 2024-03-15T14:00:00Z)" },
        { status: 400 }
      );
    }

    // Update task scheduled_at
    await db.execute({
      sql: `UPDATE tasks
            SET scheduled_at = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [scheduled_at, id, user.id],
    });

    // Fetch updated task with project info
    const result = await db.execute({
      sql: `SELECT t.*, p.name as project_name
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.id = ? AND t.user_id = ?`,
      args: [id, user.id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task: result.rows[0] });
  } catch (error) {
    console.error("Reschedule error:", error);
    return NextResponse.json(
      { error: "Failed to reschedule task" },
      { status: 500 }
    );
  }
}
