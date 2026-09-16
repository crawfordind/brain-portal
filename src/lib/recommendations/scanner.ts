/**
 * Task recommendation scanner
 * Orchestrates the full pipeline: extract candidates, check duplicates, call LLM, store results
 */

import { queryOne, db } from '@/lib/db/client';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { completeJSON } from '@/lib/ai/client';
import { getCached, setCache, generateCacheKey, hashContent } from '@/lib/processing/cache';
import {
  extractCandidates,
  hasActionIndicators,
  hasTimeLanguage,
  type Candidate
} from './utils';
import { isDuplicate } from './deduplication';
import {
  buildTaskRecommendationPrompt,
  calculateFinalConfidence,
  findSimilarRecommendations
} from './learning';
import type { Note, DailyNote, Capture, TaskRecommendation } from '@/lib/db/schema';

const MAX_CANDIDATES_TO_PROCESS = 20;
const MAX_RECOMMENDATIONS_TO_RETURN = 10;
const MIN_CONFIDENCE_THRESHOLD = 0.5;

export type SourceType = 'note' | 'daily_note' | 'capture';

export interface ScanResult {
  scannedCount: number;
  recommendationCount: number;
  recommendations: TaskRecommendation[];
}

interface LLMTaskResponse {
  isTask: boolean;
  taskText: string | null;
  reasoning: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * Load source content from database
 */
async function loadSourceContent(
  sourceType: SourceType,
  sourceId: string
): Promise<{ id: string; content: string } | null> {
  let query: string;

  switch (sourceType) {
    case 'note':
      query = 'SELECT id, content FROM notes WHERE id = ?';
      break;
    case 'daily_note':
      query = `
        SELECT dn.id, n.content
        FROM daily_notes dn
        JOIN notes n ON dn.note_id = n.id
        WHERE dn.id = ?
      `;
      break;
    case 'capture':
      query = 'SELECT id, content FROM captures WHERE id = ?';
      break;
  }

  const result = await queryOne<{ id: string; content: string }>(query, [sourceId]);
  return result || null;
}

/**
 * Store embedding for a task candidate
 */
async function storeEmbedding(
  userId: string,
  entityType: string,
  entityId: string,
  content: string,
  embedding: number[]
): Promise<string> {
  const embeddingJson = JSON.stringify(embedding);
  const contentHash = hashContent(content);

  try {
    await db.execute({
      sql: `INSERT INTO embeddings (user_id, entity_type, entity_id, embedding, content_hash, model, created_at)
            VALUES (?, ?, ?, ?, ?, 'openai/text-embedding-3-small', datetime('now'))`,
      args: [userId, entityType, entityId, embeddingJson, contentHash]
    });

    // Query back the TEXT id (not the integer rowid)
    const inserted = await queryOne<{ id: string }>(
      `SELECT id FROM embeddings WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1`,
      [entityType, entityId]
    );

    if (!inserted) {
      throw new Error(`Failed to retrieve inserted embedding for ${entityType}:${entityId}`);
    }

    return inserted.id;
  } catch (error) {
    console.error(`[storeEmbedding] Failed to insert embedding for ${entityType}:${entityId}`, {
      userId,
      entityType,
      entityId,
      error
    });
    throw error;
  }
}

/**
 * Store a task recommendation to database
 */
async function storeRecommendation(
  userId: string,
  sourceType: SourceType,
  sourceId: string,
  candidate: Candidate,
  llmResponse: LLMTaskResponse,
  finalConfidence: number,
  sourceEmbeddingId: string
): Promise<void> {
  try {
    await db.execute({
      sql: `INSERT INTO task_recommendations (
              user_id, source_type, source_id, source_text,
              recommended_task, confidence, priority, reasoning,
              source_embedding_id, status, expires_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now', '+30 days'), datetime('now'))`,
      args: [
        userId,
        sourceType,
        sourceId,
        candidate.text,
        llmResponse.taskText,
        finalConfidence,
        llmResponse.priority,
        llmResponse.reasoning,
        sourceEmbeddingId
      ]
    });
  } catch (error) {
    console.error(`[storeRecommendation] Failed to insert recommendation`, {
      userId,
      sourceType,
      sourceId,
      sourceEmbeddingId,
      candidateText: candidate.text.substring(0, 100),
      error
    });
    throw error;
  }
}

/**
 * Main scanner: Extract task candidates from content and generate recommendations
 *
 * Algorithm:
 * 1. Load source content
 * 2. Extract candidate sentences
 * 3. Filter by action indicators
 * 4. For each candidate (max 20):
 *    - Generate embedding
 *    - Check for duplicates
 *    - Store embedding
 *    - Build prompt with learning examples
 *    - Check cache
 *    - Call LLM if not cached
 *    - Apply confidence boosting
 *    - Store if confidence > 0.5
 * 5. Sort by confidence, return top 10
 */
export async function scanForTasks(
  userId: string,
  sourceType: SourceType,
  sourceId: string
): Promise<ScanResult> {
  // Step 1: Load source content
  const source = await loadSourceContent(sourceType, sourceId);
  if (!source) {
    throw new Error(`Source ${sourceType}:${sourceId} not found`);
  }

  // Step 2: Extract candidates
  const allCandidates = extractCandidates(source.content);

  // Step 3: Filter by action indicators
  const actionCandidates = allCandidates.filter(candidate =>
    hasActionIndicators(candidate.text)
  );

  // Limit candidates to process
  const candidatesToProcess = actionCandidates.slice(0, MAX_CANDIDATES_TO_PROCESS);

  const recommendations: TaskRecommendation[] = [];

  // Step 4: Process each candidate
  for (const candidate of candidatesToProcess) {
    try {
      // 4a. Generate embedding
      const embedding = await generateEmbedding(candidate.text);

      // 4b. Check for duplicates
      const duplicateCheck = await isDuplicate(userId, candidate.text, embedding);
      if (duplicateCheck.isDuplicate) {
        console.log(`Skipping duplicate: ${candidate.text} (${duplicateCheck.reason})`);
        continue;
      }

      // 4c. Store embedding
      // Use a temporary ID - we'll create the actual recommendation later
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const embeddingId = await storeEmbedding(
        userId,
        'task_candidate',
        tempId,
        candidate.text,
        embedding
      );

      // 4d. Build prompt with learning examples
      const prompt = await buildTaskRecommendationPrompt(
        candidate.text,
        embedding,
        userId
      );

      // 4e. Check cache
      const cacheKey = generateCacheKey('task_recommendation', {
        prompt,
        text: candidate.text
      });

      let llmResponse = await getCached<LLMTaskResponse>(userId, cacheKey);

      // 4f. Call LLM if not cached
      if (!llmResponse) {
        llmResponse = await completeJSON<LLMTaskResponse>(prompt, {
          maxTokens: 500
        });

        // Cache for 24 hours
        await setCache(userId, cacheKey, llmResponse, {
          operation: 'task_recommendation',
          tier: 'fast_llm',
          ttlHours: 24
        });
      }

      // Skip if LLM says it's not a task
      if (!llmResponse.isTask || !llmResponse.taskText) {
        continue;
      }

      // 4g. Apply confidence boosting
      const hasAction = hasActionIndicators(candidate.text);
      const hasTime = hasTimeLanguage(candidate.text);

      // Find similar examples for similarity scoring
      const acceptedExamples = await findSimilarRecommendations(
        userId,
        embedding,
        'accepted',
        10
      );
      const rejectedExamples = await findSimilarRecommendations(
        userId,
        embedding,
        'rejected',
        10
      );

      // TODO: Calculate max similarity values (will be computed in later iteration)
      const acceptedSimilarityMax = acceptedExamples.length > 0
        ? Math.max(...acceptedExamples.map(ex => ex.similarity ?? 0))
        : 0;
      const rejectedSimilarityMax = rejectedExamples.length > 0
        ? Math.max(...rejectedExamples.map(ex => ex.similarity ?? 0))
        : 0;

      const finalConfidence = calculateFinalConfidence(
        llmResponse.confidence,
        acceptedSimilarityMax,
        rejectedSimilarityMax,
        hasAction,
        hasTime
      );

      // 4h. Store if confidence > threshold
      if (finalConfidence > MIN_CONFIDENCE_THRESHOLD) {
        await storeRecommendation(
          userId,
          sourceType,
          sourceId,
          candidate,
          llmResponse,
          finalConfidence,
          embeddingId
        );

        // Add to results
        recommendations.push({
          id: tempId, // Will be replaced by actual DB ID
          user_id: userId,
          source_type: sourceType,
          source_id: sourceId,
          source_text: candidate.text,
          recommended_task: llmResponse.taskText,
          confidence: finalConfidence,
          priority: llmResponse.priority,
          reasoning: llmResponse.reasoning,
          status: 'pending',
          user_feedback: null,
          feedback_at: null,
          task_id: null,
          source_embedding_id: embeddingId,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: '{}'
        });
      }
    } catch (error) {
      console.error(`Error processing candidate "${candidate.text}":`, error);
      // Continue with next candidate
      continue;
    }
  }

  // Step 5: Sort by confidence descending, return top 10
  const topRecommendations = recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_RECOMMENDATIONS_TO_RETURN);

  return {
    scannedCount: candidatesToProcess.length,
    recommendationCount: topRecommendations.length,
    recommendations: topRecommendations
  };
}
