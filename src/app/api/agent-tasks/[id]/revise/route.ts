import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { executeAgentTask } from "@/lib/agents/executor";
import { syncTaskStatusFromAgentTask } from "@/lib/agents/status-sync";

// POST /api/agent-tasks/[id]/revise - Request revision
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
  const { feedback } = body;

  if (!feedback?.trim()) {
    return NextResponse.json(
      { error: "Feedback is required for revisions" },
      { status: 400 }
    );
  }

  const task = await queryOne<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "awaiting_review" && task.status !== "revision_requested") {
    return NextResponse.json(
      { error: "Task not available for revision" },
      { status: 400 }
    );
  }

  if (task.current_version >= task.max_revisions) {
    return NextResponse.json(
      { error: "Maximum revisions reached" },
      { status: 400 }
    );
  }

  // Record feedback
  await db.execute({
    sql: `
      INSERT INTO agent_task_feedback (agent_task_id, output_version, feedback_type, feedback_text)
      VALUES (?, ?, 'request_edit', ?)
    `,
    args: [id, task.current_version, feedback.trim()],
  });

  // Update task status
  await db.execute({
    sql: "UPDATE agent_tasks SET status = 'revision_requested', updated_at = datetime('now') WHERE id = ?",
    args: [id],
  });

  // Sync task status
  await syncTaskStatusFromAgentTask(id, 'revision_requested');

  // Execute revision
  executeAgentTask(id).catch((error) => {
    console.error("Error executing revision:", error);
  });

  return NextResponse.json({ success: true });
}
