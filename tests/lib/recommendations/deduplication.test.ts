import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isDuplicate } from '@/lib/recommendations/deduplication';
import { cosineSimilarity } from '@/lib/ai/embeddings';

// Mock the database queries
vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn()
}));

vi.mock('@/lib/ai/embeddings', () => ({
  cosineSimilarity: vi.fn()
}));

describe('isDuplicate', () => {
  const userId = 'user123';
  const taskText = 'Review Q1 budget';
  const embedding = [0.1, 0.2, 0.3];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect duplicate active tasks with high similarity', async () => {
    const { queryAll, queryOne } = await import('@/lib/db/client');
    const mockCosineSimilarity = vi.mocked(cosineSimilarity);

    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: 'task1',
        content: 'Review Q1 budget',
        status: 'pending',
        embedding: JSON.stringify([0.15, 0.21, 0.29])
      }
    ]);

    mockCosineSimilarity.mockReturnValueOnce(0.95); // High similarity

    vi.mocked(queryAll).mockResolvedValueOnce([]); // No recommendations
    vi.mocked(queryOne).mockResolvedValueOnce(null); // No exact match

    const result = await isDuplicate(userId, taskText, embedding);

    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toBe('already_exists');
  });

  it('should allow tasks if similarity is below threshold', async () => {
    const { queryAll, queryOne } = await import('@/lib/db/client');
    const mockCosineSimilarity = vi.mocked(cosineSimilarity);

    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: 'task1',
        content: 'Different task',
        status: 'pending',
        embedding: JSON.stringify([0.9, 0.8, 0.7])
      }
    ]);

    mockCosineSimilarity.mockReturnValueOnce(0.3); // Low similarity

    vi.mocked(queryAll).mockResolvedValueOnce([]); // No recommendations
    vi.mocked(queryOne).mockResolvedValueOnce(null); // No exact match

    const result = await isDuplicate(userId, taskText, embedding);

    expect(result.isDuplicate).toBe(false);
  });
});
