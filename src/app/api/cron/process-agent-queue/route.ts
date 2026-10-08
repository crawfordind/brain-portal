import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/api/validation';
import { runJackQueuePass } from '@/lib/agents/jack/dispatcher';

/**
 * The delegated-task worker. It used to execute every queued task through
 * OpenRouter; it now only moves work to and from Jack (Hermes), and cannot
 * reach OpenRouter at all.
 *
 * Each pass: adopt rows written by paths that do not know about Jack (MCP,
 * heartbeat, skills), hand queued tasks to Jack, re-send submissions that got
 * no answer (same idempotency key, so never twice), and poll runs in flight.
 * With Jack not configured it adopts and stops: nothing is sent or polled.
 *
 * Every call is a short HTTP request, so the run stays well inside its limit.
 */
export const maxDuration = 300;

const TIME_BUDGET_MS = (maxDuration - 45) * 1000;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  try {
    const report = await runJackQueuePass({}, { budgetMs: TIME_BUDGET_MS });
    const response = {
      success: true,
      runtime: 'jack',
      ...report,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
    // Counts only: task content never goes to logs.
    console.log('[Cron] Jack queue pass:', response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[Cron] Jack queue pass failed:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: 'Jack queue pass failed', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
