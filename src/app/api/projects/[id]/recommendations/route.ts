import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { TaskRecommendation } from "@/lib/db/schema";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
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

  const recommendations = await queryAll<TaskRecommendation>(
    `SELECT tr.*
    FROM task_recommendations tr
    WHERE tr.status = 'pending'
      AND tr.expires_at > datetime('now')
      AND (
        (tr.source_type = 'note' AND tr.source_id IN (SELECT id FROM notes WHERE project_id = ?))
        OR (tr.source_type = 'capture' AND tr.source_id IN (SELECT id FROM captures WHERE linked_projects LIKE '%' || ? || '%'))
      )
    ORDER BY tr.confidence DESC, tr.created_at DESC
    LIMIT 20`,
    [id, id]
  );

  return NextResponse.json({ recommendations });
}
