import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/validation', () => ({
  verifyCronSecret: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/agents/runtime/dispatcher', () => ({
  runQueuePass: vi.fn(),
}));

import { GET } from '@/app/api/cron/process-agent-queue/route';
import { runQueuePass } from '@/lib/agents/runtime/dispatcher';
import { verifyCronSecret } from '@/lib/api/validation';
import { NextRequest, NextResponse } from 'next/server';

const makeRequest = () =>
  new NextRequest('http://localhost/api/cron/process-agent-queue', { method: 'GET' });

// Which runtime runs (and that there is no fallback between them) is the
// dispatcher's business, covered in dispatcher.integration.test.ts. The
// route's job is auth, the time budget and an honest report.
const REPORT = {
  runtime: 'hermes' as const,
  configured: true,
  requeued: 0,
  adopted: 1,
  dispatched: 2,
  retried: 0,
  polled: 3,
  completed: 1,
  failed: 0,
  unreachable: 0,
  deferred: false,
};

describe('GET /api/cron/process-agent-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCronSecret).mockReturnValue(null);
    vi.mocked(runQueuePass).mockResolvedValue(REPORT);
  });

  it('runs one queue pass and reports its counts', async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(runQueuePass).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ success: true, ...REPORT });
  });

  it('keeps the pass inside the function ceiling', async () => {
    await GET(makeRequest());
    const [, options] = vi.mocked(runQueuePass).mock.calls[0];
    expect(options?.budgetMs).toBeLessThan(300_000);
  });

  it('rejects requests without the cron secret before doing anything', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(runQueuePass).not.toHaveBeenCalled();
  });

  it('answers 500 without leaking the underlying error', async () => {
    vi.mocked(runQueuePass).mockRejectedValue(new Error('SQLITE_BUSY at libsql://secret-host'));
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-host');
  });
});
