import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readBoard } from "@/lib/whiteboards/store";
import { whiteboardErrorResponse } from "@/lib/whiteboards/http";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/whiteboards/[id] - the board and its items.
// ?since=<version> returns only what changed after that version, plus every
// current item id, so an open canvas can follow other people's and agents'
// edits without reloading the whole board.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sinceRaw = request.nextUrl.searchParams.get("since");
  const since = sinceRaw !== null && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
  try {
    return NextResponse.json(await readBoard(id, user.id, since));
  } catch (error) {
    return whiteboardErrorResponse(error, "Failed to load the whiteboard");
  }
}
