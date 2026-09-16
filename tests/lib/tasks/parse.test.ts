import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/client', () => ({
  completeJSON: vi.fn(),
  DEFAULT_MODEL: 'test-model',
}));
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn().mockResolvedValue(null), // no cache hit by default
}));

import { parseTaskNL } from '@/lib/tasks/parse';
import { completeJSON } from '@/lib/ai/client';
import { queryOne, db } from '@/lib/db/client';

describe('parseTaskNL', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns parsed task fields from LLM response', async () => {
    vi.mocked(completeJSON).mockResolvedValue({
      title: 'Write blog post about AI',
      dueDate: '2026-02-27',
      priority: 'urgent',
      agent: 'copy',
      tags: ['blog', 'AI'],
    });

    const result = await parseTaskNL('Write blog post about AI by Friday urgent', '2026-02-22', 'user-1');

    expect(result).toEqual({
      title: 'Write blog post about AI',
      dueDate: '2026-02-27',
      priority: 'urgent',
      agent: 'copy',
      tags: ['blog', 'AI'],
    });
  });

  it('returns null when LLM throws', async () => {
    vi.mocked(completeJSON).mockRejectedValue(new Error('API error'));

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns malformed data', async () => {
    vi.mocked(completeJSON).mockResolvedValue(null);

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');
    expect(result).toBeNull();
  });

  it('returns cached result without calling LLM on cache hit', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      output: JSON.stringify({ title: 'Cached title', dueDate: null, priority: null, agent: null, tags: [] }),
    });

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');

    expect(result?.title).toBe('Cached title');
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it('saves result to ai_cache after LLM call', async () => {
    vi.mocked(queryOne).mockResolvedValue(null); // ensure no cache hit
    vi.mocked(completeJSON).mockResolvedValue({
      title: 'Fix bug', dueDate: null, priority: 'high', agent: 'code', tags: [],
    });

    await parseTaskNL('Fix bug in auth', '2026-02-22', 'user-1');

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      ([arg]) => typeof arg === 'object' && (arg as any).sql?.includes('ai_cache')
    );
    expect(insertCall).toBeDefined();
  });
});
