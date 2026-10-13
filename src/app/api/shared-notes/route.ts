import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { shareErrorResponse } from "@/lib/sharing/http";
import { listSharedWithMe } from "@/lib/sharing/store";
import { isMissingNoteSharesTable } from "@/lib/sharing/schema";

// GET /api/shared-notes - notes other accounts have shared with me
//
// Not under /api/notes/: that segment is also `/api/notes/[slug]`, and a note
// titled "Shared with me" would have become unreachable by its slug.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const includeArchived = request.nextUrl.searchParams.get("archived") === "true";
  try {
    const notes = await listSharedWithMe(user.id, { includeArchived });
    return NextResponse.json({ notes });
  } catch (error) {
    if (isMissingNoteSharesTable(error)) return NextResponse.json({ notes: [] });
    return shareErrorResponse(error, "Failed to load shared notes");
  }
}
