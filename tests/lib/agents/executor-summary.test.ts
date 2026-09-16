import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));

const mockComplete = vi.fn().mockResolvedValue('Agent output');
const mockCompleteWithMeta = vi
  .fn()
  .mockResolvedValue({ content: 'Agent output', finishReason: 'stop', model: 'test-model' });

vi.mock('@/lib/ai/client', () => ({
  complete: (...args: unknown[]) => mockComplete(...args),
  completeWithMeta: (...args: unknown[]) => mockCompleteWithMeta(...args),
  DEFAULT_MODEL: 'test-model',
  MINIMAX_MODEL: 'minimax/minimax-m2.5',
}));
vi.mock('@/lib/agents/context', () => ({
  buildTaskContext: vi.fn().mockResolvedValue({
    attachedNotes: [],
    attachedUrls: [],
    relevantNotes: [],
  }),
  formatContextForPrompt: vi.fn().mockReturnValue(''),
}));
vi.mock('@/lib/agents/status-sync', () => ({
  syncTaskStatusFromAgentTask: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgentTask } from '@/lib/agents/executor';
import { db, queryOne } from '@/lib/db/client';

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


describe('Executor Summary Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // First queryOne call returns the task, second returns agent config, third returns null (no prev output), fourth returns null (no feedback)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        agent_type: 'general',
        display_name: 'Assistant',
        system_prompt: 'You are helpful',
        model_id: 'test-model',
        is_active: true,
      })
      .mockResolvedValueOnce(null); // no previous output

    // The main output comes from completeWithMeta; complete() is only used for
    // the follow-up one-sentence summary.
    mockCompleteWithMeta.mockResolvedValueOnce({
      content: 'This is the main agent output with lots of detail.',
      finishReason: 'stop',
      model: 'test-model',
    });
    mockComplete.mockResolvedValueOnce('Brief summary of the output.');
  });

  it('makes a second model call for the summary after the main output', async () => {
    await executeAgentTask('task-1');

    expect(mockCompleteWithMeta).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);

    const summaryCall = mockComplete.mock.calls[0];
    expect(summaryCall[0]).toContain('Summarize the following in one sentence');
    expect(summaryCall[1]).toEqual(
      expect.objectContaining({ maxTokens: 100, temperature: 0.3 })
    );
  });

  it('includes summary in the INSERT statement', async () => {
    await executeAgentTask('task-1');

    const calls = vi.mocked(db.execute).mock.calls;
    const insertCall = calls.find(
      ([arg]) => asStatement(arg)?.sql.includes('INSERT INTO agent_task_outputs')
    );

    expect(insertCall).toBeDefined();
    const sql = asStatement(insertCall![0])!.sql;
    expect(sql).toContain('summary');
    // args: [taskId, content, format, model, tokensIn, tokensOut, ms, summary, taskId]
    const args = asStatement(insertCall![0])!.args as unknown[];
    expect(args).toHaveLength(9);
    expect(args[7]).toBe('Brief summary of the output.');
  });

  it('does not fail the task when summary generation errors', async () => {
    mockCompleteWithMeta
      .mockReset()
      .mockResolvedValueOnce({ content: 'Main output', finishReason: 'stop', model: 'test-model' });
    mockComplete
      .mockReset()
      .mockRejectedValueOnce(new Error('Summary API failure'));

    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        agent_type: 'general',
        display_name: 'Assistant',
        system_prompt: 'You are helpful',
        model_id: 'test-model',
        is_active: true,
      })
      .mockResolvedValueOnce(null);

    // Should not throw
    await expect(executeAgentTask('task-1')).resolves.toBeUndefined();

    // Should still insert with null summary
    const calls = vi.mocked(db.execute).mock.calls;
    const insertCall = calls.find(
      ([arg]) => asStatement(arg)?.sql.includes('INSERT INTO agent_task_outputs')
    );
    expect(insertCall).toBeDefined();
    const args = asStatement(insertCall![0])!.args as unknown[];
    expect(args[7]).toBeNull();
  });
});
