import { NextRequest, NextResponse } from "next/server";
import { db, queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { HeartbeatTask, HeartbeatLog } from "@/lib/db/schema";

// GET /api/heartbeat-tasks/[id] - Get a single heartbeat task with logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const task = await queryOne<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const logs = await queryAll<HeartbeatLog>(
    `SELECT * FROM heartbeat_logs
     WHERE heartbeat_task_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [id]
  );

  return NextResponse.json({ task, logs });
}

// PATCH /api/heartbeat-tasks/[id] - Update a heartbeat task
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const updates: string[] = [];
  const args: (string | number)[] = [];

  const allowedFields = [
    "description",
    "check_source",
    "condition",
    "action_params",
    "schedule",
    "enabled",
    "notify_channel",
  ];

  for (const field of allowedFields) {
    if (field in body) {
      let value = body[field];
      if (field === "enabled") {
        value = value ? 1 : 0;
      } else if (field === "check_source" || field === "action_params") {
        value = typeof value === "string" ? value : JSON.stringify(value);
      }
      updates.push(`${field} = ?`);
      args.push(value);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  args.push(id, user.id);

  await db.execute({
    sql: `UPDATE heartbeat_tasks SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    args,
  });

  const task = await queryOne<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  return NextResponse.json({ task });
}

// DELETE /api/heartbeat-tasks/[id] - Delete a heartbeat task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Logs cascade-delete via FK
  await db.execute({
    sql: "DELETE FROM heartbeat_tasks WHERE id = ? AND user_id = ?",
    args: [id, user.id],
  });

  return NextResponse.json({ success: true });
}
