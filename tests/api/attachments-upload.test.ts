// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user1', email: 'owner@example.com' })),
}));

vi.mock('@/lib/db/client', async () => (await import('../helpers/db-mock')).createDbClientMock());

vi.mock('@/lib/storage/r2', () => ({
  isR2Configured: vi.fn(() => true),
  missingR2Config: vi.fn(() => []),
  uploadToR2: vi.fn(() => Promise.resolve('https://files.example.com/x')),
  deleteFromR2: vi.fn(() => Promise.resolve()),
  publicUrlFor: vi.fn((key: string) => `https://files.example.com/${key}`),
  getPresignedUploadUrl: vi.fn((key: string) => Promise.resolve(`https://r2.example.com/${key}?sig=1`)),
  getFileMetadata: vi.fn(() => Promise.resolve(null)),
  downloadFromR2: vi.fn(() => Promise.resolve(Buffer.alloc(0))),
}));

vi.mock('@/lib/sharing/access', () => ({
  getNoteAccess: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/permissions', () => ({
  getProjectAccess: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/processing/queue', () => ({
  enqueue: vi.fn(() => Promise.resolve('job1')),
}));

import { POST as upload, GET as list } from '@/app/api/attachments/route';
import { POST as prepare } from '@/app/api/attachments/uploads/route';
import { POST as complete } from '@/app/api/attachments/uploads/complete/route';
import * as r2 from '@/lib/storage/r2';
import * as dbClient from '@/lib/db/client';
import { getNoteAccess } from '@/lib/sharing/access';
import { enqueue } from '@/lib/processing/queue';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function uploadRequest(file: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest('http://localhost/api/attachments', { method: 'POST', body: form });
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'att1', user_id: 'user1', file_type: 'image', note_id: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(r2.isR2Configured).mockReturnValue(true);
  vi.mocked(dbClient.query).mockResolvedValue([]);
  vi.mocked(dbClient.queryOne).mockResolvedValue(null);
  vi.mocked(dbClient.mutate).mockImplementation(async (_sql, args) =>
    row({ storage_key: (args as unknown[])[5], mime_type: (args as unknown[])[3] }) as never
  );
  vi.mocked(getNoteAccess).mockResolvedValue(null);
});

