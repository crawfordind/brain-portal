import { NextRequest, NextResponse } from "next/server";
import { db, queryAll } from "@/lib/db/client";
import type { Capture } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/api/validation";
import { runJob, SERVERLESS_OPERATIONS, type QueueJob } from "@/lib/processing/processors";
import { sweepUnprocessedContent } from "@/lib/processing/sweep";

/**
 * GET /api/cron/process-queue
 *
 * Drains `processing_queue`: embeddings (search indexing), summaries, tags,
 * note connections, task scanning, link scraping, and new contacts and touch
 * points read out of notes and captures.
 *
 * Before draining, it sweeps for notes and captures that changed since they
 * were last processed and queues their pipeline (see src/lib/processing/sweep.ts),
 * so content is processed whichever path wrote it — MCP, agents and skills
 * included — and the jobs it queues are drained in the same run.
 *
 * Scheduled from vercel.json (every 5 minutes). For local testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/process-queue
 *
 * Attachment media jobs (thumbnails, PDF/Office text extraction, image
 * descriptions) are NOT handled here — see SERVERLESS_OPERATIONS for why. Run
 * `npx tsx scripts/process-queue.ts` for those.
 */

// Embedding and LLM calls take seconds each. Without an explicit maxDuration
// this route inherits the platform default and gets killed mid-batch, leaving
// jobs stranded in 'processing'.
export const maxDuration = 300;

// Stop claiming new jobs once we are this close to the ceiling, so the run can
// finish the job in hand instead of being terminated part-way through it.
const TIME_BUDGET_MS = (maxDuration - 45) * 1000;

// A job left in 'processing' by a killed run is invisible to every later run.
// Reclaim it once no plausible worker could still be holding it.
const STUCK_TIMEOUT_MINUTES = 15;

