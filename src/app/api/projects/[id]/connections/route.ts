import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface NoteConnection {
  id: string;
  source_note_id: string;
  target_note_id: string;
  connection_type: string;
  strength: number;
  reason: string | null;
  is_manual: boolean;
  source_title: string;
  target_title: string;
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

  const connections = await queryAll<NoteConnection>(
    `SELECT nc.*,
      n1.title as source_title,
      n2.title as target_title
    FROM note_connections nc
    JOIN notes n1 ON nc.source_note_id = n1.id
    JOIN notes n2 ON nc.target_note_id = n2.id
    WHERE n1.project_id = ?
      AND n2.project_id = ?
    ORDER BY nc.strength DESC`,
    [id, id]
  );

  return NextResponse.json({ connections });
}
