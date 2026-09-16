import { NextRequest, NextResponse } from "next/server";
import { db, mutate, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Task } from "@/lib/db/schema";
import { parseTaskNL } from "@/lib/tasks/parse";

// GET /api/tasks - List all tasks
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status");
    const projectId = searchParams.get("projectId");
    const priority = searchParams.get("priority");
    const includeCompleted = searchParams.get("includeCompleted") === "true";
    const delegatedTo = searchParams.get("delegatedTo");
    const hasAgent = searchParams.get("hasAgent");
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const completedSince = searchParams.get("completedSince");

    let query = `
      SELECT
        t.id, t.user_id, t.content, t.title, t.description, t.status, t.priority,
        t.project_id, t.note_id, t.due_date, t.scheduled_at, t.estimated_minutes,
        t.delegated_to, t.agent_task_id, t.tags, t.linked_note_ids, t.metadata,
        t.recurrence_rule, t.recurrence_end_date, t.parent_task_id,
        t.completed_at, t.created_at, t.updated_at,
        p.name as project_name,
        n.title as note_title,
        n.slug as note_slug,
        at.status as agent_status
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN notes n ON t.note_id = n.id
      LEFT JOIN agent_tasks at ON t.agent_task_id = at.id
      WHERE (
        t.user_id = ?
        OR (t.project_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM project_collaborators pc
          WHERE pc.project_id = t.project_id AND pc.user_id = ? AND pc.status = 'accepted'
        ))
      )
    `;
    const args: (string | number)[] = [user.id, user.id];

    if (status) {
      query += " AND t.status = ?";
      args.push(status);
    } else if (!includeCompleted) {
      query += " AND t.status != 'completed'";
    }

    if (projectId) {
      query += " AND t.project_id = ?";
      args.push(projectId);
    }

    if (priority) {
      const validPriorities = ['low', 'medium', 'high', 'urgent'];
      if (validPriorities.includes(priority)) {
        query += " AND t.priority = ?";
        args.push(priority);
      }
    }

    if (delegatedTo === 'null') {
      query += " AND t.delegated_to IS NULL";
    } else if (delegatedTo) {
      query += " AND t.delegated_to = ?";
      args.push(delegatedTo);
    }

    if (hasAgent === 'true') {
      query += " AND t.delegated_to IS NOT NULL";
    }

    if (start && end) {
      query += ` AND (
        (t.scheduled_at IS NOT NULL AND t.scheduled_at >= ? AND t.scheduled_at <= ?)
        OR (t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?)
      )`;
      args.push(start, end, start, end);
    }

    if (completedSince && status === "completed") {
      const daysMap: Record<string, string> = {
        "1d": "-1 days",
        "7d": "-7 days",
        "30d": "-30 days",
        "90d": "-90 days",
      };
      const offset = daysMap[completedSince] || "-7 days";
      query += ` AND t.completed_at >= datetime('now', ?)`;
      args.push(offset);
    }

    const queryLimit = parseInt(searchParams.get("limit") || "50", 10);
    const clampedLimit = Math.min(Math.max(1, queryLimit), 500);
    const queryOffset = parseInt(searchParams.get("offset") || "0", 10);
    const clampedOffset = Math.max(0, queryOffset);

    query += `
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
      LIMIT ? OFFSET ?
    `;
    args.push(clampedLimit, clampedOffset);

    const tasks = await queryAll<Task & { project_name?: string; note_title?: string; note_slug?: string }>(query, args);

    return NextResponse.json({ tasks, hasMore: tasks.length === clampedLimit });
  } catch (error) {
    console.error("[API] GET /api/tasks failed:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

// POST /api/tasks - Create a new task
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      content,
      status = "pending",
      priority = "medium",
      projectId,
      noteId,
      dueDate,
      delegatedTo,
      autoExecute,
      recurrenceRule,
      recurrenceEndDate,
    } = body;

    if (!content?.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const today = new Date().toISOString().split('T')[0];
    const parsed = await parseTaskNL(content.trim(), today, user.id);

    const finalTitle = parsed?.title || content.trim();
    const finalDueDate = dueDate || parsed?.dueDate || null;
    const finalPriority = (priority !== 'medium') ? priority : (parsed?.priority || 'medium');

    const task = await mutate<Task>(
      `INSERT INTO tasks (user_id, content, status, priority, project_id, note_id, due_date,
                         delegated_to, recurrence_rule, recurrence_end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        user.id,
        finalTitle,
        delegatedTo && autoExecute ? "in_progress" : status,
        finalPriority,
        projectId || null,
        noteId || null,
        finalDueDate,
        delegatedTo || null,
        recurrenceRule || null,
        recurrenceEndDate || null,
      ]
    );

    if (delegatedTo && autoExecute && task) {
      const title = finalTitle.split('\n')[0].slice(0, 60);
      const description = content.trim();

      const agentTask = await mutate<{ id: string }>(
        `INSERT INTO agent_tasks (
           user_id, task_id, title, description,
           task_type, assigned_agent, status, priority
         )
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
         RETURNING id`,
        [
          user.id,
          task.id,
          title,
          description,
          delegatedTo,
          delegatedTo,
          finalPriority,
        ]
      );

      if (agentTask) {
        await db.execute({
          sql: "UPDATE tasks SET agent_task_id = ? WHERE id = ?",
          args: [agentTask.id, task.id],
        });
      }
    }

    return NextResponse.json({ task, parsed }, { status: 201 });
  } catch (error) {
    console.error("[API] POST /api/tasks failed:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
