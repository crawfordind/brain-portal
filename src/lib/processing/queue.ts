/**
 * Background processing queue
 * Manages async jobs for embeddings, summaries, and other heavy operations
 */

import { db, queryOne, queryAll, mutate } from "@/lib/db/client";
import type { ProcessingJob } from "@/lib/db/schema";
import type { Tier } from "./cache";

export type Operation =
  | "generate_embedding"
  | "generate_summary"
  | "generate_tags"
  | "find_connections"
  | "analyze_capture"
  | "recompute_all"
  | "scan_for_tasks"
  | "extract_metadata"
  | "extract_text"
  | "generate_description"
  | "generate_thumbnail"
  | "link-scrape-and-embed";

export interface QueueJobInput {
  userId: string;
  entityType: string;
  entityId: string;
  operation: Operation;
  tier: Tier;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface ProcessResult<T = unknown> {
  success: boolean;
  jobId: string;
  result?: T;
  error?: string;
}

/**
 * Add a job to the processing queue
 * Returns the job ID (or existing job ID if duplicate)
 */
export async function enqueue(job: QueueJobInput): Promise<string> {
  // Check for existing pending job to prevent duplicates
  const existing = await queryOne<ProcessingJob>(
    `SELECT id FROM processing_queue
     WHERE entity_type = ? AND entity_id = ? AND operation = ?
     AND status IN ('pending', 'processing')`,
    [job.entityType, job.entityId, job.operation]
  );

  if (existing) {
    return existing.id; // Return existing job ID
  }

  const result = await mutate<{ id: string }>(
    `INSERT INTO processing_queue
     (user_id, entity_type, entity_id, operation, tier, priority, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      job.userId,
      job.entityType,
      job.entityId,
      job.operation,
      job.tier,
      job.priority || 0,
      JSON.stringify(job.metadata || {}),
    ]
  );

  return result?.id || "";
}

/**
 * Enqueue multiple related jobs at once
 */
export async function enqueueBatch(jobs: QueueJobInput[]): Promise<string[]> {
  const ids: string[] = [];
  for (const job of jobs) {
    const id = await enqueue(job);
    ids.push(id);
  }
  return ids;
}

/**
 * Get the next job to process
 * Optionally filter by tier
 */
export async function dequeue(tier?: Tier): Promise<ProcessingJob | null> {
  const tierFilter = tier ? `AND tier = ?` : "";
  const args: (string | number)[] = [];
  if (tier) {
    args.push(tier);
  }

  // Select next job
  const job = await queryOne<ProcessingJob>(
    `SELECT * FROM processing_queue
     WHERE status = 'pending'
     AND attempts < max_attempts
     AND scheduled_at <= datetime('now')
     ${tierFilter}
     ORDER BY priority DESC, scheduled_at ASC
     LIMIT 1`,
    args
  );

  if (!job) {
    return null;
  }

  // Mark as processing
  await db.execute({
    sql: `UPDATE processing_queue
          SET status = 'processing',
              started_at = datetime('now'),
              attempts = attempts + 1
          WHERE id = ?`,
    args: [job.id],
  });

  return job;
}

/**
 * Mark a job as completed
 */
export async function completeJob(jobId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE processing_queue
          SET status = 'completed',
              completed_at = datetime('now')
          WHERE id = ?`,
    args: [jobId],
  });
}

/**
 * Mark a job as failed
 */
export async function failJob(jobId: string, error: string): Promise<void> {
  const job = await queryOne<ProcessingJob>(
    `SELECT attempts, max_attempts FROM processing_queue WHERE id = ?`,
    [jobId]
  );

  const newStatus = job && job.attempts >= job.max_attempts ? "failed" : "pending";
  const scheduledAt =
    newStatus === "pending"
      ? `datetime('now', '+${getRetryDelay(job?.attempts || 1)} seconds')`
      : "scheduled_at";

  await db.execute({
    sql: `UPDATE processing_queue
          SET status = ?,
              error_message = ?,
              scheduled_at = ${scheduledAt}
          WHERE id = ?`,
    args: [newStatus, error, jobId],
  });
}

/**
 * Get retry delay based on attempt number (exponential backoff)
 */
function getRetryDelay(attempts: number): number {
  const delays = [60, 300, 1800]; // 1min, 5min, 30min
  return delays[Math.min(attempts - 1, delays.length - 1)];
}

/**
 * Get job status
 */
export async function getJobStatus(
  jobId: string
): Promise<ProcessingJob | null> {
  return queryOne<ProcessingJob>(
    `SELECT * FROM processing_queue WHERE id = ?`,
    [jobId]
  );
}

/**
 * Get pending jobs for an entity
 */
export async function getPendingJobs(
  entityType: string,
  entityId: string
): Promise<ProcessingJob[]> {
  return queryAll<ProcessingJob>(
    `SELECT * FROM processing_queue
     WHERE entity_type = ? AND entity_id = ?
     AND status IN ('pending', 'processing')
     ORDER BY priority DESC, scheduled_at ASC`,
    [entityType, entityId]
  );
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  byTier: Record<Tier, number>;
  byOperation: Record<string, number>;
}> {
  const statusCounts = await queryAll<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count
     FROM processing_queue
     GROUP BY status`,
    []
  );

  const tierCounts = await queryAll<{ tier: string; count: number }>(
    `SELECT tier, COUNT(*) as count
     FROM processing_queue
     WHERE status IN ('pending', 'processing')
     GROUP BY tier`,
    []
  );

  const opCounts = await queryAll<{ operation: string; count: number }>(
    `SELECT operation, COUNT(*) as count
     FROM processing_queue
     WHERE status IN ('pending', 'processing')
     GROUP BY operation`,
    []
  );

  const stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const row of statusCounts) {
    stats[row.status as keyof typeof stats] = row.count;
  }

  const byTier: Record<Tier, number> = {
    local: 0,
    embedding: 0,
    fast_llm: 0,
    full_llm: 0,
  };

  for (const row of tierCounts) {
    byTier[row.tier as Tier] = row.count;
  }

  const byOperation: Record<string, number> = {};
  for (const row of opCounts) {
    byOperation[row.operation] = row.count;
  }

  return {
    ...stats,
    byTier,
    byOperation,
  };
}

/**
 * Clean up old completed/failed jobs
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<number> {
  const result = await db.execute({
    sql: `DELETE FROM processing_queue
          WHERE status IN ('completed', 'failed')
          AND completed_at < datetime('now', '-${daysOld} days')`,
    args: [],
  });
  return result.rowsAffected;
}

/**
 * Cancel pending jobs for an entity
 */
export async function cancelJobs(
  entityType: string,
  entityId: string
): Promise<number> {
  const result = await db.execute({
    sql: `DELETE FROM processing_queue
          WHERE entity_type = ? AND entity_id = ?
          AND status = 'pending'`,
    args: [entityType, entityId],
  });
  return result.rowsAffected;
}
