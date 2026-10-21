// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', async () => (await import('../../helpers/db-mock')).createDbClientMock());

vi.mock('@/lib/processing/attachments', () => ({
  downloadAttachment: vi.fn(() => Promise.resolve(Buffer.from('bytes'))),
  extractImageMetadata: vi.fn(() => Promise.resolve({ width: 10, height: 20 })),
  generateThumbnail: vi.fn(() => Promise.resolve('dGh1bWI=')),
  extractTextContent: vi.fn(() => Promise.resolve({ text: 'Quarterly numbers', metadata: { numPages: 2 } })),
  generateImageDescription: vi.fn(() => Promise.resolve('A whiteboard')),
}));

import { runJob, settleAttachmentStatus, SERVERLESS_OPERATIONS, type QueueJob } from '@/lib/processing/processors';
import * as dbClient from '@/lib/db/client';
import * as media from '@/lib/processing/attachments';

function job(operation: string, overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: 'job1',
    user_id: 'user1',
    entity_type: 'attachment',
    entity_id: 'att1',
    operation,
    tier: 'local',
    metadata: null,
    ...overrides,
  };
}

const pdf = { id: 'att1', user_id: 'user1', file_type: 'pdf', mime_type: 'application/pdf', description: null };
const image = { id: 'att1', user_id: 'user1', file_type: 'image', mime_type: 'image/png', description: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('attachment jobs in the production worker', () => {
  it('are among the operations the cron runs', () => {
    for (const op of ['extract_metadata', 'generate_thumbnail', 'extract_text', 'generate_description']) {
      expect(SERVERLESS_OPERATIONS).toContain(op);
    }
  });

  it('completes a leftover attachment embedding job as a no-op', async () => {
    await expect(runJob(job('generate_embedding'))).resolves.toBeUndefined();
    expect(dbClient.queryOne).not.toHaveBeenCalled();
    expect(dbClient.db.execute).not.toHaveBeenCalled();
  });

  it('does nothing, and does not fail, for an attachment deleted since it was queued', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(null);
    await expect(runJob(job('extract_text'))).resolves.toBeUndefined();
    expect(media.downloadAttachment).not.toHaveBeenCalled();
  });

  it('stores extracted text and rebuilds the searchable text from both halves', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(pdf as never);
    await runJob(job('extract_text'));
    const calls = vi.mocked(dbClient.db.execute).mock.calls.map(([q]) => q as unknown as { sql: string; args: unknown[] });
    expect(calls[0].args[0]).toBe('Quarterly numbers');
    expect(calls[0].sql).toContain('json_patch');
    expect(calls[1].sql).toMatch(/content_plain = NULLIF\(trim\(\s*COALESCE\(description/);
  });

  it('never replaces a description the user wrote', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue({ ...image, description: 'My caption' } as never);
    await runJob(job('generate_description'));
    expect(media.generateImageDescription).not.toHaveBeenCalled();
  });

  it('describes an image as its owner', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(image as never);
    await runJob(job('generate_description'));
    expect(media.generateImageDescription).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', 'user1');
  });

  it('merges the thumbnail into existing metadata rather than replacing it', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(image as never);
    await runJob(job('generate_thumbnail'));
    const [query] = vi.mocked(dbClient.db.execute).mock.calls[0] as unknown as [{ sql: string; args: unknown[] }];
    expect(query.sql).toContain('json_patch');
    expect(JSON.parse(query.args[0] as string)).toEqual({ thumbnail: 'dGh1bWI=' });
  });

  it('settles only once nothing is pending for the attachment', async () => {
    await settleAttachmentStatus('att1');
    const [query] = vi.mocked(dbClient.db.execute).mock.calls[0] as unknown as [{ sql: string; args: unknown[] }];
    expect(query.sql).toMatch(/NOT EXISTS[\s\S]*status IN \('pending', 'processing'\)/);
    expect(query.args).toEqual(['att1']);
  });
});

describe('iPhone photos', () => {
  const heic = { ...image, mime_type: 'image/heic' };

  it('skips a thumbnail it cannot decode instead of failing the job', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(heic as never);
    vi.mocked(media.generateThumbnail).mockRejectedValueOnce(new Error('Input buffer contains unsupported image format'));
    await expect(runJob(job('generate_thumbnail'))).resolves.toBeUndefined();
    expect(dbClient.db.execute).not.toHaveBeenCalled();
  });

  it('still reports a real failure on a decodable format', async () => {
    vi.mocked(dbClient.queryOne).mockResolvedValue(image as never);
    vi.mocked(media.generateThumbnail).mockRejectedValueOnce(new Error('R2 timeout'));
    await expect(runJob(job('generate_thumbnail'))).rejects.toThrow('R2 timeout');
  });
});
