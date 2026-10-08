import { NextRequest, NextResponse } from "next/server";
import { db, queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTaskOutput, AgentTaskFeedback } from "@/lib/db/schema";
import { getTaskForUser, reconcileJackTask, type RunRow } from "@/lib/agents/jack/dispatcher";
import { publicJackStatus } from "@/lib/agents/jack/config";
import { checkJackRateLimit } from "@/lib/agents/jack/guard";
import { isActive, isJackState, POLLED_STATES, type PendingApproval } from "@/lib/agents/jack/types";

/** UI-triggered polls: short timeout so a slow Jack never stalls the page, and throttled. */
const UI_POLL = { timeoutMs: 4_000, minIntervalMs: 3_000 };

// GET /api/agent-tasks/[id] - Get task with outputs, feedback, Jack runs and audit trail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let task = await getTaskForUser(id, user.id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Ask Jack for fresh status while someone is looking, so the page does not
  // wait for the next cron pass. The cron keeps doing this when nobody is.
  if (
    task.runtime === "jack" &&
    isJackState(task.jack_state) &&
    POLLED_STATES.includes(task.jack_state) &&
    checkJackRateLimit(user.id, "poll").allowed
  ) {
    try {
      await reconcileJackTask(id, { timeoutMs: UI_POLL.timeoutMs }, { minIntervalMs: UI_POLL.minIntervalMs });
      task = (await getTaskForUser(id, user.id)) ?? task;
    } catch (error) {
      console.error("[API] on-demand Jack poll failed:", error instanceof Error ? error.message : error);
    }
  }

  const outputs = await queryAll<AgentTaskOutput>(
    "SELECT * FROM agent_task_outputs WHERE agent_task_id = ? ORDER BY version_number DESC",
    [id]
  );

  const feedback = await queryAll<AgentTaskFeedback>(
    "SELECT * FROM agent_task_feedback WHERE agent_task_id = ? ORDER BY created_at DESC",
    [id]
  );

  // Resolve context_note_ids into note objects with titles. Scoped to the
  // owner: the ids were stored from a request body.
  let contextNoteIds: string[] = [];
  try {
    const parsed = JSON.parse(task.context_note_ids || "[]");
    if (Array.isArray(parsed)) contextNoteIds = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* malformed data */
  }
  let contextNotes: Array<{ id: string; title: string; slug: string }> = [];
  if (contextNoteIds.length > 0) {
    const placeholders = contextNoteIds.map(() => "?").join(",");
    contextNotes = await queryAll<{ id: string; title: string; slug: string }>(
      `SELECT id, title, slug FROM notes WHERE user_id = ? AND id IN (${placeholders})`,
      [user.id, ...contextNoteIds]
    );
  }

  // Auto-retrieved notes (historical OpenRouter tasks only; Jack reads live over MCP)
  let contextUsed: Array<{ id: string; title: string; similarity: number }> = [];
  try {
    const parsed = JSON.parse(task.context_used || "[]");
    if (Array.isArray(parsed)) contextUsed = parsed;
  } catch {
    /* malformed data */
  }

  const sourceEntity = await resolveSourceEntity(user.id, task.source_type || "task", task.source_id || task.task_id);

  // Jack runs and the audit trail. Only reference ids and outcomes leave the
  // server: never the request body, tool arguments or credentials.
  const runs = task.runtime === "jack"
    ? await queryAll<RunRow>(
        "SELECT * FROM agent_task_runs WHERE agent_task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20",
        [id]
      )
    : [];
  const events = task.runtime === "jack"
    ? await queryAll<{ id: string; actor: string; kind: string; detail: string | null; run_id: string | null; created_at: string }>(
        "SELECT id, actor, kind, detail, run_id, created_at FROM agent_task_events WHERE agent_task_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 200",
        [id]
      )
    : [];

  let approval: PendingApproval | null = null;
  const pendingRun = runs.find((r) => r.state === "awaiting_approval" && r.approval);
  if (task.jack_state === "awaiting_approval" && pendingRun?.approval) {
    try {
      approval = JSON.parse(pendingRun.approval) as PendingApproval;
    } catch {
      approval = null;
    }
  }

  return NextResponse.json({
    task,
    outputs,
    feedback,
    contextNotes,
    contextUsed,
    sourceEntity,
    jack: {
      ...publicJackStatus(),
      approval,
      unreachableSince: runs[0]?.unreachable_since ?? null,
      runs: runs.map((r) => ({
        id: r.id,
        kind: r.kind,
        state: r.state,
        hermesRunId: r.hermes_run_id,
        hermesSessionId: r.hermes_session_id,
        outputVersion: r.output_version,
        model: r.runtime_model,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
      })),
      events: events.map((e) => ({
        id: e.id,
        actor: e.actor,
        kind: e.kind,
        runId: e.run_id,
        createdAt: e.created_at,
        detail: safeDetail(e.detail),
      })),
    },
  });
}