describe('POST /api/attachments', () => {
  it('says plainly when storage is not configured', async () => {
    vi.mocked(r2.isR2Configured).mockReturnValue(false);
    vi.mocked(r2.missingR2Config).mockReturnValue(['R2_BUCKET_NAME']);
    const res = await upload(uploadRequest(new File([PNG], 'a.png', { type: 'image/png' })));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(body.adminHint).toContain('R2_BUCKET_NAME');
  });

  it('stores a valid image and queues its processing', async () => {
    const res = await upload(uploadRequest(new File([PNG], 'dot.png', { type: 'image/png' })));
    expect(res.status).toBe(201);
    expect(r2.uploadToR2).toHaveBeenCalledWith(expect.stringMatching(/^user1\//), expect.any(Buffer), 'image/png');
    const operations = vi.mocked(enqueue).mock.calls.map(([job]) => job.operation);
    expect(operations).toEqual(['extract_metadata', 'generate_thumbnail', 'generate_description']);
    // An attachment embedding has nowhere to be stored, so it is never queued
    expect(operations).not.toContain('generate_embedding');
  });

  it('refuses to file an upload under a note the user cannot edit', async () => {
    const res = await upload(
      uploadRequest(new File([PNG], 'dot.png', { type: 'image/png' }), { noteId: 'someone-elses' })
    );
    expect(res.status).toBe(404);
    expect(r2.uploadToR2).not.toHaveBeenCalled();
  });

  it('reuses an identical file only when it is filed in the same place', async () => {
    vi.mocked(getNoteAccess).mockResolvedValue({ note: { id: 'note1' }, role: 'owner' } as never);
    vi.mocked(dbClient.query).mockResolvedValueOnce([row({ note_id: 'note1' })]);
    const res = await upload(
      uploadRequest(new File([PNG], 'dot.png', { type: 'image/png' }), { noteId: 'note1' })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deduplicated).toBe(true);
    expect(r2.uploadToR2).not.toHaveBeenCalled();
    // The lookup is scoped to the same note
    expect(vi.mocked(dbClient.query).mock.calls[0][1]).toEqual(['user1', expect.any(String), 'note1']);
  });

  it('turns a validation failure into a readable 400', async () => {
    const res = await upload(uploadRequest(new File([PNG], 'fake.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/do not match/);
    expect(r2.uploadToR2).not.toHaveBeenCalled();
  });

  it('removes the stored file again if the row cannot be written', async () => {
    vi.mocked(dbClient.mutate).mockResolvedValueOnce(null);
    const res = await upload(uploadRequest(new File([PNG], 'dot.png', { type: 'image/png' })));
    expect(res.status).toBe(500);
    expect(r2.deleteFromR2).toHaveBeenCalledWith(vi.mocked(r2.uploadToR2).mock.calls[0][0]);
  });
});

describe('POST /api/attachments/uploads (direct upload)', () => {
  it('signs a key under the user with the resolved type', async () => {
    const res = await prepare(
      jsonRequest('/api/attachments/uploads', { filename: 'Big Report.pdf', mimeType: '', size: 30_000_000 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(/^user1\/[0-9a-f]{16}-big-report\.pdf$/);
    expect(body.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(r2.getPresignedUploadUrl).toHaveBeenCalledWith(body.key, 'application/pdf', 900);
  });

  it('refuses an oversized or disallowed file before anything is sent', async () => {
    const tooBig = await prepare(
      jsonRequest('/api/attachments/uploads', { filename: 'a.png', mimeType: 'image/png', size: 11 * 1024 * 1024 })
    );
    expect(tooBig.status).toBe(400);
    const svg = await prepare(
      jsonRequest('/api/attachments/uploads', { filename: 'a.svg', mimeType: 'image/svg+xml', size: 100 })
    );
    expect(svg.status).toBe(400);
    expect(r2.getPresignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('POST /api/attachments/uploads/complete', () => {
  it('only accepts keys under the caller', async () => {
    const res = await complete(jsonRequest('/api/attachments/uploads/complete', { key: 'user2/abc-a.png' }));
    expect(res.status).toBe(400);
    const traversal = await complete(jsonRequest('/api/attachments/uploads/complete', { key: 'user1/../user2/a.png' }));
    expect(traversal.status).toBe(400);
  });

  it('says so when the file never reached storage', async () => {
    const res = await complete(jsonRequest('/api/attachments/uploads/complete', { key: 'user1/abc-a.png' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/did not reach storage/);
  });

  it('deletes a stored file whose bytes fail validation', async () => {
    vi.mocked(r2.getFileMetadata).mockResolvedValue({ contentType: 'application/pdf', contentLength: PNG.length });
    vi.mocked(r2.downloadFromR2).mockResolvedValue(PNG);
    const res = await complete(
      jsonRequest('/api/attachments/uploads/complete', { key: 'user1/abc-fake.pdf', filename: 'fake.pdf' })
    );
    expect(res.status).toBe(400);
    expect(r2.deleteFromR2).toHaveBeenCalledWith('user1/abc-fake.pdf');
  });

  it('records a valid file under the key it was sent to, without re-uploading', async () => {
    vi.mocked(r2.getFileMetadata).mockResolvedValue({ contentType: 'image/png', contentLength: PNG.length });
    vi.mocked(r2.downloadFromR2).mockResolvedValue(PNG);
    const res = await complete(
      jsonRequest('/api/attachments/uploads/complete', { key: 'user1/abc-dot.png', filename: 'dot.png' })
    );
    expect(res.status).toBe(201);
    expect((await res.json()).attachment.storage_key).toBe('user1/abc-dot.png');
    expect(r2.uploadToR2).not.toHaveBeenCalled();
    expect(r2.deleteFromR2).not.toHaveBeenCalled();
  });

  it('refuses a file larger than its type allows without downloading it', async () => {
    vi.mocked(r2.getFileMetadata).mockResolvedValue({ contentType: 'image/png', contentLength: 50 * 1024 * 1024 });
    const res = await complete(
      jsonRequest('/api/attachments/uploads/complete', { key: 'user1/abc-huge.png', filename: 'huge.png' })
    );
    expect(res.status).toBe(400);
    expect(r2.downloadFromR2).not.toHaveBeenCalled();
    expect(r2.deleteFromR2).toHaveBeenCalledWith('user1/abc-huge.png');
  });
});

describe('GET /api/attachments', () => {
  it('bounds a bad limit instead of passing NaN to SQL', async () => {
    vi.mocked(dbClient.query).mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);
    const res = await list(new NextRequest('http://localhost/api/attachments?limit=abc&offset=-5&fileType=image'));
    expect(res.status).toBe(200);
    const listArgs = vi.mocked(dbClient.query).mock.calls[1][1] as unknown[];
    expect(listArgs.slice(-2)).toEqual([50, 0]);
    expect(listArgs).toContain('image');
  });

  it("lists every file on a note shared with the viewer, not only the viewer's own", async () => {
    vi.mocked(getNoteAccess).mockResolvedValue({
      note: { id: 'note1' },
      role: 'viewer',
      via: 'share',
      share: null,
    } as never);
    vi.mocked(dbClient.query)
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([row({ user_id: 'owner1', note_id: 'note1' })]);

    const res = await list(new NextRequest('http://localhost/api/attachments?noteId=note1'));
    expect(res.status).toBe(200);
    expect(getNoteAccess).toHaveBeenCalledWith('note1', 'user1');

    const [sql, args] = vi.mocked(dbClient.query).mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('WHERE a.note_id = ?');
    expect(sql).not.toContain('a.user_id = ?');
    expect(args[0]).toBe('note1');

    const body = await res.json();
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].can_manage).toBe(false);
  });

  it('marks the viewer\'s own uploads as manageable', async () => {
    vi.mocked(getNoteAccess).mockResolvedValue({
      note: { id: 'note1' },
      role: 'owner',
      via: 'owner',
      share: null,
    } as never);
    vi.mocked(dbClient.query)
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([
        row({ id: 'mine', note_id: 'note1' }),
        row({ id: 'editors', user_id: 'editor1', note_id: 'note1' }),
      ]);

    const body = await (await list(new NextRequest('http://localhost/api/attachments?noteId=note1'))).json();
    expect(body.attachments.map((a: { id: string; can_manage: boolean }) => [a.id, a.can_manage])).toEqual([
      ['mine', true],
      ['editors', false],
    ]);
  });

  it('refuses the files of a note the viewer cannot open', async () => {
    vi.mocked(getNoteAccess).mockResolvedValue(null);
    const res = await list(new NextRequest('http://localhost/api/attachments?noteId=someone-elses'));
    expect(res.status).toBe(404);
    expect(dbClient.query).not.toHaveBeenCalled();
  });

  it('keeps search scoped to the note when both are given', async () => {
    vi.mocked(getNoteAccess).mockResolvedValue({
      note: { id: 'note1' },
      role: 'editor',
      via: 'project',
      share: null,
    } as never);
    vi.mocked(dbClient.query).mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);

    await list(new NextRequest('http://localhost/api/attachments?noteId=note1&search=invoice'));
    const [sql, args] = vi.mocked(dbClient.query).mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('WHERE a.note_id = ? AND attachments_fts MATCH ?');
    expect(args.slice(0, 2)).toEqual(['note1', '"invoice"*']);
  });
});
