import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendToJack } from "@/lib/agents/jack/dispatcher";
import { actionErrorResponse, rateLimited } from "@/lib/agents/jack/http";

/**
 * POST /api/agent-tasks/[id]/send — "Send to Jack" / "Retry".
 *
 * The explicit way parked, failed or cancelled work goes (back) to Jack. A
 * submission that never got an answer is re-sent under its original
 * idempotency key, so Jack continues the run it may already have started.
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
    const outcome = await sendToJack(id, user.id);
    return NextResponse.json({ success: true, dispatch: outcome });
  } catch (error) {
    return actionErrorResponse(error, "send");
  }
}
