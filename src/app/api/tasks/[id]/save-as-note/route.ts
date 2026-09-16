import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Task, AgentTask, AgentTaskOutput } from "@/lib/db/schema";

// POST /api/tasks/[id]/save-as-note - Convert AI task output to note
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    title,
    editedContent,
    projectId,
    tags = [],
  } = body;

  // Fetch the task
  const task = await queryOne<Task>(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!task.agent_task_id) {
    return NextResponse.json(
      { error: "Task is not an AI-delegated task" },
      { status: 400 }
    );
  }

  try {
    // Fetch agent task and output
    const agentTask = await queryOne<AgentTask>(
      "SELECT * FROM agent_tasks WHERE id = ?",
      [task.agent_task_id]
    );

    const agentOutput = await queryOne<AgentTaskOutput>(
      "SELECT * FROM agent_task_outputs WHERE agent_task_id = ? ORDER BY version_number DESC LIMIT 1",
      [task.agent_task_id]
    );

    if (!agentTask || !agentOutput) {
      return NextResponse.json(
        { error: "Agent output not found" },
        { status: 404 }
      );
    }

    // Parse linked notes
    const linkedNoteIds = JSON.parse(task.linked_note_ids || '[]') as string[];

    // Format note content with context preservation
    const noteContent = editedContent || formatNoteContent(
      task,
      agentTask,
      agentOutput,
      linkedNoteIds
    );

    // Create slug from title
    const slug = (title || task.title || task.content)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Create the note
    await db.execute({
      sql: `
        INSERT INTO notes
        (user_id, project_id, title, slug, content, note_type, tags, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        user.id,
        projectId || task.project_id,
        title || task.title || task.content,
        slug,
        noteContent,
        'note',
        JSON.stringify(tags),
        JSON.stringify({
          source: 'ai_task',
          task_id: task.id,
          agent_type: task.delegated_to,
          agent_task_id: task.agent_task_id,
          model: agentOutput.model_used,
          created_from_ai: true,
        }),
      ],
    });

    // Get the created note
    const note = await queryOne<{ id: string }>(
      "SELECT id FROM notes WHERE user_id = ? AND slug = ? ORDER BY created_at DESC LIMIT 1",
      [user.id, slug]
    );

    if (!note) {
      throw new Error("Failed to create note");
    }

    // Link note to task
    await db.execute({
      sql: "UPDATE tasks SET note_id = ?, updated_at = datetime('now') WHERE id = ?",
      args: [note.id, task.id],
    });

    return NextResponse.json({
      success: true,
      noteId: note.id,
      slug,
    });
  } catch (error) {
    console.error("Save-as-note error:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}

function formatNoteContent(
  task: Task,
  agentTask: AgentTask,
  agentOutput: AgentTaskOutput,
  linkedNoteIds: string[]
): string {
  const linkedNotesSection = linkedNoteIds.length > 0
    ? `\n## Context Notes\n${linkedNoteIds.map(id => `- [[${id}]]`).join('\n')}`
    : '';

  return `# ${task.title || task.content}

## AI Output

${agentOutput.content}

---

## Original Request

> ${task.description || task.title || task.content}

## Generation Details

- **Agent:** ${agentTask.assigned_agent}
- **Model:** ${agentOutput.model_used}
- **Generated:** ${new Date(agentOutput.created_at).toLocaleString()}
- **Processing Time:** ${agentOutput.processing_time_ms}ms
- **Version:** ${agentOutput.version_number}${linkedNotesSection}

## Related

- **Task ID:** \`${task.id}\`
${task.project_id ? `- **Project ID:** \`${task.project_id}\`` : ''}
`;
}
