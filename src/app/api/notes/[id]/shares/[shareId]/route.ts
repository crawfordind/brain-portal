import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNoteAccess } from "@/lib/sharing/access";
import { shareErrorResponse } from "@/lib/sharing/http";
import { revokeShare, updateSharePermission } from "@/lib/sharing/store";

interface RouteParams {
  params: Promise<{ id: string; shareId: string }>;
}

// PATCH /api/notes/[id]/shares/[shareId] - change permission: { permission }
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, shareId } = await params;
  const access = await getNoteAccess(id, user.id);
  if (access?.role !== "owner") return NextResponse.json({ error: "Note not found" }, { status: 404 });

  let body: { permission?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const share = await updateSharePermission(user.id, access.note.id, shareId, body.permission);
    return NextResponse.json({ share });
  } catch (error) {
    return shareErrorResponse(error, "Failed to update share");
  }
}

// DELETE /api/notes/[id]/shares/[shareId] - revoke. Revoking twice is not an error.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, shareId } = await params;
  const access = await getNoteAccess(id, user.id);
  if (access?.role !== "owner") return NextResponse.json({ error: "Note not found" }, { status: 404 });

  try {
    const removed = await revokeShare(user.id, access.note.id, { shareId });
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    return shareErrorResponse(error, "Failed to revoke share");
  }
}
