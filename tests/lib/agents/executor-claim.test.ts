import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn() },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));

const mockComplete = vi.fn().mockResolvedValue('Brief summary.');
const mockCompleteWithMeta = vi.fn();

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
import { SLOT_DEFINITIONS } from '@/lib/ai/models/slots';

const TASK_ROW = {
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
};

const AGENT_CONFIG_ROW = {
  agent_type: 'general',
  display_name: 'Assistant',
  system_prompt: 'You are helpful',
  model_id: 'test-model',
  is_active: true,
};

/** Default: task lookup, agent config, then no previous output / feedback. */
function mockTaskLookups() {
  vi.mocked(queryOne)
    .mockResolvedValueOnce(TASK_ROW)
    .mockResolvedValueOnce(AGENT_CONFIG_ROW)
    .mockResolvedValueOnce(null);
}

function sqlCalls() {
  return vi
    .mocked(db.execute)
    .mock.calls.map(([arg]) => (typeof arg === 'object' ? arg : { sql: arg, args: [] }));
}

function findCall(fragment: string) {
  return sqlCalls().find((c) => c.sql?.includes(fragment));
}

describe('Agent executor task claiming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 1, rows: [] } as never);
    mockCompleteWithMeta.mockResolvedValue({
      content: 'Agent output',
      finishReason: 'stop',
      model: 'test-model',
    });
    mockComplete.mockResolvedValue('Brief summary.');
  });

  it('claims the task atomically before doing any work', async () => {
    mockTaskLookups();

    await executeAgentTask('task-1');

    const claim = findCall("status = 'processing'");
    expect(claim).toBeDefined();
    // The claim must be conditional — an unguarded UPDATE lets two workers run
    // the same task and collide on UNIQUE(agent_task_id, version_number).
    expect(claim!.sql).toContain('AND status IN');
    expect(claim!.args).toEqual(
      expect.arrayContaining(['task-1', 'queued', 'revision_requested', 'failed'])
    );
  });

  it('stands down without running the model when another worker holds the task', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(TASK_ROW);
    vi.mocked(db.execute).mockResolvedValueOnce({ rowsAffected: 0, rows: [] } as never);

    await executeAgentTask('task-1');

    expect(mockCompleteWithMeta).not.toHaveBeenCalled();
    expect(findCall('INSERT INTO agent_task_outputs')).toBeUndefined();
  });

  it('derives the output version in SQL rather than from the stale task row', async () => {
    mockTaskLookups();

    await executeAgentTask('task-1');

    const insert = findCall('INSERT INTO agent_task_outputs');
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain('COALESCE(MAX(version_number), 0) + 1');
  });

  it('clears retry_count and last_error on success', async () => {
    mockTaskLookups();

    await executeAgentTask('task-1');

    const done = findCall("status = 'awaiting_review'");
    expect(done).toBeDefined();
    expect(done!.sql).toContain('retry_count = 0');
    expect(done!.sql).toContain('last_error = NULL');
  });

  it('falls back to the model actually used when the agent config pins no model_id', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(TASK_ROW)
      .mockResolvedValueOnce({ ...AGENT_CONFIG_ROW, model_id: null })
      .mockResolvedValueOnce(null);

    await executeAgentTask('task-1');

    // model_used is NOT NULL — passing through a null model_id fails the insert
    // *after* the model call has already been paid for. With no pinned model
    // the agent slot supplies one; asserted against the slot definition rather
    // than a literal so reordering the candidates doesn't break this test.
    const insert = findCall('INSERT INTO agent_task_outputs');
    expect(insert!.args![3]).toBe(SLOT_DEFINITIONS.agent.candidates[0]);
  });
});

describe('Agent executor empty-output handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 1, rows: [] } as never);
    mockComplete.mockResolvedValue('Brief summary.');
  });

  it('fails the task instead of storing a blank output', async () => {
    mockTaskLookups();
    mockCompleteWithMeta.mockResolvedValue({
      content: '   ',
      finishReason: 'stop',
      model: 'test-model',
    });

    await expect(executeAgentTask('task-1')).rejects.toThrow(/empty response/i);

    expect(findCall('INSERT INTO agent_task_outputs')).toBeUndefined();
    const failure = findCall("status = 'failed'");
    expect(failure).toBeDefined();
    expect(failure!.sql).toContain('retry_count = COALESCE(retry_count, 0) + 1');
  });

  it('retries with a larger budget when the response was truncated to nothing', async () => {
    mockTaskLookups();
    mockCompleteWithMeta
      .mockResolvedValueOnce({ content: '', finishReason: 'length', model: 'test-model' })
      .mockResolvedValueOnce({
        content: 'Recovered output',
        finishReason: 'stop',
        model: 'test-model',
      });

    await executeAgentTask('task-1');

    expect(mockCompleteWithMeta).toHaveBeenCalledTimes(2);
    const firstBudget = mockCompleteWithMeta.mock.calls[0][1].maxTokens;
    const secondBudget = mockCompleteWithMeta.mock.calls[1][1].maxTokens;
    expect(secondBudget).toBeGreaterThan(firstBudget);

    const insert = findCall('INSERT INTO agent_task_outputs');
    expect(insert!.args![1]).toBe('Recovered output');
  });
});
