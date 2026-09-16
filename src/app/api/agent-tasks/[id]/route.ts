import { NextRequest, NextResponse } from "next/server";
import { db, queryOne, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask, AgentTaskOutput, AgentTaskFeedback } from "@/lib/db/schema";

// GET /api/agent-tasks/[id] - Get task with outputs and feedback
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await queryOne<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Fetch outputs
  const outputs = await queryAll<AgentTaskOutput>(
    "SELECT * FROM agent_task_outputs WHERE agent_task_id = ? ORDER BY version_number DESC",
    [id]
  );

  // Fetch feedback
  const feedback = await queryAll<AgentTaskFeedback>(
    "SELECT * FROM agent_task_feedback WHERE agent_task_id = ? ORDER BY created_at DESC",
    [id]
  );

  // Resolve context_note_ids into note objects with titles
  const contextNoteIds = JSON.parse(task.context_note_ids || '[]') as string[];
  let contextNotes: Array<{ id: string; title: string; slug: string }> = [];
  if (contextNoteIds.length > 0) {
    const placeholders = contextNoteIds.map(() => '?').join(',');
    contextNotes = await queryAll<{ id: string; title: string; slug: string }>(
      `SELECT id, title, slug FROM notes WHERE id IN (${placeholders})`,
      contextNoteIds
    );
  }

  // Parse context_used (auto-retrieved notes)
  const contextUsed = JSON.parse(task.context_used || '[]') as Array<{
    id: string;
    title: string;
    similarity: number;
  }>;

  // Resolve source entity for bidirectional linking
  let sourceEntity: { id: string; type: string; title: string; url: string } | null = null;
  const sourceType = (task as any).source_type || 'task';
  const sourceId = (task as any).source_id || task.task_id;

  if (sourceId) {
    switch (sourceType) {
      case 'note': {
        const note = await queryOne<{ id: string; title: string; slug: string }>(
          "SELECT id, title, slug FROM notes WHERE id = ?",
          [sourceId]
        );
        if (note) {
          sourceEntity = { id: note.id, type: 'note', title: note.title, url: `/notes/${note.id}` };
        }
        break;
      }
      case 'task': {
        const linkedTask = await queryOne<{ id: string; title: string; content: string }>(
          "SELECT id, title, content FROM tasks WHERE id = ?",
          [sourceId]
        );
        if (linkedTask) {
          sourceEntity = { id: linkedTask.id, type: 'task', title: linkedTask.title || linkedTask.content, url: `/tasks` };
        }
        break;
      }
      case 'capture':
      case 'thought': {
        const capture = await queryOne<{ id: string; content: string }>(
          "SELECT id, content FROM captures WHERE id = ?",
          [sourceId]
        );
        if (capture) {
          sourceEntity = { id: capture.id, type: sourceType, title: capture.content.slice(0, 60), url: `/` };
        }
        break;
      }
      case 'reminder': {
        const reminder = await queryOne<{ id: string; title: string }>(
          "SELECT id, title FROM reminders WHERE id = ?",
          [sourceId]
        );
        if (reminder) {
          sourceEntity = { id: reminder.id, type: 'reminder', title: reminder.title, url: `/` };
        }
        break;
      }
    }
  }

  return NextResponse.json({ task, outputs, feedback, contextNotes, contextUsed, sourceEntity });
}

// DELETE /api/agent-tasks/[id] - Delete/cancel task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await queryOne<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
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
  // Clear the reference from the linked task
  await db.execute({
    sql: "UPDATE tasks SET agent_task_id = NULL, delegated_to = NULL WHERE agent_task_id = ?",
    args: [id],
  });
  await db.execute({
    sql: "DELETE FROM agent_tasks WHERE id = ?",
    args: [id],
  });

  return NextResponse.json({ success: true });
}
