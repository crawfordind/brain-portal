import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanForTasks } from '@/lib/recommendations/scanner';

// Mock dependencies
vi.mock('@/lib/recommendations/utils', () => ({
  extractCandidates: vi.fn(),
  hasActionIndicators: vi.fn(),
  hasTimeLanguage: vi.fn()
}));

vi.mock('@/lib/ai/embeddings', () => ({
  generateEmbedding: vi.fn()
}));

vi.mock('@/lib/recommendations/deduplication', () => ({
  isDuplicate: vi.fn()
}));

vi.mock('@/lib/recommendations/learning', () => ({
  buildTaskRecommendationPrompt: vi.fn(),
  calculateFinalConfidence: vi.fn(),
  findSimilarRecommendations: vi.fn()
}));

vi.mock('@/lib/ai/client', () => ({
  completeJSON: vi.fn()
}));

vi.mock('@/lib/processing/cache', () => ({
  getCached: vi.fn(),
  setCache: vi.fn(),
  generateCacheKey: vi.fn(),
  hashContent: vi.fn()
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  db: {
    execute: vi.fn()
  }
}));

describe('scanForTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract candidates, check duplicates, and return recommendations', async () => {
    const { queryOne, db } = await import('@/lib/db/client');
    const { extractCandidates, hasActionIndicators, hasTimeLanguage } = await import('@/lib/recommendations/utils');
    const { generateEmbedding } = await import('@/lib/ai/embeddings');
    const { isDuplicate } = await import('@/lib/recommendations/deduplication');
    const { buildTaskRecommendationPrompt, calculateFinalConfidence, findSimilarRecommendations } = await import('@/lib/recommendations/learning');
    const { completeJSON } = await import('@/lib/ai/client');
    const { getCached, setCache, generateCacheKey } = await import('@/lib/processing/cache');

    // Mock: Load source content
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'note-1',
      content: 'I need to review the Q4 report. Also should contact Sarah about the project.'
    });

    // Mock: Extract 2 candidates
    vi.mocked(extractCandidates).mockReturnValue([
      { text: 'I need to review the Q4 report', context: 'I need to review the Q4 report. Also should contact Sarah.' },
      { text: 'Also should contact Sarah about the project', context: 'I need to review the Q4 report. Also should contact Sarah about the project.' }
    ]);

    // Mock: First candidate has action indicators, second doesn't
    vi.mocked(hasActionIndicators)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);

    vi.mocked(hasTimeLanguage)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);

    // Mock: Generate embeddings
    const embedding1 = new Array(1536).fill(0.1);
    const embedding2 = new Array(1536).fill(0.2);
    vi.mocked(generateEmbedding)
      .mockResolvedValueOnce(embedding1)
      .mockResolvedValueOnce(embedding2);

    // Mock: Not duplicates
    vi.mocked(isDuplicate)
      .mockResolvedValueOnce({ isDuplicate: false })
      .mockResolvedValueOnce({ isDuplicate: false });

    // storeEmbedding reads the inserted row back to get its TEXT id, so each
    // candidate consumes a further queryOne after the source-content one above.
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'emb-1' })
      .mockResolvedValueOnce({ id: 'emb-2' });

    // Mock: Store embeddings and recommendations (return IDs)
    vi.mocked(db.execute)
      .mockResolvedValueOnce({ lastInsertRowid: BigInt(1), rows: [], columns: [], rowsAffected: 1, columnTypes: [], toJSON: () => ({}) } as any)
      .mockResolvedValueOnce({ lastInsertRowid: BigInt(2), rows: [], columns: [], rowsAffected: 1, columnTypes: [], toJSON: () => ({}) } as any)
      .mockResolvedValueOnce({ lastInsertRowid: BigInt(3), rows: [], columns: [], rowsAffected: 1, columnTypes: [], toJSON: () => ({}) } as any) // First recommendation
      .mockResolvedValueOnce({ lastInsertRowid: BigInt(4), rows: [], columns: [], rowsAffected: 1, columnTypes: [], toJSON: () => ({}) } as any); // Second recommendation

    // Mock: Build prompt with learning examples
    vi.mocked(buildTaskRecommendationPrompt)
      .mockResolvedValueOnce('Prompt for candidate 1')
      .mockResolvedValueOnce('Prompt for candidate 2');

    // Mock: Cache miss
    vi.mocked(generateCacheKey).mockReturnValue('cache-key');
    vi.mocked(getCached).mockResolvedValue(null);

    // Mock: findSimilarRecommendations (for confidence boosting)
    vi.mocked(findSimilarRecommendations).mockResolvedValue([]);

    // Mock: LLM responses
    vi.mocked(completeJSON)
      .mockResolvedValueOnce({
        isTask: true,
        taskText: 'Review Q4 report',
        reasoning: 'Clear action verb "review"',
        confidence: 0.8,
        priority: 'medium'
      })
      .mockResolvedValueOnce({
        isTask: true,
        taskText: 'Contact Sarah about project',
        reasoning: 'Action verb "contact" with specific person',
        confidence: 0.7,
        priority: 'medium'
      });

    // Mock: Calculate final confidence
    vi.mocked(calculateFinalConfidence)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.8);

    // Mock: Set cache
    vi.mocked(setCache).mockResolvedValue(undefined);

    const result = await scanForTasks('user-1', 'note', 'note-1');

    expect(result.recommendationCount).toBe(2);
    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0]).toMatchObject({
      recommended_task: 'Review Q4 report',
      confidence: 0.9,
      priority: 'medium'
    });
    expect(result.recommendations[1]).toMatchObject({
      recommended_task: 'Contact Sarah about project',
      confidence: 0.8,
      priority: 'medium'
    });

    // Verify duplicate check was called
    expect(isDuplicate).toHaveBeenCalledTimes(2);

    // Verify embeddings stored
    expect(db.execute).toHaveBeenCalled();

    // Verify LLM called
    expect(completeJSON).toHaveBeenCalledTimes(2);
  });

  it('should skip candidates that are duplicates', async () => {
    const { queryOne, db } = await import('@/lib/db/client');
    const { extractCandidates, hasActionIndicators, hasTimeLanguage } = await import('@/lib/recommendations/utils');
    const { generateEmbedding } = await import('@/lib/ai/embeddings');
    const { isDuplicate } = await import('@/lib/recommendations/deduplication');
    const { completeJSON } = await import('@/lib/ai/client');

    // Mock: Load source content
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'note-1',
      content: 'I need to review the report'
    });

    // Mock: Extract 1 candidate
    vi.mocked(extractCandidates).mockReturnValue([
      { text: 'I need to review the report', context: 'I need to review the report' }
    ]);

    // Mock: Has action indicators
    vi.mocked(hasActionIndicators).mockReturnValueOnce(true);
    vi.mocked(hasTimeLanguage).mockReturnValueOnce(false);

    // Mock: Generate embedding
    const embedding = new Array(1536).fill(0.1);
    vi.mocked(generateEmbedding).mockResolvedValueOnce(embedding);

    // Mock: Is duplicate
    vi.mocked(isDuplicate).mockResolvedValueOnce({
      isDuplicate: true,
      reason: 'already_exists'
    });

    const result = await scanForTasks('user-1', 'note', 'note-1');

    // Should return empty - duplicate skipped
    expect(result.recommendationCount).toBe(0);
    expect(result.recommendations).toHaveLength(0);

    // Verify LLM was NOT called (duplicate filtered out)
    expect(completeJSON).not.toHaveBeenCalled();

    // Verify no recommendations stored
    expect(db.execute).toHaveBeenCalledTimes(0);
  });
});
