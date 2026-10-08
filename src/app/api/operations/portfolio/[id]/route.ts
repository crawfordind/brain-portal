import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { setLaneState } from "@/lib/operations/portfolio";
import type { LaneState } from "@/lib/operations/types";
import { opsErrorResponse } from "../../errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/operations/portfolio/[id] - `{ laneState: "reference" | null }`.
// Writes only `projects.metadata.ops.lane_state`; `status` is untouched.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  if (!("laneState" in body)) {
    return NextResponse.json({ error: "laneState is required (null clears it)" }, { status: 400 });
  }

  try {
    const result = await setLaneState(user.id, id, (body.laneState as LaneState | null) ?? null);
    return NextResponse.json(result);
  } catch (error) {
    return opsErrorResponse(error, "PATCH /api/operations/portfolio/[id]");
  }
}
