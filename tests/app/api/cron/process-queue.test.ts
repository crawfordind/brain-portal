import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rowsAffected: 0, rows: [] }) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/api/validation', () => ({
  verifyCronSecret: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/processing/processors', () => ({
  runJob: vi.fn().mockResolvedValue(undefined),
  SERVERLESS_OPERATIONS: ['generate_embedding', 'generate_summary'],
}));

vi.mock('@/lib/processing/sweep', () => ({
  sweepUnprocessedContent: vi.fn().mockResolvedValue({
    notesQueued: 0,
    capturesQueued: 0,
    unchanged: 0,
    jobsQueued: 0,
    errors: 0,
  }),
}));

import { GET } from '@/app/api/cron/process-queue/route';
import { db, queryAll } from '@/lib/db/client';
import { sweepUnprocessedContent } from '@/lib/processing/sweep';
import { NextRequest } from 'next/server';

const makeRequest = () =>
  new NextRequest('http://localhost/api/cron/process-queue', { method: 'GET' });

function updates() {
  return vi
    .mocked(db.execute)
    .mock.calls.map(([arg]) => (typeof arg === 'object' ? arg : { sql: String(arg), args: [] }));
}

function updatesMatching(fragment: string) {
  return updates().filter((c) => c.sql?.includes(fragment));
}

describe('GET /api/cron/process-queue — stuck job recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 0, rows: [] } as never);
  });

  it('only returns a stuck job to pending while it has a retry left', async () => {
    // The worker claims with `attempts < max_attempts`. Recycling a job that has
    // spent them all puts it somewhere nothing will ever look at it again.
    await GET(makeRequest());

    const reset = updatesMatching("SET status = 'pending'").filter((c) =>
      c.sql?.includes("status = 'processing'")
    );
    expect(reset).toHaveLength(1);
    expect(reset[0].sql).toContain('attempts < max_attempts');
  });

  it('retires a stuck job that has exhausted its retries instead of recycling it', async () => {
    await GET(makeRequest());

    const retire = updatesMatching("SET status = 'failed'").filter((c) =>
      c.sql?.includes("status = 'processing'")
    );
    expect(retire).toHaveLength(1);
    expect(retire[0].sql).toContain('attempts >= max_attempts');
    // Dated, so the health check's lookback window can see it.
    expect(retire[0].sql).toContain('completed_at');
  });

  it('retires jobs an earlier build stranded in pending with no retries left', async () => {
    // These are invisible to the worker and visible to the health check, which
    // is what produced a permanent "background work is not being picked up".
    await GET(makeRequest());

    const stranded = updatesMatching("SET status = 'failed'").filter((c) =>
      c.sql?.includes("WHERE status = 'pending'")
    );
    expect(stranded).toHaveLength(1);
    expect(stranded[0].sql).toContain('attempts >= max_attempts');
  });

  it('reports how many jobs it retired', async () => {
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 2, rows: [] } as never);

    const body = await (await GET(makeRequest())).json();

    // Two stuck-and-exhausted plus two stranded.
    expect(body.stuck_retired).toBe(4);
    expect(body.success).toBe(true);
  });

  it('never claims a job that has no retries left', async () => {
    await GET(makeRequest());

    const claims = updates().filter((c) => c.sql?.includes("SET status = 'processing'"));
    for (const claim of claims) {
      expect(claim.sql).toContain("status = 'pending'");
    }
  });
});

describe('GET /api/cron/process-queue — content sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.execute).mockResolvedValue({ rowsAffected: 0, rows: [] } as never);
  });

  it('sweeps for unprocessed content before draining, so what it queues runs this pass', async () => {
    await GET(makeRequest());

    expect(sweepUnprocessedContent).toHaveBeenCalledTimes(1);
    const sweptAt = vi.mocked(sweepUnprocessedContent).mock.invocationCallOrder[0];
    const firstDrain = vi.mocked(queryAll).mock.invocationCallOrder[0];
    expect(sweptAt).toBeLessThan(firstDrain);
  });

  it('reports what the sweep did', async () => {
    vi.mocked(sweepUnprocessedContent).mockResolvedValueOnce({
      notesQueued: 2,
      capturesQueued: 1,
      unchanged: 3,
      jobsQueued: 9,
      errors: 0,
    });

    const body = await (await GET(makeRequest())).json();
    expect(body.sweep).toMatchObject({ notesQueued: 2, jobsQueued: 9 });
  });
});
