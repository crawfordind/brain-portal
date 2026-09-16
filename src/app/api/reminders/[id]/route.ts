import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Reminder } from "@/lib/db/schema";
import { safeParseJson, isErrorResponse, isValidPriority, isValidReminderStatus } from "@/lib/api/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/reminders/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const reminder = await queryOne<Reminder>(
    `SELECT r.*, p.name as project_name, p.color as project_color
     FROM reminders r
     LEFT JOIN projects p ON r.project_id = p.id
     WHERE r.id = ? AND r.user_id = ?`,
    [id, user.id]
  );

  if (!reminder) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  return NextResponse.json({ reminder });
}

// PATCH /api/reminders/[id] - Update a reminder
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<Reminder>(
    "SELECT * FROM reminders WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const updates: string[] = [];
  const args: (string | null)[] = [];

  if (body.status !== undefined && !isValidReminderStatus(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  if (body.priority !== undefined && !isValidPriority(body.priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }

  if (body.title !== undefined) {
    updates.push("title = ?");
    args.push(body.title as string);
  }
  if (body.content !== undefined) {
    updates.push("content = ?");
    args.push(body.content as string);
  }
  if (body.remindAt !== undefined) {
    updates.push("remind_at = ?");
    args.push(body.remindAt as string);
  }
  if (body.status !== undefined) {
    updates.push("status = ?");
    args.push(body.status as string);
    if (body.status === "triggered") {
      updates.push("triggered_at = datetime('now')");
    }
    if (body.status === "dismissed") {
      updates.push("dismissed_at = datetime('now')");
    }
  }
  if (body.priority !== undefined) {
    updates.push("priority = ?");
    args.push(body.priority as string);
  }
  if (body.projectId !== undefined) {
    updates.push("project_id = ?");
    args.push((body.projectId as string) || null);
  }
  if (body.tags !== undefined) {
    updates.push("tags = ?");
    args.push(JSON.stringify(body.tags));
  }
  if (body.snoozedUntil !== undefined) {
    updates.push("snoozed_until = ?");
    args.push((body.snoozedUntil as string) || null);
    updates.push("status = 'snoozed'");
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  args.push(id, user.id);

  await db.execute({
    sql: `UPDATE reminders SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    args,
  });

  const updated = await queryOne<Reminder>(
    "SELECT * FROM reminders WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  return NextResponse.json({ reminder: updated });
}

// DELETE /api/reminders/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<Reminder>(
    "SELECT * FROM reminders WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
  }

  await db.execute({
    sql: "DELETE FROM reminders WHERE id = ? AND user_id = ?",
    args: [id, user.id],
  });

  return NextResponse.json({ success: true });
}
