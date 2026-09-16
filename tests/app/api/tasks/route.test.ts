import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/db/client', async () => ({
  ...(await import('../../../helpers/db-mock')).createDbClientMock(),
  mutate: vi.fn().mockResolvedValue({ id: 'task-1', content: 'Write blog post' }),
}));
vi.mock('@/lib/tasks/parse', () => ({
  parseTaskNL: vi.fn().mockResolvedValue({
    title: 'Write blog post',
    dueDate: '2026-02-27',
    priority: 'urgent',
    agent: null,
    tags: ['blog'],
  }),
}));

import { POST } from '@/app/api/tasks/route';
import { db, queryOne, mutate } from '@/lib/db/client';
import { parseTaskNL } from '@/lib/tasks/parse';
import { NextRequest } from 'next/server';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryOne).mockResolvedValue({ id: 'task-1' }); // return created task
    vi.mocked(parseTaskNL).mockResolvedValue({
      title: 'Write blog post',
      dueDate: '2026-02-27',
      priority: 'urgent',
      agent: null,
      tags: ['blog'],
    });
  });

  it('calls parseTaskNL with content and today', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    await POST(req);

    expect(parseTaskNL).toHaveBeenCalledWith(
      'Write blog post by Friday urgent',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'user-1'
    );
  });

  it('stores parsed title (not raw content) in DB', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    await POST(req);

    const insertCall = vi.mocked(mutate).mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const args = insertCall![1];
    expect(args).toContain('Write blog post'); // parsed title, not raw
  });

  it('uses parsed priority when body priority is default medium', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent', priority: 'medium' });
    await POST(req);

    const insertCall = vi.mocked(mutate).mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const args = insertCall![1];
    expect(args).toContain('urgent'); // from parsed priority
  });

  it('uses explicit priority over parsed when user changed it', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent', priority: 'low' });
    await POST(req);

    const insertCall = vi.mocked(mutate).mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const args = insertCall![1];
    expect(args).toContain('low'); // explicit user value wins
  });

  it('returns parsed fields in response', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.parsed).toBeDefined();
    expect(body.parsed.title).toBe('Write blog post');
    expect(body.parsed.dueDate).toBe('2026-02-27');
  });

  it('proceeds normally when parseTaskNL returns null', async () => {
    vi.mocked(parseTaskNL).mockResolvedValueOnce(null);
    const req = makeRequest({ content: 'some task' });
    const res = await POST(req);

    expect(res.status).toBe(201);
  });
});
