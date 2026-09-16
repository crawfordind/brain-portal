import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface Activity {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: string;
  created_at: string;
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

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const activities = await queryAll<Activity>(
    `SELECT * FROM activity_log
    WHERE (
        (entity_type = 'project' AND entity_id = ?)
        OR (entity_type = 'note' AND entity_id IN (SELECT id FROM notes WHERE project_id = ?))
        OR (entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE project_id = ?))
      )
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?`,
    [id, id, id, limit, offset]
  );

  return NextResponse.json({ activities, limit, offset });
}
