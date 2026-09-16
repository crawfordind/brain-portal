import { NextRequest, NextResponse } from 'next/server';
import { queryAll, db } from '@/lib/db/client';
import { executeAgentTask } from '@/lib/agents/executor';
import { verifyCronSecret } from '@/lib/api/validation';

// Agent runs are LLM-bound (tens of seconds each). Without an explicit
// maxDuration this route inherits the platform default and gets killed
// mid-flight, stranding whatever it was running in 'processing'.
export const maxDuration = 300;

// Stop starting new work once we are this close to the function ceiling, so the
// run can finish its bookkeeping instead of being terminated mid-task.
const TIME_BUDGET_MS = (maxDuration - 45) * 1000;

// How long a task may sit in 'processing' before we assume its worker died.
const STUCK_TIMEOUT_MINUTES = 10;

// A revision fired off by the API route lands in 'revision_requested'. If that
// request's background execution never ran, nothing else ever picks the task
// up — 'revision_requested' is neither 'queued' nor 'processing'. Give the
// in-request execution a grace period, then recover it here.
const REVISION_GRACE_MINUTES = 5;

// Failed tasks are retried with backoff until the retry budget is spent.
const FAILED_RETRY_BACKOFF_MINUTES = 5;

// Number of tasks to start per run. The executor's atomic claim makes
// overlapping runs safe, but a small batch keeps each run inside its budget.
const BATCH_SIZE = 5;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    processed: 0,
    failed: 0,
    skipped: 0,
    stuck_reset: 0,
    revisions_recovered: 0,
    failures_requeued: 0,
    errors: [] as string[],
  };

  try {
    // ── STEP 1: Reset tasks stuck in 'processing' (worker died mid-run) ──
    const stuckTasks = await queryAll<{
      id: string;
      title: string;
      updated_at: string;
      retry_count: number;
      max_retries: number;
    }>(
      `SELECT id, title, updated_at,
              COALESCE(retry_count, 0) as retry_count,
              COALESCE(max_retries, 3) as max_retries
       FROM agent_tasks
       WHERE status = 'processing'
       AND datetime(updated_at) < datetime('now', ?)
       LIMIT 20`,
      [`-${STUCK_TIMEOUT_MINUTES} minutes`]
    );

    if (stuckTasks.length > 0) {
      console.log(`[Cron] Found ${stuckTasks.length} stuck tasks (processing > ${STUCK_TIMEOUT_MINUTES} min)`);

      for (const task of stuckTasks) {
        const newRetryCount = task.retry_count + 1;

        if (newRetryCount > task.max_retries) {
          console.log(`[Cron] Max retries exceeded for: ${task.title} (${newRetryCount}/${task.max_retries})`);

          await db.execute({
            sql: `UPDATE agent_tasks
                  SET status = 'failed',
                      retry_count = ?,
                      last_error = 'Max retries exceeded after timeout',
                      updated_at = datetime('now')
                  WHERE id = ? AND status = 'processing'`,
            args: [newRetryCount, task.id],
          });

          results.failed++;
        } else {
          console.log(`[Cron] Resetting stuck task: ${task.title} (retry ${newRetryCount}/${task.max_retries})`);

          await db.execute({
            sql: `UPDATE agent_tasks
                  SET status = 'queued',
                      retry_count = ?,
                      last_error = 'Timeout - retrying',
                      updated_at = datetime('now')
                  WHERE id = ? AND status = 'processing'`,
            args: [newRetryCount, task.id],
          });

          results.stuck_reset++;
        }
      }
    }

    // ── STEP 2: Recover abandoned revisions ──
    const abandonedRevisions = await db.execute({
      sql: `UPDATE agent_tasks
            SET status = 'queued', updated_at = datetime('now')
            WHERE status = 'revision_requested'
            AND datetime(updated_at) < datetime('now', ?)`,
      args: [`-${REVISION_GRACE_MINUTES} minutes`],
    });
    results.revisions_recovered = abandonedRevisions?.rowsAffected ?? 0;
    if (results.revisions_recovered > 0) {
      console.log(`[Cron] Recovered ${results.revisions_recovered} abandoned revision(s)`);
    }

    // ── STEP 3: Re-queue failed tasks that still have retry budget ──
    // Transient upstream errors (429s, gateway blips) used to be terminal:
    // nothing ever looked at 'failed' again, so retry_count/max_retries were
    // dead columns for anything other than timeouts.
    const requeued = await db.execute({
      sql: `UPDATE agent_tasks
            SET status = 'queued', updated_at = datetime('now')
            WHERE status = 'failed'
            AND COALESCE(retry_count, 0) < COALESCE(max_retries, 3)
            AND datetime(updated_at) < datetime('now', ?)
            AND datetime(updated_at) > datetime('now', '-1 day')`,
      args: [`-${FAILED_RETRY_BACKOFF_MINUTES} minutes`],
    });
    results.failures_requeued = requeued?.rowsAffected ?? 0;
    if (results.failures_requeued > 0) {
      console.log(`[Cron] Re-queued ${results.failures_requeued} failed task(s) with retry budget left`);
    }

    // ── STEP 4: Process queued tasks ──
    const queuedTasks = await queryAll<{ id: string; title: string }>(
      `SELECT id, title FROM agent_tasks
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT ?`,
      [BATCH_SIZE]
    );

    console.log(`[Cron] Found ${queuedTasks.length} queued agent tasks`);

    for (const task of queuedTasks) {
      // Leave the remaining tasks for the next run rather than being killed
      // partway through one and stranding it in 'processing' for 10 minutes.
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        results.skipped = queuedTasks.length - (results.processed + results.failed);
        console.log(`[Cron] Time budget reached — deferring ${results.skipped} task(s) to the next run`);
        break;
      }

      try {
        console.log(`[Cron] Processing task: ${task.title} (${task.id})`);
        await executeAgentTask(task.id);
        results.processed++;
        console.log(`[Cron] ✓ Successfully processed: ${task.title}`);
      } catch (error) {
        results.failed++;
        const errorMsg = `Failed to process ${task.title}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        const errorStack = error instanceof Error ? error.stack : undefined;
        results.errors.push(errorMsg);
        console.error(`[Cron] ✗ ${errorMsg}`);
        if (errorStack) {
          console.error(`[Cron] Stack trace:`, errorStack);
        }

        // The executor already recorded the failure (with the precise error and
        // an incremented retry_count). Only act as a safety net for the case
        // where it threw before it could mark the row.
        await db.execute({
          sql: `UPDATE agent_tasks
                SET status = 'failed',
                    retry_count = COALESCE(retry_count, 0) + 1,
                    last_error = ?,
                    updated_at = datetime('now')
                WHERE id = ? AND status = 'processing'`,
          args: [errorMsg, task.id],
        });
      }
    }

    const duration = Date.now() - startTime;
    const response = {
      success: true,
      stuck_reset: results.stuck_reset,
      revisions_recovered: results.revisions_recovered,
      failures_requeued: results.failures_requeued,
      processed: results.processed,
      failed: results.failed,
      skipped: results.skipped,
      total: queuedTasks.length,
      duration_ms: duration,
      errors: results.errors,
      timestamp: new Date().toISOString(),
    };

    console.log(`[Cron] Completed in ${duration}ms:`, response);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Cron] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
