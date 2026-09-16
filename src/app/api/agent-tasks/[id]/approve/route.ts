import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";
import { syncTaskStatusFromAgentTask } from "@/lib/agents/status-sync";

// POST /api/agent-tasks/[id]/approve - Approve current output
export async function POST(
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

  if (task.status !== "awaiting_review") {
    return NextResponse.json(
      { error: "Task not awaiting review" },
      { status: 400 }
    );
  }

  // Record feedback
  await db.execute({
    sql: `
      INSERT INTO agent_task_feedback (agent_task_id, output_version, feedback_type)
      VALUES (?, ?, 'approve')
    `,
    args: [id, task.current_version],
  });

  // Update task status
  await db.execute({
    sql: "UPDATE agent_tasks SET status = 'approved', updated_at = datetime('now') WHERE id = ?",
    args: [id],
  });

  // Sync task status
  await syncTaskStatusFromAgentTask(id, 'approved');

  return NextResponse.json({ success: true });
}
