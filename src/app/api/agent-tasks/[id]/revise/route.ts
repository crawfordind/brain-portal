import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requestJackRevision } from "@/lib/agents/jack/dispatcher";
import { INPUT_LIMITS } from "@/lib/agents/jack/guard";
import { actionErrorResponse, rateLimited, readJsonBody } from "@/lib/agents/jack/http";
import { isErrorResponse } from "@/lib/api/validation";

/**
 * POST /api/agent-tasks/[id]/revise — Daniel's reply to an output.
 *
 * Records the feedback and sends it to Jack as the next turn of the task's own
 * Hermes session. A historical OpenRouter task becomes a Jack task here; it
 * is never re-run on OpenRouter.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = rateLimited(user.id, "revise");
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (isErrorResponse(body)) return body;
  const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";

  if (!feedback) {
    return NextResponse.json(
      { error: "Feedback is required for revisions" },
      { status: 400 }
    );
  }
  if (feedback.length > INPUT_LIMITS.feedback) {
    return NextResponse.json(
      { error: `Feedback is limited to ${INPUT_LIMITS.feedback} characters` },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const outcome = await requestJackRevision(id, user.id, feedback);
    return NextResponse.json({ success: true, dispatch: outcome });
  } catch (error) {
    return actionErrorResponse(error, "revise");
  }
}
