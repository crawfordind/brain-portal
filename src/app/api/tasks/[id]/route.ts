import { NextRequest, NextResponse } from "next/server";
import { db, queryOne, mutate } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Task } from "@/lib/db/schema";
import { spawnNextOccurrence } from "@/lib/tasks/complete";
import { safeParseJson, isErrorResponse, isValidTaskStatus, isValidPriority } from "@/lib/api/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/tasks/[id] - Get a single task
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const task = await queryOne<Task & { project_name?: string; note_title?: string }>(
      `SELECT t.*, p.name as project_name, n.title as note_title
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN notes n ON t.source_note_id = n.id
       WHERE t.id = ? AND t.user_id = ?`,
      [id, user.id]
    );

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error("[API] GET /api/tasks/[id] failed:", error);
    return NextResponse.json({ error: "Failed to fetch task" }, { status: 500 });
  }
}

// PATCH /api/tasks/[id] - Partial update (alias to PUT)
export async function PATCH(request: NextRequest, context: RouteParams) {
  return PUT(request, context);
}

// PUT /api/tasks/[id] - Update a task
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const existing = await queryOne<Task>(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const body = await safeParseJson(request);
    if (isErrorResponse(body)) return body;
    const updates: string[] = [];
    const args: (string | number | null)[] = [];

    if (body.status !== undefined && !isValidTaskStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (body.priority !== undefined && !isValidPriority(body.priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    if (body.content !== undefined) {
      updates.push("content = ?");
      args.push(typeof body.content === "string" ? body.content.trim() : String(body.content));
    }

    if (body.status !== undefined) {
      updates.push("status = ?");
      args.push(body.status as string);

      if (body.status === "completed" && existing.status !== "completed") {
        updates.push("completed_at = CURRENT_TIMESTAMP");
      } else if (body.status !== "completed" && existing.status === "completed") {
        updates.push("completed_at = NULL");
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

    if (body.dueDate !== undefined) {
      updates.push("due_date = ?");
      args.push((body.dueDate as string) || null);
    }

    if (body.scheduled_at !== undefined) {
      updates.push("scheduled_at = ?");
      args.push((body.scheduled_at as string) || null);
    }

    if (body.completed_at !== undefined) {
      updates.push("completed_at = ?");
      args.push((body.completed_at as string) || null);
    }

    if (body.recurrenceRule !== undefined) {
      updates.push("recurrence_rule = ?");
      args.push((body.recurrenceRule as string) || null);
    }

    if (body.recurrenceEndDate !== undefined) {
      updates.push("recurrence_end_date = ?");
      args.push((body.recurrenceEndDate as string) || null);
    }

    if (body.title !== undefined) {
      updates.push("title = ?");
      args.push(typeof body.title === "string" ? body.title.trim() || null : null);
    }

    if (body.description !== undefined) {
      updates.push("description = ?");
      args.push(typeof body.description === "string" ? body.description.trim() || null : null);
    }

    // Delegation used to be settable only at creation, so deciding later that
    // an agent should take something over was impossible from any surface.
    // `newlyDelegated` is computed before the UPDATE so the agent_task is
    // enqueued once, on the transition, and not again on every later save.
    const newlyDelegated =
      body.delegatedTo !== undefined &&
      body.delegatedTo &&
      body.delegatedTo !== existing.delegated_to;

    if (body.delegatedTo !== undefined) {
      updates.push("delegated_to = ?");
      args.push((body.delegatedTo as string) || null);

      // Taking the work back means the queued agent run no longer owns it.
      if (!body.delegatedTo) {
        updates.push("agent_task_id = NULL");
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ task: existing });
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    args.push(id, user.id);

    await db.execute({
      sql: `UPDATE tasks SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
      args,
    });

    const effectiveRule = body.recurrenceRule !== undefined ? (body.recurrenceRule as string | null) : existing.recurrence_rule;
    const effectiveEndDate = body.recurrenceEndDate !== undefined ? (body.recurrenceEndDate as string | null) : existing.recurrence_end_date;

    if (body.status === 'completed' && existing.status !== 'completed' && effectiveRule) {
      await spawnNextOccurrence(user.id, existing, effectiveRule, effectiveEndDate);
    }

    // Handing a task to an agent has to actually queue the work, the same way
    // creating an already-delegated task does. Setting the column alone would
    // make the UI claim an agent has it while nothing was ever enqueued.
    if (newlyDelegated && body.autoExecute) {
      const agentType = body.delegatedTo as string;
      const agentTask = await mutate<{ id: string }>(
        `INSERT INTO agent_tasks (
           user_id, task_id, title, description,
           task_type, assigned_agent, status, priority
         )
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
         RETURNING id`,
        [
          user.id,
          id,
          (existing.title || existing.content || "").split("\n")[0].slice(0, 60),
          existing.description || existing.content || "",
          agentType,
          agentType,
          (body.priority as string) || existing.priority,
        ]
      );

      if (agentTask) {
        await db.execute({
          sql: "UPDATE tasks SET agent_task_id = ?, status = 'in_progress' WHERE id = ? AND user_id = ?",
          args: [agentTask.id, id, user.id],
        });
      }
    }

    const task = await queryOne<Task>(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    return NextResponse.json({ task });
  } catch (error) {
    console.error("[API] PUT /api/tasks/[id] failed:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - Delete a task
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const existing = await queryOne<Task>(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    await db.execute({
      sql: "DELETE FROM tasks WHERE id = ? AND user_id = ?",
      args: [id, user.id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] DELETE /api/tasks/[id] failed:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
