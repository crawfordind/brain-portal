import { NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_HEARTBEAT_TASKS } from "@/lib/heartbeat/defaults";

/**
 * POST /api/heartbeat-tasks/seed
 *
 * Installs default system heartbeat tasks for the current user.
 * Skips tasks that already exist (by name).
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let installed = 0;
  let skipped = 0;

  for (const task of DEFAULT_HEARTBEAT_TASKS) {
    // Check if already exists
    const existing = await queryOne(
      "SELECT id FROM heartbeat_tasks WHERE user_id = ? AND name = ?",
      [user.id, task.name]
    );

    if (existing) {
      skipped++;
      continue;
    }

    await db.execute({
      sql: `INSERT INTO heartbeat_tasks
            (user_id, name, description, check_type, check_source, condition, action_type, action_params, schedule, enabled, owner, notify_channel)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'in_app')`,
      args: [
        user.id,
        task.name,
        task.description,
        task.check_type,
        JSON.stringify(task.check_source),
        task.condition,
        task.action_type,
        JSON.stringify(task.action_params),
        task.schedule,
        task.owner,
      ],
    });
    installed++;
  }

  return NextResponse.json({
    success: true,
    installed,
    skipped,
    total: DEFAULT_HEARTBEAT_TASKS.length,
  });
}
