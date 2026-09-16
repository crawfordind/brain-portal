import { queryAll } from '@/lib/db/client';
import { cosineSimilarity } from '@/lib/ai/embeddings';
import { TaskRecommendation } from '@/lib/db/schema';

export interface TaskRecommendationWithSimilarity extends TaskRecommendation {
  embedding?: string | null;
  similarity?: number;
}

/**
 * Find similar recommendations by embedding similarity
 * Used for few-shot learning examples
 */
export async function findSimilarRecommendations(
  userId: string,
  embedding: number[],
  feedback: 'accepted' | 'rejected',
  limit: number
): Promise<TaskRecommendationWithSimilarity[]> {

  // Get all recommendations with this feedback status
  const recommendations = await queryAll<TaskRecommendation & { embedding: string | null }>(
    `SELECT tr.*, e.embedding
     FROM task_recommendations tr
     LEFT JOIN embeddings e ON tr.source_embedding_id = e.id
     WHERE tr.user_id = ? AND tr.user_feedback = ?
     ORDER BY tr.feedback_at DESC
     LIMIT 100`,
    [userId, feedback]
  );

  // Calculate similarity scores
  const withScores: TaskRecommendationWithSimilarity[] = [];

  for (const rec of recommendations) {
    if (rec.embedding === null) continue;

    try {
      const recEmbedding = JSON.parse(rec.embedding);
      withScores.push({
        ...rec,
        similarity: cosineSimilarity(embedding, recEmbedding)
      });
    } catch (error) {
      console.warn('Failed to parse embedding:', error);
    }
  }

  // Sort by similarity descending and take top N
  return withScores
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

/**
 * Build a prompt with few-shot examples for task recommendation
 */
export async function buildTaskRecommendationPrompt(
  candidateText: string,
  candidateEmbedding: number[],
  userId: string
): Promise<string> {

  // Fetch similar accepted examples
  const acceptedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'accepted',
    5
  );

  // Fetch similar rejected examples
  const rejectedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'rejected',
    5
  );

  const positiveExamples = acceptedExamples.length > 0
    ? acceptedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Task: "${ex.recommended_task}"
   Why: ${ex.reasoning || 'User accepted this as actionable'}
`).join('\n')
    : '\n(No examples yet - learning from your first feedback)\n';

  const negativeExamples = rejectedExamples.length > 0
    ? rejectedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Why: ${ex.reasoning || 'User determined this was not actionable'}
`).join('\n')
    : '\n(No examples yet - learning from your first feedback)\n';

  return `You are a task detection assistant that learns from user feedback. Analyze text to identify actionable tasks.

POSITIVE EXAMPLES (user accepted these as tasks):${positiveExamples}

NEGATIVE EXAMPLES (user rejected these - NOT tasks):${negativeExamples}

Now analyze this text and determine if it contains an actionable task:

Text: "${candidateText}"

Return JSON with:
{
  "isTask": boolean,
  "taskText": string | null,
  "reasoning": string,
  "confidence": number,
  "priority": "low" | "medium" | "high" | "urgent"
}

Rules:
- Tasks have clear action verbs (review, contact, fix, create, send, etc.)
- Tasks should be specific and actionable, not vague contemplation
- Time-based language (today, tomorrow, this week) suggests tasks
- Past tense usually means not a task (already done)
- Questions are usually not tasks unless they imply follow-up action`;
}

/**
 * Calculate final confidence score with boosting/penalties
 */
export function calculateFinalConfidence(
  llmConfidence: number,
  acceptedSimilarityMax: number,
  rejectedSimilarityMax: number,
  hasActionVerbs: boolean,
  hasTimeLanguage: boolean
): number {

  let confidence = llmConfidence;

  // Boost for similarity to accepted examples
  if (acceptedSimilarityMax > 0.8) confidence += 0.2;
  else if (acceptedSimilarityMax > 0.6) confidence += 0.1;

  // Penalty for similarity to rejected examples
  if (rejectedSimilarityMax > 0.8) confidence -= 0.3;
  else if (rejectedSimilarityMax > 0.6) confidence -= 0.15;

  // Boost for action indicators
  if (hasActionVerbs) confidence += 0.1;
  if (hasTimeLanguage) confidence += 0.1;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, confidence));
}
