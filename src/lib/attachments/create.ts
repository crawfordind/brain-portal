/**
 * Turning uploaded bytes into an attachment row.
 *
 * Every way a file arrives (a small upload posted through the app, a large one
 * sent straight to storage, a sketch) ends here, so they validate, deduplicate,
 * link and queue processing the same way. Before this, each route carried its
 * own copy and they had drifted: the sketch route queued a job nothing can run,
 * and none of them checked that the note an upload claimed to belong to was the
 * uploader's.
 */

import { query, mutate, db } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';
import { enqueue } from '@/lib/processing/queue';
import { deleteFromR2, publicUrlFor, uploadToR2 } from '@/lib/storage/r2';
import { calculateHash, generateStorageKey, validateFile } from '@/lib/storage/validation';
import { cleanFilename, type FileType } from '@/lib/storage/upload-policy';
import { getNoteAccess } from '@/lib/sharing/access';
import { getProjectAccess } from '@/lib/permissions';

export class AttachmentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/**
 * Check that the note and project an attachment is filed under are ones the
 * uploader may write to, and return their canonical ids. A note may be named
 * by slug; the row stores its id.
 *
 * Unchecked, any id was accepted, and the attachments list (which joins the
 * note for its title) then showed the title of a note in someone else's
 * account.
 */
export async function resolveAttachmentLinks(
  userId: string,
  links: { noteId?: string | null; projectId?: string | null }
): Promise<{ noteId: string | null; projectId: string | null }> {
  let noteId: string | null = null;
  let projectId: string | null = null;

  if (links.noteId) {
    const access = await getNoteAccess(links.noteId, userId);
    if (!access || access.role === 'viewer') {
      throw new AttachmentError('Note not found', 404);
    }
    noteId = access.note.id;
  }

  if (links.projectId) {
    const access = await getProjectAccess(links.projectId, userId);
    if (!access || access.role === 'viewer') {
      throw new AttachmentError('Project not found', 404);
    }
    projectId = access.project.id;
  }

  return { noteId, projectId };
}

/** Comma-separated or JSON-array tags, cleaned and bounded. */
export function parseTags(raw: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : raw.split(',');
    } catch {
      list = raw.split(',');
    }
  }
  const tags = list
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().slice(0, 50))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 20);
}

/**
 * An existing attachment with the same bytes that this upload can reuse: one
 * filed in the same place. Identical bytes filed under another note are a
 * different attachment; returning that one (as the route used to) made the
 * upload appear in this note and vanish on reload, because it still belonged
 * to the other.
 */
async function findReusable(
  userId: string,
  contentHash: string,
  noteId: string | null
): Promise<Attachment | null> {
  const rows = await query<Attachment>(
    `SELECT * FROM attachments
     WHERE user_id = ? AND content_hash = ? AND note_id IS ?
     ORDER BY created_at ASC LIMIT 1`,
    [userId, contentHash, noteId]
  );
  return rows[0] ?? null;
}

/** Jobs that make an upload useful: metadata, thumbnail, text, description. */
export async function queueAttachmentProcessing(
  userId: string,
  attachment: Pick<Attachment, 'id' | 'file_type'>
): Promise<void> {
  const jobs: Array<{ operation: Parameters<typeof enqueue>[0]['operation']; tier: 'local' | 'embedding' | 'fast_llm'; priority: number }> = [];

  if (attachment.file_type === 'image') {
    jobs.push(
      { operation: 'extract_metadata', tier: 'local', priority: 2 },
      { operation: 'generate_thumbnail', tier: 'local', priority: 2 },
      { operation: 'generate_description', tier: 'fast_llm', priority: 1 }
    );
  } else if (attachment.file_type === 'pdf' || attachment.file_type === 'document') {
    jobs.push({ operation: 'extract_text', tier: 'local', priority: 1 });
  } else if (attachment.file_type === 'audio') {
    jobs.push({ operation: 'extract_text', tier: 'fast_llm', priority: 1 });
  }

  if (jobs.length === 0) {
    // Video and the like: nothing to extract, so nothing is pending
    await db.execute({
      sql: `UPDATE attachments SET processing_status = 'completed' WHERE id = ?`,
      args: [attachment.id],
    });
    return;
  }

  for (const job of jobs) {
    await enqueue({
      userId,
      entityType: 'attachment',
      entityId: attachment.id,
      operation: job.operation,
      tier: job.tier,
      priority: job.priority,
    });
  }
}

