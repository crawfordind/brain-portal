import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { shareErrorResponse } from "@/lib/sharing/http";
import { leaveShare } from "@/lib/sharing/store";

interface RouteParams {
  params: Promise<{ noteId: string }>;
}

// DELETE /api/shared-notes/[noteId] - remove a note someone shared with me from my list
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { noteId } = await params;
  try {
    const removed = await leaveShare(user.id, noteId);
    if (removed === 0) return NextResponse.json({ error: "Not shared with you" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return shareErrorResponse(error, "Failed to remove shared note");
  }
}
