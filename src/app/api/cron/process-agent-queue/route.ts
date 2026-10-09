import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/api/validation';
import { runQueuePass } from '@/lib/agents/runtime/dispatcher';

/**
 * The delegated-task worker, for whichever runtime `AGENT_RUNTIME` selects.
 *
 * Each pass: adopt rows written by paths that do not know about the lifecycle
 * (MCP, heartbeat, skills), run or hand over queued tasks, and then, per
 * runtime: on OpenRouter, re-queue work that died mid-call or failed with
 * retry budget left; on Hermes, re-send submissions that got no answer (same
 * idempotency key, so never twice) and poll runs in flight. With delegation
 * off or misconfigured it adopts and stops: nothing is sent or polled.
 *
 * The pass stops starting new work near the function ceiling, so it is never
 * killed with a batch half-done.
 */
export const maxDuration = 300;

const TIME_BUDGET_MS = (maxDuration - 45) * 1000;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  try {
    const report = await runQueuePass({}, { budgetMs: TIME_BUDGET_MS });
    const response = {
      success: true,
      ...report,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    // Counts only: task content never goes to logs.
    console.log('[Cron] agent queue pass:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[Cron] agent queue pass failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: 'Agent queue pass failed', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
