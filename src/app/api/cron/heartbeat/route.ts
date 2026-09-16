import { NextRequest, NextResponse } from "next/server";
import { executeHeartbeatTick, cleanupHeartbeatLogs } from "@/lib/heartbeat/engine";
import { verifyCronSecret } from "@/lib/api/validation";

/**
 * Cron endpoint for the Heartbeat Scheduler
 *
 * Runs every 5 minutes. On each tick:
 * 1. Loads all enabled heartbeat tasks
 * 2. Evaluates which are due based on their schedule
 * 3. Runs checks (db_query, rule_eval, stale_check)
 * 4. Dispatches actions when conditions are met
 * 5. Logs all execution results
 *
 * Also cleans up logs older than 30 days once per run.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  try {
    const result = await executeHeartbeatTick();

    // Cleanup old logs periodically (cheap operation)
    let logsDeleted = 0;
    try {
      logsDeleted = await cleanupHeartbeatLogs(30);
    } catch {
      // Non-fatal
    }

    console.log(
      `[Heartbeat] Tick complete: ${result.tasksEvaluated} evaluated, ${result.tasksTriggered} triggered, ${result.tasksSkipped} skipped, ${result.errors.length} errors (${result.duration_ms}ms)`
    );

    return NextResponse.json({
      success: true,
      ...result,
      logs_cleaned: logsDeleted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Heartbeat] Fatal error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