const LINK_BATCH_SIZE = 5;
// Sized for a sweep's worth of new work (up to five jobs per note) plus what the
// routes queued since the last run. The time budget, not this number, is what
// actually bounds a run.
const JOB_BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  let processed = 0;
  let errors = 0;
  let skipped = 0;

  try {
    console.log("[Cron] Processing queue...");

    // ── Recover jobs abandoned by a run that was killed mid-flight ──
    //
    // `attempts` is incremented at claim time and never decremented, so a job
    // whose worker died has already spent one of its retries. Returning it to
    // 'pending' unconditionally is therefore only correct while it has retries
    // left: once `attempts >= max_attempts` the claim query below — which
    // filters on `attempts < max_attempts` — can never select it again, and the
    // row sits in 'pending' forever. Nothing drains it, and the health check's
    // backlog probe counts it every time it runs, which is what produced a
    // permanent, unclearable "background work is not being picked up" alert on
    // an instance whose cron was in fact running normally.
    //
    // So a job that has exhausted its retries is retired to 'failed', where the
    // health check reports it as work that gave up and says why, instead of
    // being recycled into a queue that will never look at it.
    const retired = await db.execute({
      sql: `UPDATE processing_queue
            SET status = 'failed',
                completed_at = datetime('now'),
                error_message = COALESCE(
                  error_message,
                  'Worker stopped before the job finished, and no retries remain. '
                  || 'The run was most likely terminated at its time limit.'
                )
            WHERE status = 'processing'
            AND started_at < datetime('now', ?)
            AND attempts >= max_attempts`,
      args: [`-${STUCK_TIMEOUT_MINUTES} minutes`],
    });
    const stuckRetired = retired.rowsAffected;
    if (stuckRetired > 0) {
      console.log(`[Cron] Retired ${stuckRetired} stuck job(s) with no retries left`);
    }

    const reset = await db.execute({
      sql: `UPDATE processing_queue
            SET status = 'pending'
            WHERE status = 'processing'
            AND started_at < datetime('now', ?)
            AND attempts < max_attempts`,
      args: [`-${STUCK_TIMEOUT_MINUTES} minutes`],
    });
    const stuckReset = reset.rowsAffected;
    if (stuckReset > 0) {
      console.log(`[Cron] Reset ${stuckReset} stuck job(s) back to pending`);
    }

    // Jobs stranded in 'pending' with no retries left by an earlier build of
    // this route. Without this they stay invisible to the worker and visible to
    // the health check for the lifetime of the deployment.
    const strandedRetired = await db.execute({
      sql: `UPDATE processing_queue
            SET status = 'failed',
                completed_at = datetime('now'),
                error_message = COALESCE(
                  error_message,
                  'Job exhausted its retries without completing.'
                )
            WHERE status = 'pending'
            AND attempts >= max_attempts`,
      args: [],
    });
    if (strandedRetired.rowsAffected > 0) {
      console.log(
        `[Cron] Retired ${strandedRetired.rowsAffected} stranded job(s) left pending with no retries`
      );
    }

    // ── Find content no write path queued, so it is drained in this run ──
    const sweep = await sweepUnprocessedContent();
    if (sweep.jobsQueued > 0 || sweep.unchanged > 0) {
      console.log(
        `[Cron] Swept ${sweep.notesQueued} note(s) and ${sweep.capturesQueued} capture(s): ` +
          `${sweep.jobsQueued} job(s) queued, ${sweep.unchanged} unchanged`
      );
    }

    // ── Link scraping first: it feeds the embeddings below ──
    const linkJobs = await queryAll<QueueJob>(
      `SELECT id, user_id, entity_type, entity_id, operation, tier, metadata
       FROM processing_queue
       WHERE operation = 'link-scrape-and-embed'
       AND status = 'pending'
       AND attempts < max_attempts
       AND scheduled_at <= datetime('now')
       ORDER BY priority DESC, scheduled_at ASC
       LIMIT ${LINK_BATCH_SIZE}`,
      []
    );

    for (const job of linkJobs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        skipped++;
        continue;
      }
      if (!(await claimJob(job.id))) {
        skipped++;
        continue;
      }

      try {
        await processLinkJob(job);
        await markJobCompleted(job.id);
        processed++;
      } catch (error) {
        console.error("[Cron] Error processing link job:", error);
        await markJobFailed(job.id, error instanceof Error ? error.message : String(error));
        errors++;
      }
    }

    // ── Everything else: embeddings, summaries, tags, connections, scans ──
    const operations = SERVERLESS_OPERATIONS.map((op) => `'${op}'`).join(", ");
    const jobs = await queryAll<QueueJob>(
      `SELECT id, user_id, entity_type, entity_id, operation, tier, metadata
       FROM processing_queue
       WHERE operation IN (${operations})
       -- Attachment embeddings need an entity_type the embeddings table does
       -- not allow; leave them to the CLI rather than burn their retries here.
       AND NOT (operation = 'generate_embedding' AND entity_type = 'attachment')
       AND status = 'pending'
       AND attempts < max_attempts
       AND scheduled_at <= datetime('now')
       ORDER BY priority DESC, scheduled_at ASC
       LIMIT ${JOB_BATCH_SIZE}`,
      []
    );

    for (const job of jobs) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        skipped++;
        continue;
      }
      if (!(await claimJob(job.id))) {
        // Another run got there first — not an error.
        skipped++;
        continue;
      }

      try {
        await runJob(job);
        await markJobCompleted(job.id);
        processed++;
      } catch (error) {
        // One bad job must not abort the batch, and must not 500 the run:
        // a 500 here is what kept the whole queue from draining.
        console.error(`[Cron] Error processing ${job.operation} job ${job.id}:`, error);
        await markJobFailed(job.id, error instanceof Error ? error.message : String(error));
        errors++;
      }
    }

    if (skipped > 0) {
      console.log(`[Cron] Deferred ${skipped} job(s) to the next run`);
    }

    const duration = Date.now() - startTime;
    console.log(
      `[Cron] Completed in ${duration}ms: ${processed} processed, ${errors} failed, ${skipped} deferred`
    );

    return NextResponse.json({
      success: true,
      processed,
      errors,
      skipped,
      stuck_reset: stuckReset,
      stuck_retired: stuckRetired + strandedRetired.rowsAffected,
      sweep,
      duration_ms: duration,
      message: `Processed ${processed} jobs, ${errors} errors`,
    });
  } catch (error) {
    console.error("[Cron] Queue processing error:", error);
    return NextResponse.json(
      {
        success: false,
        processed,
        errors,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Take ownership of a job. Returns false when another worker claimed it first,
 * which is the normal outcome when two runs overlap. `attempts` is incremented
 * here and nowhere else, so a job that keeps killing its worker still exhausts
 * its retry budget rather than looping forever.
 */
async function claimJob(jobId: string): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE processing_queue
          SET status = 'processing',
              started_at = datetime('now'),
              attempts = attempts + 1
          WHERE id = ? AND status = 'pending'`,
    args: [jobId],
  });
  return result.rowsAffected > 0;
}

async function processLinkJob(job: QueueJob): Promise<void> {
  const metadata = JSON.parse(job.metadata || "{}");
  const { url, captureId } = metadata;

  if (!url || !captureId) {
    throw new Error("Missing url or captureId in metadata");
  }

  const { fetchMetadata } = await import("@/lib/services/link-metadata");
  const { scrapeFullContent } = await import("@/lib/services/link-scraper");

  const metadataResult = await fetchMetadata(url);
  const scraped = await scrapeFullContent(url);

  const capture = await queryAll<Capture>("SELECT * FROM captures WHERE id = ?", [captureId]);
  if (capture.length === 0) {
    throw new Error("Capture not found");
  }

  const existingMetadata = JSON.parse(capture[0].metadata || "{}");
  const updatedMetadata = {
    ...existingMetadata,
    ...metadataResult,
    scrapedContent: scraped.content,
    wordCount: scraped.wordCount,
    scrapedAt: scraped.scrapedAt,
  };

  await db.execute({
    sql: "UPDATE captures SET metadata = ? WHERE id = ?",
    args: [JSON.stringify(updatedMetadata), captureId],
  });

  console.log(`[Cron] Scraped ${scraped.wordCount} words from ${url}`);
}

async function markJobCompleted(jobId: string) {
  await db.execute({
    sql: "UPDATE processing_queue SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
    args: [jobId],
  });
}

async function markJobFailed(jobId: string, error: string) {
  await db.execute({
    sql: `UPDATE processing_queue
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
              -- Stamped only on the terminal transition, so the health check's
              -- 72h lookback dates a failure from when it gave up rather than
              -- from when the job was first scheduled.
              completed_at = CASE WHEN attempts >= max_attempts
                                  THEN datetime('now') ELSE completed_at END,
              error_message = ?
          WHERE id = ?`,
    args: [error, jobId],
  });
}

// Allow OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
