import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveJackApproval } from "@/lib/agents/jack/dispatcher";
import { actionErrorResponse, rateLimited, readJsonBody } from "@/lib/agents/jack/http";
import { isApprovalChoice } from "@/lib/agents/jack/types";
import { isErrorResponse } from "@/lib/api/validation";

/**
 * POST /api/agent-tasks/[id]/approval — `{ choice: "once" | "deny", requestId }`
 *
 * Resolves the gated tool call Jack is paused on. Only "once" and "deny":
 * Hermes's "session" and "always" widen Jack's standing permissions, which is
 * a decision for Hermes's own config, never a side effect of one task.
 * `requestId` must match the request Daniel was shown.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimited(user.id, "approval");
  if (limited) return limited;

  const body = await readJsonBody(request, 4 * 1024);
  if (isErrorResponse(body)) return body;
  if (!isApprovalChoice(body.choice)) {
    return NextResponse.json({ error: 'choice must be "once" or "deny"' }, { status: 400 });
  }
  const requestId =
    typeof body.requestId === "string" && body.requestId.length <= 256 ? body.requestId : null;

  const { id } = await params;
  try {
    await resolveJackApproval(id, user.id, body.choice, requestId);
    return NextResponse.json({ success: true, choice: body.choice });
  } catch (error) {
    return actionErrorResponse(error, "approval");
  }
}
