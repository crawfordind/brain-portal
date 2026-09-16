import { queryAll, queryOne } from '@/lib/db/client';
import { cosineSimilarity } from '@/lib/ai/embeddings';
import { Task, TaskRecommendation } from '@/lib/db/schema';

const SIMILARITY_THRESHOLD = 0.85;
const COMPLETED_TASK_WINDOW_DAYS = 30;
const RECENT_RECOMMENDATION_WINDOW_DAYS = 7;

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: string;
}

/**
 * Check if a task is a duplicate of existing tasks or recommendations
 *
 * Three-level check:
 * 1. Existing tasks (pending, in_progress, recently completed)
 * 2. Recent recommendations (pending, rejected)
 * 3. Exact text match (fallback)
 */
export async function isDuplicate(
  userId: string,
  taskText: string,
  embedding: number[]
): Promise<DuplicateCheckResult> {

  // Level 1: Check existing tasks
  const existingTasks = await queryAll<Task & { embedding: string | null }>(
    `SELECT t.*, e.embedding
     FROM tasks t
     LEFT JOIN embeddings e ON e.entity_type = 'task' AND e.entity_id = t.id
     WHERE t.user_id = ? AND (
       t.status IN ('pending', 'in_progress')
       OR (t.status = 'completed' AND t.completed_at >= datetime('now', '-${COMPLETED_TASK_WINDOW_DAYS} days'))
     )`,
    [userId]
  );

  for (const task of existingTasks) {
    if (task.embedding) {
      try {
        const taskEmbedding = JSON.parse(task.embedding);
        const similarity = cosineSimilarity(embedding, taskEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          if (task.status === 'completed') {
            return { isDuplicate: true, reason: 'completed_recently' };
          } else {
            return { isDuplicate: true, reason: 'already_exists' };
          }
        }
      } catch (error) {
        console.warn('Failed to parse task embedding:', error);
        // Continue checking other tasks
      }
    }
  }

  // Level 2: Check recent recommendations
  const recentRecs = await queryAll<TaskRecommendation & { embedding: string | null }>(
    `SELECT tr.*, e.embedding
     FROM task_recommendations tr
     LEFT JOIN embeddings e ON tr.source_embedding_id = e.id
     WHERE tr.user_id = ?
     AND tr.created_at >= datetime('now', '-${RECENT_RECOMMENDATION_WINDOW_DAYS} days')
     AND tr.status IN ('pending', 'rejected')`,
    [userId]
  );

  for (const rec of recentRecs) {
    if (rec.embedding) {
      try {
        const recEmbedding = JSON.parse(rec.embedding);
        const similarity = cosineSimilarity(embedding, recEmbedding);

        if (similarity >= SIMILARITY_THRESHOLD) {
          if (rec.status === 'rejected') {
            return { isDuplicate: true, reason: 'previously_rejected' };
          }
          if (rec.status === 'pending') {
            return { isDuplicate: true, reason: 'already_recommended' };
          }
        }
      } catch (error) {
        console.warn('Failed to parse recommendation embedding:', error);
        // Continue checking other recommendations
      }
    }
  }

  // Level 3: Exact text match (fallback if embeddings fail)
  const normalizedText = taskText.toLowerCase().trim();
  const exactMatch = await queryOne(
    `SELECT id FROM tasks
     WHERE user_id = ? AND LOWER(TRIM(content)) = ? AND status != 'cancelled'`,
    [userId, normalizedText]
  );

  if (exactMatch) {
    return { isDuplicate: true, reason: 'exact_match' };
  }

  return { isDuplicate: false };
}
