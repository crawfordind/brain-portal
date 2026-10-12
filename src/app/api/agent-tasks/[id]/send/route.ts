import { NextRequest, NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendTask } from "@/lib/agents/runtime/dispatcher";
import { actionErrorResponse, rateLimited } from "@/lib/agents/runtime/http";

/**
 * POST /api/agent-tasks/[id]/send — "Send" / "Retry".
 *
 * The explicit way parked, failed or cancelled work goes (back) to the
 * configured runtime. On Hermes, a
 * submission that never got an answer is re-sent under its original
 * idempotency key, so the agent continues the run it may already have started.
 * The work itself runs after the response.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimited(user.id, "send");
  if (limited) return limited;

  const { id } = await params;
  try {
    const outcome = await sendTask(id, user.id, { schedule: after });
    return NextResponse.json({ success: true, dispatch: outcome });
  } catch (error) {
    return actionErrorResponse(error, "send");
  }
}
