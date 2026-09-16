import { describe, it, expect, vi } from 'vitest';
import { findSimilarRecommendations, buildTaskRecommendationPrompt, calculateFinalConfidence } from '@/lib/recommendations/learning';

vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn()
}));

vi.mock('@/lib/ai/embeddings', () => ({
  cosineSimilarity: vi.fn()
}));

describe('findSimilarRecommendations', () => {
  it('should find and rank similar recommendations by similarity score', async () => {
    const { queryAll } = await import('@/lib/db/client');
    const { cosineSimilarity } = await import('@/lib/ai/embeddings');

    const mockRecommendations = [
      {
        id: 'rec1',
        source_text: 'need to review budget',
        recommended_task: 'Review budget',
        reasoning: 'Action verb',
        embedding: JSON.stringify([0.1, 0.2, 0.3])
      },
      {
        id: 'rec2',
        source_text: 'should contact client',
        recommended_task: 'Contact client',
        reasoning: 'Action verb',
        embedding: JSON.stringify([0.4, 0.5, 0.6])
      }
    ];

    vi.mocked(queryAll).mockResolvedValue(mockRecommendations);
    vi.mocked(cosineSimilarity)
      .mockReturnValueOnce(0.9)  // rec1 - high similarity
      .mockReturnValueOnce(0.3); // rec2 - low similarity

    const results = await findSimilarRecommendations(
      'user123',
      [0.1, 0.2, 0.3],
      'accepted',
      5
    );

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('rec1'); // Higher similarity first
    expect(results[0].similarity).toBe(0.9);
  });
});

describe('buildTaskRecommendationPrompt', () => {
  it('should include accepted and rejected examples in prompt', async () => {
    const { queryAll } = await import('@/lib/db/client');
    const { cosineSimilarity } = await import('@/lib/ai/embeddings');

    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        {
          source_text: 'need to review',
          recommended_task: 'Review',
          reasoning: 'Action',
          embedding: JSON.stringify([0.1, 0.2])
        }
      ])
      .mockResolvedValueOnce([
        {
          source_text: 'thinking about it',
          recommended_task: '',
          reasoning: 'Not actionable',
          embedding: JSON.stringify([0.3, 0.4])
        }
      ]);

    vi.mocked(cosineSimilarity).mockReturnValue(0.5);

    const prompt = await buildTaskRecommendationPrompt(
      'should contact Sarah',
      [0.5, 0.5],
      'user123'
    );

    expect(prompt).toContain('POSITIVE EXAMPLES');
    expect(prompt).toContain('need to review');
    expect(prompt).toContain('NEGATIVE EXAMPLES');
    expect(prompt).toContain('thinking about it');
    expect(prompt).toContain('should contact Sarah');
  });
});

describe('calculateFinalConfidence', () => {
  it('should boost confidence for high similarity to accepted examples', () => {
    const result = calculateFinalConfidence(0.5, 0.85, 0, false, false);
    expect(result).toBe(0.7); // 0.5 + 0.2 = 0.7
  });

  it('should penalize confidence for high similarity to rejected examples', () => {
    const result = calculateFinalConfidence(0.7, 0, 0.85, false, false);
    expect(result).toBeCloseTo(0.4, 5); // 0.7 - 0.3 = 0.4
  });

  it('should boost for action verbs and time language', () => {
    const result = calculateFinalConfidence(0.5, 0, 0, true, true);
    expect(result).toBe(0.7); // 0.5 + 0.1 + 0.1 = 0.7
  });

  it('should clamp confidence to maximum of 1.0', () => {
    const result = calculateFinalConfidence(0.95, 0.85, 0, true, true);
    expect(result).toBe(1.0); // 0.95 + 0.2 + 0.1 + 0.1 = 1.35, clamped to 1.0
  });

  it('should clamp confidence to minimum of 0.0', () => {
    const result = calculateFinalConfidence(0.2, 0, 0.85, false, false);
    expect(result).toBe(0.0); // 0.2 - 0.3 = -0.1, clamped to 0.0
  });

  it('should apply combined adjustments correctly', () => {
    const result = calculateFinalConfidence(0.6, 0.7, 0.5, true, false);
    // 0.6 + 0.1 (accepted >0.6) - 0 (rejected <0.6) + 0.1 (action) = 0.8
    expect(result).toBeCloseTo(0.8, 5);
  });
});
