import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn().mockResolvedValue('summary'),
  completeWithMeta: vi
    .fn()
    .mockResolvedValue({ content: 'Agent output', finishReason: 'stop', model: 'test-model' }),
}));
vi.mock('@/lib/agents/context', () => ({
  buildTaskContext: vi.fn().mockResolvedValue({
    attachedNotes: [],
    attachedUrls: [],
    relevantNotes: [],
    activeTasks: [],
    recentCompletions: [],
    recentCaptures: [],
  }),
  formatContextForPrompt: vi.fn().mockReturnValue(''),
}));
vi.mock('@/lib/agents/status-sync', () => ({
  syncTaskStatusFromAgentTask: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgentTask } from '@/lib/agents/executor';
import { queryOne } from '@/lib/db/client';
import { completeWithMeta } from '@/lib/ai/client';

const NOTE_HTML =
  '<p>We should <mark data-intent="expand" data-note="add 2026 numbers">raise prices</mark> ' +
  'and <mark data-intent="cut">drop the loyalty tier</mark>.</p>';

/**
 * Route the executor's queryOne calls by the shape of the SQL it issues, so the
 * test does not depend on the order in which the executor fetches things.
 */
function mockNoteDelegation({ noteHtml }: { noteHtml: string }) {
  vi.mocked(queryOne).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM agent_tasks')) {
      return {
        id: 'task-1',
        user_id: 'user-1',
        assigned_agent: 'general',
        source_type: 'note',
        source_id: 'note-1',
        description: 'We should raise prices and drop the loyalty tier.',
        title: 'Pricing note',
        context_note_ids: '[]',
        context_urls: '[]',
        output_format: 'markdown',
        current_version: 0,
        max_revisions: 5,
      } as never;
    }
    if (sql.includes('FROM agent_configs')) {
      return { agent_type: 'general', system_prompt: 'You are helpful.', model_id: null } as never;
    }
    if (sql.includes('FROM notes')) {
      return { content: noteHtml, content_plain: 'We should raise prices and drop the loyalty tier.' } as never;
    }
    return null as never;
  });
}

function promptSentToModel(): string {
  return vi.mocked(completeWithMeta).mock.calls[0][0] as string;
}

describe('Agent executor — semantic highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the reviewing model the user's highlights and what each colour means", async () => {
    mockNoteDelegation({ noteHtml: NOTE_HTML });

    await executeAgentTask('task-1');

    const prompt = promptSentToModel();
    expect(prompt).toContain('<annotations>');
    expect(prompt).toContain('[EXPAND] "raise prices"');
    expect(prompt).toContain('[CUT] "drop the loyalty tier"');
    // The meaning of each colour, not just its name
    expect(prompt).toContain('The user wants more here');
    expect(prompt).toContain('The user wants this passage removed');
    // The note attached to a specific highlight
    expect(prompt).toContain('add 2026 numbers');
    // Intents the user did not use are not explained
    expect(prompt).not.toContain('CONDENSE —');
  });

  it('adds no annotations block when the note has no highlights', async () => {
    mockNoteDelegation({ noteHtml: '<p>Plain note with no markup.</p>' });

    await executeAgentTask('task-1');

    expect(promptSentToModel()).not.toContain('<annotations>');
  });
});
