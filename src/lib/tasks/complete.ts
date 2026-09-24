/**
 * Completing a task from somewhere other than the task panel.
 *
 * A recurring task spawns its next occurrence when it is completed. The task
 * route did that inline, so any second completion path (an email button) would
 * either have to copy it or silently stop recurring tasks from recurring.
 */

import { db, queryOne } from "@/lib/db/client";
import type { Task } from "@/lib/db/schema";
import { getNextOccurrence } from "@/lib/tasks/recurrence";

/** Insert the next occurrence of a recurring task. No-op past its end date. */
export async function spawnNextOccurrence(
  userId: string,
  task: Pick<Task, "id" | "content" | "priority" | "project_id" | "note_id" | "tags">,
  rule: string,
  endDate: string | null
): Promise<void> {
  const next = getNextOccurrence(rule, new Date(), endDate);
  if (!next) return;

  await db.execute({
    sql: `
      INSERT INTO tasks
        (user_id, content, status, priority, project_id, note_id, due_date,
         recurrence_rule, recurrence_end_date, parent_task_id, tags)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      userId,
      task.content,
      task.priority,
      task.project_id || null,
      task.note_id || null,
      next.toISOString().split("T")[0],
      rule,
      endDate || null,
      task.id,
      task.tags || "[]",
    ],
  });
}

export type CompleteTaskResult =
  | { status: "completed"; task: Task; previousStatus: Task["status"] }
  | { status: "already_completed"; task: Task }
  | { status: "not_found" };

/**
 * Mark a task complete. Safe to call twice: the UPDATE is conditional on the
 * task not already being complete, so a repeated click — or a mail scanner
 * following the link first — can never spawn a second recurrence.
 */
export async function completeTask(userId: string, taskId: string): Promise<CompleteTaskResult> {
  const existing = await queryOne<Task>(
    "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    [taskId, userId]
  );
  if (!existing) return { status: "not_found" };
  if (existing.status === "completed") return { status: "already_completed", task: existing };

  const result = await db.execute({
    sql: `UPDATE tasks
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND status != 'completed'`,
    args: [taskId, userId],
  });

  if (result.rowsAffected === 0) {
    return { status: "already_completed", task: { ...existing, status: "completed" } };
  }

  if (existing.recurrence_rule) {
    await spawnNextOccurrence(userId, existing, existing.recurrence_rule, existing.recurrence_end_date);
  }

  return {
    status: "completed",
    task: { ...existing, status: "completed" },
    previousStatus: existing.status,
  };
}
