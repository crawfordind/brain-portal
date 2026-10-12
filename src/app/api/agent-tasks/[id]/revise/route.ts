import { NextRequest, NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requestRevision } from "@/lib/agents/runtime/dispatcher";
import { INPUT_LIMITS } from "@/lib/agents/runtime/guard";
import { actionErrorResponse, rateLimited, readJsonBody } from "@/lib/agents/runtime/http";
import { isErrorResponse } from "@/lib/api/validation";

/**
 * POST /api/agent-tasks/[id]/revise — the user's reply to an output.
 *
 * Records the feedback and queues a new version on the configured runtime:
 * on Hermes, the next turn of the task's own session; on OpenRouter, a new
 * completion carrying the previous version and the feedback. The work runs
 * after the response.
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
    const outcome = await requestRevision(id, user.id, feedback, { schedule: after });
    return NextResponse.json({ success: true, dispatch: outcome });
  } catch (error) {
    return actionErrorResponse(error, "revise");
  }
}
