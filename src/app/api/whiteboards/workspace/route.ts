import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { projectWorkspace } from "@/lib/whiteboards/store";
import { whiteboardErrorResponse } from "@/lib/whiteboards/http";

// GET /api/whiteboards/workspace?projectId=… - the tabs of a project's
// whiteboard space: the project's own board, then one per note.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  try {
    return NextResponse.json(await projectWorkspace(projectId, user.id));
  } catch (error) {
    return whiteboardErrorResponse(error, "Failed to load the whiteboard space");
  }
}
