import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowsAffected: 0, rows: [] }) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/agents/executor', () => ({
  executeAgentTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/api/validation', () => ({
  verifyCronSecret: vi.fn().mockReturnValue(null),
}));

import { GET } from '@/app/api/cron/process-agent-queue/route';
import { db, queryAll } from '@/lib/db/client';
import { executeAgentTask } from '@/lib/agents/executor';
import { NextRequest } from 'next/server';

const makeRequest = () =>
  new NextRequest('http://localhost/api/cron/process-agent-queue', { method: 'GET' });

function updatesMatching(fragment: string) {
  return vi
    .mocked(db.execute)
    .mock.calls.map(([arg]) => (typeof arg === 'object' ? arg : { sql: arg, args: [] }))
    .filter((c) => c.sql?.includes(fragment));
}

describe('GET /api/cron/process-agent-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 0, rows: [] } as never);
    // No stuck tasks, no queued tasks by default.
    vi.mocked(queryAll).mockResolvedValue([]);
  });

  it('recovers revisions abandoned by their originating request', async () => {
    // 'revision_requested' is neither 'queued' nor 'processing', so before this
    // sweep an abandoned revision was never picked up by anything.
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 2, rows: [] } as never);

    const response = await GET(makeRequest());
    const body = await response.json();

    const sweep = updatesMatching("status = 'revision_requested'");
    expect(sweep).toHaveLength(1);
    expect(sweep[0].sql).toContain("SET status = 'queued'");
    expect(body.revisions_recovered).toBe(2);
  });

  it('re-queues failed tasks that still have retry budget', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 3, rows: [] } as never);

    const response = await GET(makeRequest());
    const body = await response.json();

    const sweep = updatesMatching("WHERE status = 'failed'");
    expect(sweep).toHaveLength(1);
    expect(sweep[0].sql).toContain('COALESCE(retry_count, 0) < COALESCE(max_retries, 3)');
    expect(body.failures_requeued).toBe(3);
  });

  it('only resets a stuck task while it is still in processing', async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        { id: 'stuck-1', title: 'Stuck', updated_at: '2026-01-01', retry_count: 0, max_retries: 3 },
      ])
      .mockResolvedValueOnce([]);

    await GET(makeRequest());

    const reset = updatesMatching("SET status = 'queued'").find((c) =>
      c.sql?.includes('retry_count = ?')
    );
    expect(reset).toBeDefined();
    // Guards against clobbering a task another worker legitimately re-claimed
    // between the SELECT and this UPDATE.
    expect(reset!.sql).toContain("WHERE id = ? AND status = 'processing'");
  });

  it('retires a stuck task once its retry budget is exhausted', async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        { id: 'stuck-1', title: 'Stuck', updated_at: '2026-01-01', retry_count: 3, max_retries: 3 },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(makeRequest());
    const body = await response.json();

    const retire = updatesMatching('Max retries exceeded after timeout');
    expect(retire).toHaveLength(1);
    expect(body.stuck_reset).toBe(0);
    expect(body.failed).toBe(1);
  });

  it('executes queued tasks and reports the count', async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'q-1', title: 'One' },
        { id: 'q-2', title: 'Two' },
      ]);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(executeAgentTask).toHaveBeenCalledTimes(2);
    expect(body.processed).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('does not overwrite the executor-recorded failure of an already-marked task', async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'q-1', title: 'One' }]);
    vi.mocked(executeAgentTask).mockRejectedValueOnce(new Error('model exploded'));

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.failed).toBe(1);
    const safetyNet = updatesMatching("SET status = 'failed'").find((c) =>
      c.sql?.includes('last_error = ?')
    );
    expect(safetyNet).toBeDefined();
    // Scoped to 'processing' so it can't stomp the precise error the executor
    // already wrote for this task.
    expect(safetyNet!.sql).toContain("WHERE id = ? AND status = 'processing'");
  });
});
