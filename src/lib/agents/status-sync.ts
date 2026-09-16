/**
 * Status Sync Utility
 * Keeps source entities and agent_task status in sync
 */

import { db, queryOne } from "@/lib/db/client";
import { AgentTask } from "@/lib/db/schema";

/**
 * Sync source entity status when agent_task status changes.
 * For tasks: updates task status directly.
 * For other entities: no status sync needed (they don't have delegation status fields).
 */
export async function syncTaskStatusFromAgentTask(
  agentTaskId: string,
  agentTaskStatus: string
): Promise<void> {
  // First check if this agent_task is linked to a task (via task_id or source_type)
  const agentTask = await queryOne<AgentTask>(
    "SELECT source_type, task_id FROM agent_tasks WHERE id = ?",
    [agentTaskId]
  );

  if (!agentTask) return;

  const sourceType = agentTask.source_type || "task";

  // Only sync status for task-type entities
  if (sourceType === "task" || agentTask.task_id) {
    const taskStatus = mapAgentTaskStatusToTaskStatus(agentTaskStatus);
    await db.execute({
      sql: `
        UPDATE tasks
        SET status = ?,
            updated_at = datetime('now')
        WHERE agent_task_id = ?
      `,
      args: [taskStatus, agentTaskId],
    });
  }

  // For non-task entities, we don't modify the source entity's status
  // The agent_task's own status is sufficient for tracking
}

function mapAgentTaskStatusToTaskStatus(agentTaskStatus: string): string {
  switch (agentTaskStatus) {
    case 'queued':
    case 'processing':
    case 'revision_requested':
      return 'in_progress';
    case 'awaiting_review':
      return 'in_progress'; // Still needs user action
    case 'approved':
      return 'completed';
    case 'rejected':
    case 'failed':
      return 'pending'; // Return to user's queue
    default:
      return 'in_progress';
  }
}
