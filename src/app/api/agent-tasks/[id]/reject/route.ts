import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { syncTaskStatusFromAgentTask } from "@/lib/agents/status-sync";

// POST /api/agent-tasks/[id]/reject - Reject and close task
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
  const { reason } = body;

  const task = await queryOne<AgentTask>(
    "SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Record feedback
  await db.execute({
    sql: `
      INSERT INTO agent_task_feedback (agent_task_id, output_version, feedback_type, feedback_text)
      VALUES (?, ?, 'reject', ?)
    `,
    args: [id, task.current_version, reason || null],
  });

  // Update task status
  await db.execute({
    sql: "UPDATE agent_tasks SET status = 'rejected', updated_at = datetime('now') WHERE id = ?",
    args: [id],
  });

  // Sync task status
  await syncTaskStatusFromAgentTask(id, 'rejected');

  return NextResponse.json({ success: true });
}
