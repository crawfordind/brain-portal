import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { cancelTask } from "@/lib/agents/runtime/dispatcher";
import { actionErrorResponse, rateLimited } from "@/lib/agents/runtime/http";

/**
 * POST /api/agent-tasks/[id]/cancel
 *
 * Work the runtime never had is cancelled here and now. Work a Hermes agent
 * is doing gets a stop request; the task reads "Stopping" until the agent
 * confirms, because saying "Cancelled" before it has actually stopped would be
 * a lie. An OpenRouter call in flight cannot be stopped and is answered 409.
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
    const state = await cancelTask(id, user.id);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return actionErrorResponse(error, "cancel");
  }
}
