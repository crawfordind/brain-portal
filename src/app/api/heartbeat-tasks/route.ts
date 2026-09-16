import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { HeartbeatTask, HeartbeatLog } from "@/lib/db/schema";

// GET /api/heartbeat-tasks - List user's heartbeat tasks with recent logs
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const includeLogs = searchParams.get("logs") === "true";

  const tasks = await queryAll<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [user.id]
  );

  if (includeLogs && tasks.length > 0) {
    const taskIds = tasks.map(t => t.id);
    const placeholders = taskIds.map(() => "?").join(",");
    const logs = await queryAll<HeartbeatLog & { _rn?: number }>(
      `SELECT * FROM (
         SELECT hl.*,
           ROW_NUMBER() OVER (PARTITION BY hl.heartbeat_task_id ORDER BY hl.created_at DESC) as _rn
         FROM heartbeat_logs hl
         WHERE hl.heartbeat_task_id IN (${placeholders})
       ) WHERE _rn <= 10`,
      taskIds
    );

    const logsByTask = new Map<string, HeartbeatLog[]>();
    for (const log of logs) {
      const { _rn, ...cleanLog } = log;
      const list = logsByTask.get(log.heartbeat_task_id) || [];
      list.push(cleanLog as HeartbeatLog);
      logsByTask.set(log.heartbeat_task_id, list);
    }

    const tasksWithLogs = tasks.map(task => ({
      ...task,
      recent_logs: logsByTask.get(task.id) || [],
    }));
    return NextResponse.json({ tasks: tasksWithLogs });
  }

  return NextResponse.json({ tasks });
}

// POST /api/heartbeat-tasks - Create a new heartbeat task
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    name,
    description,
    check_type,
    check_source,
    condition,
    action_type,
    action_params = "{}",
    schedule = "30m",
    enabled = true,
    notify_channel = "in_app",
  } = body;

  if (!name?.trim() || !description?.trim()) {
    return NextResponse.json(
      { error: "Name and description are required" },
      { status: 400 }
    );
  }

  const validCheckTypes = ["db_query", "rule_eval", "stale_check"];
  if (!validCheckTypes.includes(check_type)) {
    return NextResponse.json(
      { error: `Invalid check_type. Must be one of: ${validCheckTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const validActionTypes = ["create_notification", "delegate_to_agent", "enqueue_processing"];
  if (!validActionTypes.includes(action_type)) {
    return NextResponse.json(
      { error: `Invalid action_type. Must be one of: ${validActionTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const validSchedules = ["5m", "15m", "30m", "1h", "2h", "6h", "12h", "24h"];
  if (!validSchedules.includes(schedule)) {
    return NextResponse.json(
      { error: `Invalid schedule. Must be one of: ${validSchedules.join(", ")}` },
      { status: 400 }
    );
  }

  // Check for duplicate name
  const existing = await queryOne(
    "SELECT id FROM heartbeat_tasks WHERE user_id = ? AND name = ?",
    [user.id, name.trim()]
  );
  if (existing) {
    return NextResponse.json(
      { error: "A heartbeat task with this name already exists" },
      { status: 409 }
    );
  }

  // Validate check_source is valid JSON
  try {
    JSON.parse(typeof check_source === "string" ? check_source : JSON.stringify(check_source));
  } catch {
    return NextResponse.json(
      { error: "check_source must be valid JSON" },
      { status: 400 }
    );
  }

  const checkSourceStr = typeof check_source === "string" ? check_source : JSON.stringify(check_source);
  const actionParamsStr = typeof action_params === "string" ? action_params : JSON.stringify(action_params);

  await db.execute({
    sql: `INSERT INTO heartbeat_tasks
          (user_id, name, description, check_type, check_source, condition, action_type, action_params, schedule, enabled, owner, notify_channel)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
    args: [
      user.id,
      name.trim(),
      description.trim(),
      check_type,
      checkSourceStr,
      condition || "count > 0",
      action_type,
      actionParamsStr,
      schedule,
      enabled ? 1 : 0,
      notify_channel,
    ],
  });

  const task = await queryOne<HeartbeatTask>(
    "SELECT * FROM heartbeat_tasks WHERE user_id = ? AND name = ?",
    [user.id, name.trim()]
  );

  return NextResponse.json({ task }, { status: 201 });
}
