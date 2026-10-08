import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRelationships } from "@/lib/operations/people";
import { opsErrorResponse } from "../errors";

// GET /api/operations/people?ventureId= - Who the user is in the middle of
// something with: what is owed each way, stage, last touch.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const ventureId = request.nextUrl.searchParams.get("ventureId");
    return NextResponse.json(await getRelationships(user.id, { ventureId }));
  } catch (error) {
    return opsErrorResponse(error, "GET /api/operations/people");
  }
}
