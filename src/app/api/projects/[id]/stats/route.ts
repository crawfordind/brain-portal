import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ProjectStats {
  noteCount: number;
  taskCount: number;
  activeTasks: number;
  completedTasks: number;
  captureCount: number;
  agentTaskCount: number;
  recentActivityCount: number;
  subProjectCount: number;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const access = await getProjectAccess(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stats = await queryOne<ProjectStats>(
    `SELECT
      (SELECT COUNT(*) FROM notes WHERE project_id = ?) as noteCount,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ?) as taskCount,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status IN ('pending', 'in_progress')) as activeTasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'completed') as completedTasks,
      (SELECT COUNT(*) FROM captures WHERE user_id = ? AND linked_projects LIKE '%' || ? || '%') as captureCount,
      (SELECT COUNT(*) FROM agent_tasks WHERE project_id = ?) as agentTaskCount,
      (SELECT COUNT(*) FROM activity_log WHERE user_id = ? AND entity_type IN ('project', 'note', 'task') AND created_at > datetime('now', '-7 days')) as recentActivityCount,
      (SELECT COUNT(*) FROM projects WHERE parent_id = ?) as subProjectCount`,
    // recentActivityCount and captureCount are scoped to the caller. Unscoped,
    // they counted every user's rows, so a shared instance leaked how busy
    // other accounts were.
    [id, id, id, id, user.id, id, id, user.id, id]
  );

  if (!stats) {
    return NextResponse.json({
      stats: {
        noteCount: 0,
        taskCount: 0,
        activeTasks: 0,
        completedTasks: 0,
        captureCount: 0,
        agentTaskCount: 0,
        recentActivityCount: 0,
        subProjectCount: 0
      }
    });
  }

  return NextResponse.json({ stats });
}
