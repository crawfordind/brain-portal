// tests/lib/cleanup/analyzer.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the AI client
vi.mock('@/lib/ai/client', () => ({
  completeJSON: vi.fn(),
}));

// Mock the tiers module
vi.mock('@/lib/ai/tiers', () => ({
  getTierConfig: vi.fn().mockReturnValue({
    model: 'x-ai/grok-4.1-fast',
    maxTokens: 1500,
  }),
}));

describe('analyzeNote', () => {
  let mockCompleteJSON: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { completeJSON } = await import('@/lib/ai/client');
    mockCompleteJSON = completeJSON as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  test('returns suggestions for note cleanup', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    const mockResponse = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '## Old Heading',
        before: '## Old Heading',
        after: '## Improved Heading',
        reasoning: 'More descriptive',
        confidence: 0.85
      }
    ];

    mockCompleteJSON.mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', '## Old Heading\n\nSome content');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].type).toBe('structure');
    expect(result.suggestions[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('filters low confidence suggestions', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    const mockResponse = [
      {
        id: 'tag-1',
        type: 'tag',
        action: 'add',
        content: 'test',
        reasoning: 'Maybe relevant',
        confidence: 0.5
      }
    ];

    mockCompleteJSON.mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', 'Some content');

    expect(result.suggestions).toHaveLength(0);
  });

  test('handles chunk processing errors gracefully', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    mockCompleteJSON.mockRejectedValueOnce(new Error('API error'));

    const result = await analyzeNote('userId', 'Some content');

    expect(result).toBeDefined();
    expect(result.suggestions).toBeDefined();
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  test('deduplicates suggestions with same type and target', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    const mockResponse = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '## Introduction',
        before: '## Introduction',
        after: '## Intro',
        reasoning: 'Shorter',
        confidence: 0.8
      },
      {
        id: 'struct-2',
        type: 'structure',
        action: 'replace',
        target: '##Introduction',  // Same target, different formatting
        before: '##Introduction',
        after: '## Intro',
        reasoning: 'Shorter',
        confidence: 0.75
      }
    ];

    mockCompleteJSON.mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', 'Some content');

    expect(result.suggestions).toHaveLength(1);  // Should be deduplicated
  });

  test('limits suggestions to 10 per type', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    const mockResponse = Array.from({ length: 15 }, (_, i) => ({
      id: `struct-${i}`,
      type: 'structure',
      action: 'replace',
      target: `## Heading ${i}`,
      before: `## Heading ${i}`,
      after: `## Better Heading ${i}`,
      reasoning: 'Improved',
      confidence: 0.7 + (i * 0.01)  // Varying confidence
    }));

    mockCompleteJSON.mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', 'Some content');

    expect(result.suggestions).toHaveLength(10);
    // Should keep highest confidence ones
    expect(result.suggestions[0].confidence).toBeGreaterThanOrEqual(0.84);
  });

  test('processes multiple chunks for long notes', async () => {
    const { analyzeNote } = await import('@/lib/cleanup/analyzer');
    const longContent = '# Title\n\n' + 'x'.repeat(3500) + '\n\n## Section 2';

    mockCompleteJSON
      .mockResolvedValueOnce([{
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '# Title',
        before: '# Title',
        after: '# Better Title',
        reasoning: 'Improved',
        confidence: 0.9
      }])
      .mockResolvedValueOnce([{
        id: 'struct-2',
        type: 'structure',
        action: 'replace',
        target: '## Section 2',
        before: '## Section 2',
        after: '## Section Two',
        reasoning: 'Spelled out',
        confidence: 0.85
      }]);

    const result = await analyzeNote('userId', longContent);

    expect(result.chunked).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.suggestions).toHaveLength(2);
  });
});
