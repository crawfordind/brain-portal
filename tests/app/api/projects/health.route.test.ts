import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn().mockResolvedValue('This project has stalled.'),
  DEFAULT_MODEL: 'test-model',
}));

import { GET } from '@/app/api/projects/[id]/health/route';
import { queryOne, queryAll, db } from '@/lib/db/client';
import { complete } from '@/lib/ai/client';
import { NextRequest } from 'next/server';

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/projects/${id}/health`);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Helper: healthy stats
const healthyStats = {
  days_since_last_note: 2,
  active_tasks: 2,
  urgent_or_high_tasks: 0,
  overdue_tasks: 0,
};

describe('GET /api/projects/[id]/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryOne).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return { id: 'proj-1', name: 'Test', status: 'active' };
      if (sql.includes('ai_cache')) return null;
      if (sql.includes('FROM insights')) return null;
      return null;
    });
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('days_since_last_note')) return [{ days_since_last_note: healthyStats.days_since_last_note }];
      if (sql.includes('active_tasks')) return [{ active_tasks: healthyStats.active_tasks, urgent_or_high_tasks: healthyStats.urgent_or_high_tasks, overdue_tasks: healthyStats.overdue_tasks }];
      return [];
    });
  });

  it('returns healthy when no rules fire', async () => {
    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.healthy).toBe(true);
    expect(body.risks).toHaveLength(0);
  });

  it('flags stalled when no notes for 10 days with open tasks', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('days_since_last_note')) return [{ days_since_last_note: 10 }];
      if (sql.includes('active_tasks')) return [{ active_tasks: 3, urgent_or_high_tasks: 0, overdue_tasks: 0 }];
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.healthy).toBe(false);
    expect(body.risks.some((r: any) => r.type === 'stalled')).toBe(true);
  });

  it('flags overdue_tasks when tasks are past due', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('days_since_last_note')) return [{ days_since_last_note: 2 }];
      if (sql.includes('active_tasks')) return [{ active_tasks: 5, urgent_or_high_tasks: 0, overdue_tasks: 4 }];
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.risks.some((r: any) => r.type === 'overdue_tasks')).toBe(true);
  });

  it('flags abandoned when no notes for 30+ days', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('days_since_last_note')) return [{ days_since_last_note: 35 }];
      if (sql.includes('active_tasks')) return [{ active_tasks: 2, urgent_or_high_tasks: 0, overdue_tasks: 0 }];
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.risks.some((r: any) => r.type === 'abandoned')).toBe(true);
    expect(body.overallRisk).toBe('critical');
  });

  it('does not call LLM when healthy', async () => {
    await GET(makeRequest('proj-1'), makeParams('proj-1'));
    expect(complete).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);
    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    expect(res.status).toBe(404);
  });
});