function safeDetail(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveSourceEntity(
  userId: string,
  sourceType: string,
  sourceId: string | null
): Promise<{ id: string; type: string; title: string; url: string } | null> {
  if (!sourceId) return null;
  switch (sourceType) {
    case "note":
    case "journal": {
      const note = await queryOne<{ id: string; title: string; slug: string }>(
        "SELECT id, title, slug FROM notes WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return note ? { id: note.id, type: "note", title: note.title, url: `/notes/${note.id}` } : null;
    }
    case "task": {
      const linked = await queryOne<{ id: string; title: string | null; content: string | null }>(
        "SELECT id, title, content FROM tasks WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return linked
        ? { id: linked.id, type: "task", title: linked.title || linked.content || "Task", url: `/tasks?task=${linked.id}` }
        : null;
    }
    case "capture":
    case "thought": {
      const capture = await queryOne<{ id: string; content: string }>(
        "SELECT id, content FROM captures WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return capture ? { id: capture.id, type: sourceType, title: capture.content.slice(0, 60), url: `/` } : null;
    }
    case "reminder": {
      const reminder = await queryOne<{ id: string; title: string }>(
        "SELECT id, title FROM reminders WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return reminder ? { id: reminder.id, type: "reminder", title: reminder.title, url: `/` } : null;
    }
    case "project": {
      const project = await queryOne<{ id: string; name: string; slug: string }>(
        "SELECT id, name, slug FROM projects WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return project ? { id: project.id, type: "project", title: project.name, url: `/projects/${project.slug}` } : null;
    }
    case "contact": {
      const contact = await queryOne<{ id: string; canonical_name: string }>(
        "SELECT id, canonical_name FROM entities WHERE id = ? AND user_id = ?",
        [sourceId, userId]
      );
      return contact ? { id: contact.id, type: "contact", title: contact.canonical_name, url: `/crm/${contact.id}` } : null;
    }
    default:
      return null;
  }
}

// DELETE /api/agent-tasks/[id] - Delete task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await getTaskForUser(id, user.id);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Deleting the record would not stop Jack. Stop it first, then delete.
  if (task.runtime === "jack" && isJackState(task.jack_state) && isActive(task.jack_state)) {
    return NextResponse.json(
      { error: "Jack is still working on this task. Cancel it first, then delete it." },
      { status: 409 }
    );
  }

  // Clean up related data before deleting
  await db.execute({
    sql: "DELETE FROM agent_task_feedback WHERE agent_task_id = ?",
    args: [id],
  });
  await db.execute({
    sql: "DELETE FROM agent_task_outputs WHERE agent_task_id = ?",
    args: [id],
  });
  if (task.runtime === "jack") {
    await db.execute({ sql: "DELETE FROM agent_task_events WHERE agent_task_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM agent_task_runs WHERE agent_task_id = ?", args: [id] });
  }
  // Clear the reference from the linked task
  await db.execute({
    sql: "UPDATE tasks SET agent_task_id = NULL, delegated_to = NULL WHERE agent_task_id = ? AND user_id = ?",
    args: [id, user.id],
  });
  await db.execute({
    sql: "DELETE FROM agent_tasks WHERE id = ? AND user_id = ?",
    args: [id, user.id],
  });

  return NextResponse.json({ success: true });
}
