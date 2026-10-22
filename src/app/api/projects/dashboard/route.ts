import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getToday } from "@/lib/operations/queries";
import {
  buildProjectDashboard,
  type DashboardProjectRow,
  type DashboardTaskRow,
} from "@/lib/projects/dashboard";

/** Far above any real portfolio; keeps one request bounded. */
const MAX_TASKS = 10_000;

// GET /api/projects/dashboard - the project manager's view of the portfolio
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ today }, projects, tasks] = await Promise.all([
    getToday(user.id),
    queryAll<DashboardProjectRow>(
      `SELECT id, name, slug, status, color, parent_id, priority, created_at, updated_at
       FROM projects
       WHERE user_id = ? AND status NOT IN ('completed', 'archived')`,
      [user.id]
    ),
    queryAll<DashboardTaskRow>(
      `SELECT t.id, t.project_id, t.title, t.content, t.status, t.priority, t.due_date,
              t.completed_at, t.created_at, t.updated_at, t.metadata
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ? AND p.user_id = ? AND p.status NOT IN ('completed', 'archived')
       ORDER BY t.created_at DESC
       LIMIT ${MAX_TASKS}`,
      [user.id, user.id]
    ),
  ]);

  return NextResponse.json(buildProjectDashboard(projects, tasks, today));
}
