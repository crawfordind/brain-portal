import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/activities/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', async () => ({
  ...(await import('../helpers/db-mock')).createDbClientMock(),
  queryAll: vi.fn(() => Promise.resolve([
    {
      id: 'act1',
      entity_type: 'note',
      entity_id: 'note1',
      action: 'created',
      created_at: '2026-02-13T10:00:00Z'
    },
    {
      id: 'act2',
      entity_type: 'task',
      entity_id: 'task1',
      action: 'completed',
      created_at: '2026-02-13T09:00:00Z'
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

describe('GET /api/projects/[id]/activities', () => {
  it('returns activities with default limit', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/activities');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.activities).toHaveLength(2);
    expect(data.activities[0].entity_type).toBe('note');
  });

  it('respects limit query param', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/activities?limit=10');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
  });
});
