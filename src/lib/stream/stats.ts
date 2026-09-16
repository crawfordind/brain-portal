/**
 * The numbers the dashboard actually renders.
 *
 * This used to return seven counters — `totalTasks`, `totalNotes`,
 * `activeProjects`, `weeklyCaptures`, `aiTasksActive` — of which the page read
 * exactly one. Five queries ran on every home-page render to populate a stat
 * strip that had been deleted.
 *
 * What replaced them is deliberately narrow: a counter earns its place here
 * only if it represents something *waiting on the user right now*. "You have
 * 412 notes" is trivia; "two tasks are overdue" is a reason to open the app.
 */

import { db } from "@/lib/db/client";

export interface StreamStats {
  /** The one piece of pure encouragement, shown beside the date. */
  completedToday: number;
  overdueTasks: number;
  dueTodayTasks: number;
  /** Agent output sitting in `awaiting_review`. */
  awaitingReview: number;
}

const EMPTY_STATS: StreamStats = {
  completedToday: 0,
  overdueTasks: 0,
  dueTodayTasks: 0,
  awaitingReview: 0,
};

export async function getStreamStats(userId: string): Promise<StreamStats> {
  try {
    const results = await db.batch([
      {
        sql: `SELECT
                SUM(CASE WHEN status = 'completed' AND DATE(updated_at) = DATE('now')
                         THEN 1 ELSE 0 END) AS completedToday,
                SUM(CASE WHEN status IN ('pending', 'in_progress')
                          AND due_date IS NOT NULL
                          AND DATE(due_date) < DATE('now')
                         THEN 1 ELSE 0 END) AS overdueTasks,
                SUM(CASE WHEN status IN ('pending', 'in_progress')
                          AND due_date IS NOT NULL
                          AND DATE(due_date) = DATE('now')
                         THEN 1 ELSE 0 END) AS dueTodayTasks
              FROM tasks WHERE user_id = ?`,
        args: [userId],
      },
      {
        sql: `SELECT COUNT(*) AS awaitingReview FROM agent_tasks
              WHERE user_id = ? AND status = 'awaiting_review'`,
        args: [userId],
      },
    ]);

    const taskRow = results[0].rows[0] as Record<string, number> | undefined;
    const agentRow = results[1].rows[0] as Record<string, number> | undefined;

    return {
      completedToday: Number(taskRow?.completedToday) || 0,
      overdueTasks: Number(taskRow?.overdueTasks) || 0,
      dueTodayTasks: Number(taskRow?.dueTodayTasks) || 0,
      awaitingReview: Number(agentRow?.awaitingReview) || 0,
    };
  } catch (error) {
    console.error("Stream stats fetch failed:", error);
    return EMPTY_STATS;
  }
}
