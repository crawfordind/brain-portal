import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/validation', () => ({
  verifyCronSecret: vi.fn().mockReturnValue(null),
}));
vi.mock('@/lib/agents/jack/dispatcher', () => ({
  runJackQueuePass: vi.fn(),
}));
// If anything on this route's import graph reached for OpenRouter, these
// would record it. The worker must never call them.
vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn(() => { throw new Error('OpenRouter must not be called by the task worker'); }),
  completeWithMeta: vi.fn(() => { throw new Error('OpenRouter must not be called by the task worker'); }),
}));

import { GET } from '@/app/api/cron/process-agent-queue/route';
import { runJackQueuePass } from '@/lib/agents/jack/dispatcher';
import { verifyCronSecret } from '@/lib/api/validation';
import { complete, completeWithMeta } from '@/lib/ai/client';
import { NextRequest, NextResponse } from 'next/server';

const makeRequest = () =>
  new NextRequest('http://localhost/api/cron/process-agent-queue', { method: 'GET' });

const REPORT = {
  configured: true,
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
    vi.mocked(runJackQueuePass).mockResolvedValue(REPORT);
  });

  it('runs one Jack queue pass and reports its counts', async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(runJackQueuePass).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ success: true, runtime: 'jack', ...REPORT });
  });

  it('never calls OpenRouter', async () => {
    await GET(makeRequest());
    expect(complete).not.toHaveBeenCalled();
    expect(completeWithMeta).not.toHaveBeenCalled();
  });

  it('keeps the pass inside the function ceiling', async () => {
    await GET(makeRequest());
    const [, options] = vi.mocked(runJackQueuePass).mock.calls[0];
    expect(options?.budgetMs).toBeLessThan(300_000);
  });

  it('rejects requests without the cron secret before doing anything', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(runJackQueuePass).not.toHaveBeenCalled();
  });

  it('answers 500 without leaking the underlying error', async () => {
    vi.mocked(runJackQueuePass).mockRejectedValue(new Error('SQLITE_BUSY at libsql://secret-host'));
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-host');
  });
});
