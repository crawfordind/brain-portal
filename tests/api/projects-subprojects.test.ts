import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/subprojects/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', async () => ({
  ...(await import('../helpers/db-mock')).createDbClientMock(),
  queryAll: vi.fn(() => Promise.resolve([
    {
      id: 'sub1',
      name: 'Sub Project 1',
      slug: 'sub-project-1',
      status: 'active',
      note_count: 5,
      open_task_count: 3,
      parent_id: 'proj123'
    },
    {
      id: 'sub2',
      name: 'Sub Project 2',
      slug: 'sub-project-2',
      status: 'planning',
      note_count: 2,
      open_task_count: 1,
      parent_id: 'proj123'
    }
  ]))
}));

// The route checks project access before querying. Grant it explicitly so the
// test is about the activity query, not about the permission model.
vi.mock('@/lib/permissions', () => ({
  getProjectAccess: vi.fn(() =>
    Promise.resolve({ project: { id: 'proj123', user_id: 'user123' }, role: 'owner' })
  ),
}));

describe('GET /api/projects/[id]/subprojects', () => {
  it('returns sub-projects with stats', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/subprojects');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.subprojects).toHaveLength(2);
    expect(data.subprojects[0]).toMatchObject({
      id: 'sub1',
      name: 'Sub Project 1',
      note_count: 5,
      open_task_count: 3
    });
  });
});
