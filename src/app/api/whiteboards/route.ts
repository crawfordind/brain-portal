import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listBoards, readBoardForTarget } from "@/lib/whiteboards/store";
import { isMissingWhiteboardTables } from "@/lib/whiteboards/schema";
import { readJsonBody, whiteboardErrorResponse } from "@/lib/whiteboards/http";
import { isBoardScope } from "@/lib/whiteboards/types";

// GET /api/whiteboards - boards this account can open (?projectId=)
// GET /api/whiteboards?scope=project|note&id=… - one target's board, without creating it
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const scope = searchParams.get("scope");
  const id = searchParams.get("id");

  try {
    if (scope || id) {
      if (!isBoardScope(scope) || !id) {
        return NextResponse.json({ error: "scope must be project or note, with an id" }, { status: 400 });
      }
      return NextResponse.json(await readBoardForTarget({ scope, id }, user.id));
    }
    const boards = await listBoards(user.id, {
      projectId: searchParams.get("projectId") || undefined,
      limit: Number(searchParams.get("limit")) || undefined,
    });
    return NextResponse.json({ boards });
  } catch (error) {
    if (!scope && isMissingWhiteboardTables(error)) return NextResponse.json({ boards: [], notMigrated: true });
    return whiteboardErrorResponse(error, "Failed to load whiteboards");
  }
}

// POST /api/whiteboards - open a target's board, starting it if needed: { scope, id }
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await readJsonBody(request);
  if (!body || !isBoardScope(body.scope) || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "scope must be project or note, with an id" }, { status: 400 });
  }
  try {
    return NextResponse.json(await readBoardForTarget({ scope: body.scope, id: body.id }, user.id, { create: true }));
  } catch (error) {
    return whiteboardErrorResponse(error, "Failed to open the whiteboard");
  }
}
