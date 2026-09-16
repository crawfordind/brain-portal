import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Insight } from "@/lib/db/schema";
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

  const insights = await queryAll<Insight>(
    `SELECT DISTINCT i.*
    FROM insights i
    WHERE i.is_dismissed = 0
      AND (
        EXISTS (
          SELECT 1 FROM notes n
          WHERE n.project_id = ?
            AND i.source_notes LIKE '%' || n.id || '%'
        )
        OR (
          i.metadata LIKE '%"alert_type":"project_health"%'
          AND i.metadata LIKE '%"project_id":"' || ? || '"%'
        )
      )
    ORDER BY i.generated_at DESC
    LIMIT 50`,
    [id, id]
  );

  return NextResponse.json({ insights });
}
