import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/stats/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(() => Promise.resolve({
    noteCount: 15,
    taskCount: 23,
    activeTasks: 8,
    completedTasks: 15,
    captureCount: 12,
    agentTaskCount: 3,
    recentActivityCount: 42,
    subProjectCount: 2
  }))
}));

describe('GET /api/projects/[id]/stats', () => {
  it('returns stats for a project', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/stats');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stats).toMatchObject({
      noteCount: 15,
      taskCount: 23,
      activeTasks: 8,
      completedTasks: 15,
      captureCount: 12,
      agentTaskCount: 3,
      recentActivityCount: 42,
      subProjectCount: 2
    });
  });

  it('returns 401 when not authenticated', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/projects/proj123/stats');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });

    expect(response.status).toBe(401);
  });
});
