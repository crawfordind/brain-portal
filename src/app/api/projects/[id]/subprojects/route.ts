import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SubProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  color: string | null;
  icon: string | null;
  priority: number;
  parent_id: string;
  note_count: number;
  open_task_count: number;
  created_at: string;
  updated_at: string;
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

  // Aggregate counts once per related table rather than running a correlated
  // scalar subquery for every subproject row (N+1 elimination).
  const subprojects = await queryAll<SubProject>(
    `SELECT p.*,
      COALESCE(nc.note_count, 0) as note_count,
      COALESCE(tc.open_task_count, 0) as open_task_count
    FROM projects p
    LEFT JOIN (
      SELECT project_id, COUNT(*) as note_count
      FROM notes
      WHERE project_id IS NOT NULL
      GROUP BY project_id
    ) nc ON nc.project_id = p.id
    LEFT JOIN (
      SELECT project_id, COUNT(*) as open_task_count
      FROM tasks
      WHERE project_id IS NOT NULL AND status != 'completed'
      GROUP BY project_id
    ) tc ON tc.project_id = p.id
    WHERE p.parent_id = ?
    ORDER BY p.name ASC`,
    [id]
  );

  return NextResponse.json({ subprojects });
}
