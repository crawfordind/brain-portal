import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing executor
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn().mockResolvedValue('Agent output'),
  completeWithMeta: vi
    .fn()
    .mockResolvedValue({ content: 'Agent output', finishReason: 'stop', model: 'test-model' }),
  DEFAULT_MODEL: 'test-model',
  MINIMAX_MODEL: 'minimax/minimax-m2.5',
}));
vi.mock('@/lib/agents/context', () => ({
  buildTaskContext: vi.fn().mockResolvedValue({
    attachedNotes: [{ id: 'note-1', title: 'Attached Note', content: 'content' }],
    attachedUrls: [],
    relevantNotes: [
      { id: 'note-2', title: 'Auto Note', content: 'auto content', similarity: 0.89 },
    ],
    activeTasks: [],
    recentCompletions: [],
    recentCaptures: [],
  }),
  formatContextForPrompt: vi.fn().mockReturnValue('formatted context'),
}));
vi.mock('@/lib/agents/status-sync', () => ({
  syncTaskStatusFromAgentTask: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgentTask } from '@/lib/agents/executor';
import { db, queryOne, queryAll } from '@/lib/db/client';

/**
 * Narrow a recorded `db.execute` argument to its object form.
 *
 * `db.execute` takes `string | InStatement`; `typeof arg === "object"` does not
 * narrow that union usefully here, so pull the shape out explicitly.
 */
function asStatement(arg: unknown): { sql: string; args?: unknown[] } | null {
  return arg !== null && typeof arg === "object" && "sql" in arg
    ? (arg as { sql: string; args?: unknown[] })
    : null;
}


describe('Agent Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: return a valid task
    vi.mocked(queryOne).mockResolvedValue({
      id: 'task-1',
      user_id: 'user-1',
      assigned_agent: 'general',
      description: 'Write something',
      title: 'Test task',
      context_note_ids: '[]',
      context_urls: '[]',
      output_format: 'markdown',
      current_version: 0,
      max_revisions: 5,
    });
  });

  it('persists context_used with auto-retrieved notes after building context', async () => {
    await executeAgentTask('task-1');

    // Find the UPDATE call that sets context_used
    const calls = vi.mocked(db.execute).mock.calls;
    const contextUsedCall = calls.find(
      ([arg]) => asStatement(arg)?.sql.includes('context_used')
    );

    expect(contextUsedCall).toBeDefined();
    const savedJson = JSON.parse(asStatement(contextUsedCall![0])!.args![0] as string);
    expect(savedJson).toEqual([
      { id: 'note-2', title: 'Auto Note', similarity: 0.89 },
    ]);
  });

  it('saves empty array when no auto-retrieved notes found', async () => {
    const { buildTaskContext } = await import('@/lib/agents/context');
    vi.mocked(buildTaskContext).mockResolvedValueOnce({
      attachedNotes: [],
      attachedUrls: [],
      relevantNotes: [],
      activeTasks: [],
      recentCompletions: [],
      recentCaptures: [],
    });

    await executeAgentTask('task-1');

    const calls = vi.mocked(db.execute).mock.calls;
    const contextUsedCall = calls.find(
      ([arg]) => asStatement(arg)?.sql.includes('context_used')
    );
    const savedJson = JSON.parse(asStatement(contextUsedCall![0])!.args![0] as string);
    expect(savedJson).toEqual([]);
  });
});
