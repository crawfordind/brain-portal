import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cancelJackTask } from "@/lib/agents/jack/dispatcher";
import { actionErrorResponse, rateLimited } from "@/lib/agents/jack/http";

/**
 * POST /api/agent-tasks/[id]/cancel
 *
 * Work Jack never had is cancelled here and now. Work Jack is doing gets a
 * stop request; the task reads "Stopping" until Jack confirms, because saying
 * "Cancelled" before Jack has actually stopped would be a lie.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimited(user.id, "cancel");
  if (limited) return limited;

  const { id } = await params;
  try {
    const state = await cancelJackTask(id, user.id);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return actionErrorResponse(error, "cancel");
  }
}
