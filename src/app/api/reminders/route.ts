import { NextRequest, NextResponse } from "next/server";
import { db, mutate, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Reminder } from "@/lib/db/schema";
import { safeParseJson, isErrorResponse, isValidPriority } from "@/lib/api/validation";

// GET /api/reminders - List reminders
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const projectId = searchParams.get("projectId");
    const upcoming = searchParams.get("upcoming") === "true";

    let query = `
      SELECT r.*, p.name as project_name, p.color as project_color
      FROM reminders r
      LEFT JOIN projects p ON r.project_id = p.id
      WHERE r.user_id = ?
    `;
    const args: (string | number)[] = [user.id];

    if (status) {
      query += " AND r.status = ?";
      args.push(status);
    }

    if (projectId) {
      query += " AND r.project_id = ?";
      args.push(projectId);
    }

    if (upcoming) {
      query += " AND r.status = 'pending' AND r.remind_at >= datetime('now')";
    }

    query += " ORDER BY r.remind_at ASC";

    const reminders = await queryAll<Reminder & { project_name?: string; project_color?: string }>(query, args);

    return NextResponse.json({ reminders });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch reminders" }, { status: 500 });
  }
}

// POST /api/reminders - Create a new reminder
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const title = body.title as string | undefined;
  const content = (body.content as string) || null;
  const remindAt = body.remindAt as string | undefined;
  const priority = (body.priority as string) || "medium";
  const projectId = (body.projectId as string) || null;
  const tags = (body.tags as string[]) || [];
  const recurrenceRule = (body.recurrenceRule as string) || null;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  if (!remindAt) {
    return NextResponse.json({ error: "Reminder time (remindAt) is required" }, { status: 400 });
  }

  if (priority !== "medium" && !isValidPriority(priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }

  try {
    const reminder = await mutate<Reminder>(
      `INSERT INTO reminders (user_id, title, content, remind_at, priority, project_id, tags, recurrence_rule)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *`,
      [
        user.id,
        title.trim(),
        content || null,
        remindAt,
        priority,
        projectId || null,
        JSON.stringify(tags),
        recurrenceRule || null,
      ]
    );

    return NextResponse.json({ reminder }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create reminder" }, { status: 500 });
  }
}
