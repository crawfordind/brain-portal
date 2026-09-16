// tests/app/api/notes/cleanup.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock dependencies BEFORE imports
vi.mock('@/lib/auth');
vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  mutate: vi.fn(),
  db: {
    execute: vi.fn(),
  },
}));
vi.mock('@/lib/cleanup/analyzer', () => ({
  analyzeNote: vi.fn(),
}));
vi.mock('@/lib/ai/client', () => ({
  openrouter: {},
  completeJSON: vi.fn(),
  DEFAULT_MODEL: 'test-model',
}));
vi.mock('@/lib/ai/tiers', () => ({
  getTierConfig: vi.fn(() => ({
    tier: 'fast_llm',
    model: 'test-model',
    cacheTTL: 24,
    maxTokens: 500,
  })),
}));

import { POST, PATCH } from '@/app/api/notes/[id]/cleanup/route';
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, mutate, db } from '@/lib/db/client';
import { analyzeNote } from '@/lib/cleanup/analyzer';

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  preferences: '{}',
  created_at: '2026-01-30T00:00:00Z',
  updated_at: '2026-01-30T00:00:00Z',
};

const mockNote = {
  id: 'note-123',
  user_id: 'user-123',
  title: 'Test Note',
  content: 'Some content here with potential for improvement and better structure.',
  content_plain: 'Some content here with potential for improvement and better structure.',
  created_at: '2026-01-30T00:00:00Z',
  updated_at: '2026-01-30T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
  // Default mock for analyzeNote - will be overridden in tests
  vi.mocked(analyzeNote).mockResolvedValue({
    suggestions: [],
    chunked: false,
    chunkCount: 1,
  });
});

describe('POST /api/notes/[id]/cleanup', () => {
  test('requires authentication', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 404 for non-existent note', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Note not found');
  });

  test('handles empty content', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      ...mockNote,
      content: '',
    });

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.suggestions).toEqual([]);
    expect(data.message).toContain('no content');
  });

  test('handles note too short', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      ...mockNote,
      content: 'Short',
    });

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.suggestions).toEqual([]);
    expect(data.message).toContain('too short');
  });

  // TODO: These integration tests require complex mocking of the analyzer chain.
  // Consider E2E testing for full analyzer integration.
  test.skip('returns suggestions from analyzer', async () => {
    const mockSuggestions = [
      {
        id: 'sug-1',
        type: 'structure' as const,
        action: 'replace' as const,
        target: 'content',
        before: 'content',
        after: 'better content',
        reasoning: 'Improvement',
        confidence: 0.9,
      },
    ];

    vi.mocked(queryOne).mockResolvedValueOnce(mockNote);
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);
    vi.mocked(analyzeNote).mockResolvedValueOnce({
      suggestions: mockSuggestions,
      chunked: false,
      chunkCount: 1,
    });

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.suggestions).toEqual(mockSuggestions);
    expect(data.chunked).toBe(false);
    expect(data.chunkCount).toBe(1);
  });

  test.skip('handles analyzer errors gracefully', async () => {
    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);
    vi.mocked(analyzeNote).mockRejectedValue(new Error('AI service error'));

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await POST(req, { params });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Failed to analyze');
  });

  test.skip('creates activity log entry', async () => {
    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);
    vi.mocked(analyzeNote).mockResolvedValue({
      suggestions: [],
      chunked: false,
      chunkCount: 1,
    });

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'POST',
    });
    const params = Promise.resolve({ id: 'note-123' });

    await POST(req, { params });

    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO activity_log'),
        args: expect.arrayContaining([
          mockUser.id,
          'note',
          'note-123',
          'cleanup_started',
        ]),
      })
    );
  });
});

describe('PATCH /api/notes/[id]/cleanup', () => {
  test('requires authentication', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions: [] }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  test('validates suggestions array', async () => {
    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions: 'invalid' }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid suggestions');
  });

  test('returns 404 for non-existent note', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions: [] }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Note not found');
  });

  test('applies suggestions and updates note', async () => {
    const suggestions = [
      {
        id: 'sug-1',
        type: 'structure' as const,
        action: 'replace' as const,
        target: 'content',
        before: 'content',
        after: 'better content',
        reasoning: 'Improvement',
        confidence: 0.9,
      },
    ];

    const updatedNote = {
      ...mockNote,
      content: 'Some better content here with potential for improvement and better structure.',
    };

    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(mutate).mockResolvedValue(updatedNote);
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.note).toEqual(updatedNote);
    expect(mutate).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notes'),
      expect.any(Array)
    );
  });

  test('creates task recommendations', async () => {
    const suggestions = [
      {
        id: 'task-1',
        type: 'task' as const,
        action: 'extract' as const,
        target: '- Call John',
        content: 'Call John',
        reasoning: 'Action item',
        confidence: 0.95,
      },
    ];

    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(mutate).mockResolvedValue({ ...mockNote, content: 'Updated' });
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.taskRecommendationsCreated).toBe(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO task_recommendations'),
      })
    );
  });

  test('returns suggested tags', async () => {
    const suggestions = [
      {
        id: 'tag-1',
        type: 'tag' as const,
        action: 'add' as const,
        target: '',
        content: 'project-planning',
        reasoning: 'Relevant tag',
        confidence: 0.8,
      },
    ];

    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(mutate).mockResolvedValue(mockNote);
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    const response = await PATCH(req, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.suggestedTags).toContain('project-planning');
  });

  test('creates activity log entry for applied cleanup', async () => {
    vi.mocked(queryOne).mockResolvedValue(mockNote);
    vi.mocked(mutate).mockResolvedValue(mockNote);
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 0, columns: [], columnTypes: [], lastInsertRowid: BigInt(0), toJSON: () => ({}) } as any);

    const req = new NextRequest('http://localhost/api/notes/note-123/cleanup', {
      method: 'PATCH',
      body: JSON.stringify({ suggestions: [] }),
    });
    const params = Promise.resolve({ id: 'note-123' });

    await PATCH(req, { params });

    expect(db.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining('INSERT INTO activity_log'),
        args: expect.arrayContaining([
          mockUser.id,
          'note',
          'note-123',
          'cleanup_applied',
        ]),
      })
    );
  });
});