export interface CreateAttachmentInput {
  userId: string;
  buffer: Buffer;
  /** What the client said the file was; checked against the bytes. */
  declaredType: string;
  filename: string;
  noteId: string | null;
  projectId: string | null;
  description?: string | null;
  tags?: string[];
  /**
   * The object is already in storage under this key (a direct upload). It is
   * removed again if the upload is refused or turns out to be a duplicate.
   */
  storedKey?: string;
  /** Extra columns for uploads that arrive already processed (sketches). */
  preprocessed?: {
    extractedText?: string | null;
    contentPlain?: string | null;
    metadata?: Record<string, unknown>;
  };
}

export interface CreateAttachmentResult {
  attachment: Attachment;
  deduplicated: boolean;
}

async function discard(key: string | undefined): Promise<void> {
  if (!key) return;
  try {
    await deleteFromR2(key);
  } catch (error) {
    console.error('Failed to remove refused upload from storage:', error);
  }
}

/**
 * Validate, store (unless already stored), record and queue one file. Links
 * must already be resolved with `resolveAttachmentLinks`. Throws
 * `AttachmentError` with an HTTP status for anything the user can act on.
 */
export async function createAttachment(input: CreateAttachmentInput): Promise<CreateAttachmentResult> {
  const filename = cleanFilename(input.filename);

  const validation = await validateFile(input.buffer, input.declaredType, filename);
  if (!validation.valid || !validation.mimeType || !validation.fileType) {
    await discard(input.storedKey);
    throw new AttachmentError(validation.error ?? 'File rejected', 400);
  }
  const mimeType = validation.mimeType;
  const fileType: FileType = validation.fileType;

  const contentHash = calculateHash(input.buffer);

  const existing = await findReusable(input.userId, contentHash, input.noteId);
  if (existing) {
    await discard(input.storedKey);
    return { attachment: existing, deduplicated: true };
  }

  let storageKey = input.storedKey;
  if (!storageKey) {
    storageKey = generateStorageKey(input.userId, contentHash, filename);
    try {
      await uploadToR2(storageKey, input.buffer, mimeType);
    } catch (error) {
      console.error('R2 upload failed:', error);
      throw new AttachmentError('Failed to upload file to storage', 502);
    }
  }

  const tags = input.tags ?? [];
  const pre = input.preprocessed;

  let attachment: Attachment | null = null;
  try {
    attachment = await mutate<Attachment>(
      `INSERT INTO attachments (
        user_id, filename, original_filename, mime_type, file_size,
        storage_key, storage_url, file_type, project_id, note_id,
        description, extracted_text, content_plain, content_hash,
        metadata, tags, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
      [
        input.userId,
        filename,
        filename,
        mimeType,
        input.buffer.length,
        storageKey,
        publicUrlFor(storageKey),
        fileType,
        input.projectId,
        input.noteId,
        input.description?.trim() || null,
        pre?.extractedText ?? null,
        pre?.contentPlain ?? null,
        contentHash,
        JSON.stringify(pre?.metadata ?? {}),
        JSON.stringify(tags),
        pre ? 'completed' : 'pending',
      ]
    );
  } catch (error) {
    console.error('Failed to record attachment:', error);
  }

  if (!attachment) {
    // A stored file with no row is unreachable from the app: take it back out
    await discard(storageKey);
    throw new AttachmentError('Failed to create attachment record', 500);
  }

  if (!pre) {
    try {
      await queueAttachmentProcessing(input.userId, attachment);
    } catch (queueError) {
      // The file is saved and usable; processing only adds search text and a thumbnail
      console.error('Failed to queue attachment processing:', queueError);
    }
  }

  return { attachment, deduplicated: false };
}

/**
 * Remove an attachment's row and stored file, and any processing still
 * queued for it (which would otherwise fail as "not found" and show up as a
 * background error).
 */
export async function deleteAttachment(attachment: Attachment): Promise<void> {
  await db.execute({
    sql: `DELETE FROM processing_queue
          WHERE entity_type = 'attachment' AND entity_id = ? AND status IN ('pending', 'processing')`,
    args: [attachment.id],
  });

  await db.execute({
    sql: 'DELETE FROM attachments WHERE id = ? AND user_id = ?',
    args: [attachment.id, attachment.user_id],
  });

  try {
    await deleteFromR2(attachment.storage_key);
  } catch (storageError) {
    // The row is gone, so the app no longer links to it; an orphaned object
    // costs storage, not correctness
    console.error('Failed to delete from R2:', storageError);
  }
}
