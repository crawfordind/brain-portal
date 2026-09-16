/**
 * System Health API
 *
 * GET  /api/system-health  — why background work isn't happening, in plain language
 * POST /api/system-health  — { action: "retry_agent_tasks" } re-queue this user's failed agent tasks
 *
 * Exists so failures in the agentic layer stop being invisible. Everything it
 * returns is scoped to the calling user, plus presence-only checks on server
 * configuration (never values).
 */

import { NextRequest, NextResponse } from "next/server";
import { db, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getSystemHealth } from "@/lib/system-health";
import { executeAgentTask } from "@/lib/agents/executor";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const health = await getSystemHealth(user.id);
    return NextResponse.json(health, {
      // Polled from the header on every page; never let a proxy pin a stale answer.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[API] GET /api/system-health failed:", error);
    return NextResponse.json(
      { error: "Failed to check system health" },
      { status: 500 }
    );
  }
}

/** Retry cap per request, so one click can't fan out into unbounded model spend. */
const MAX_RETRY_BATCH = 10;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  const action = body.action as string | undefined;
  if (action !== "retry_agent_tasks") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const requestedId = body.agentTaskId as string | undefined;

  try {
    // Only the caller's own failed tasks are eligible. The retry budget is reset
    // because the user is explicitly asking for another attempt after (they
    // hope) the underlying cause was fixed.
    const candidates = await queryAll<{ id: string }>(
      requestedId
        ? `SELECT id FROM agent_tasks
            WHERE user_id = ? AND status = 'failed' AND id = ?`
        : `SELECT id FROM agent_tasks
            WHERE user_id = ? AND status = 'failed'
            ORDER BY updated_at DESC
            LIMIT ${MAX_RETRY_BATCH}`,
      requestedId ? [user.id, requestedId] : [user.id]
    );

    if (candidates.length === 0) {
      return NextResponse.json({ requeued: 0, message: "Nothing to retry" });
    }

    for (const candidate of candidates) {
      await db.execute({
        sql: `UPDATE agent_tasks
                 SET status = 'queued',
                     retry_count = 0,
                     updated_at = datetime('now')
               WHERE id = ? AND user_id = ? AND status = 'failed'`,
        args: [candidate.id, user.id],
      });

      // Fire-and-forget, exactly as delegation does. The executor's atomic claim
      // makes this safe alongside the cron worker, and the cron remains the
      // safety net if this request's background work is cut short.
      executeAgentTask(candidate.id).catch((error) => {
        console.error(`[SystemHealth] retry of ${candidate.id} failed:`, error);
      });
    }

    return NextResponse.json({ requeued: candidates.length });
  } catch (error) {
    console.error("[API] POST /api/system-health failed:", error);
    return NextResponse.json({ error: "Failed to retry" }, { status: 500 });
  }
}
