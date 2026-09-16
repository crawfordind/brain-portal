import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Capture } from "@/lib/db/schema";
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

  // Scoped to the caller as well as the project: project access does not imply
  // access to another user's captures that happen to name the same project id.
  const captures = await queryAll<Capture>(
    `SELECT * FROM captures
    WHERE user_id = ? AND linked_projects LIKE '%' || ? || '%'
    ORDER BY captured_at DESC
    LIMIT 50`,
    [user.id, id]
  );

  return NextResponse.json({ captures });
}
