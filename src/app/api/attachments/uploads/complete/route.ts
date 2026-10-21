import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne } from '@/lib/db/client';
import { deleteFromR2, downloadFromR2, getFileMetadata, isR2Configured } from '@/lib/storage/r2';
import { FILE_SIZE_LIMITS, classifyFileType, formatFileSize, normalizeMimeType } from '@/lib/storage/upload-policy';
import {
  AttachmentError,
  createAttachment,
  parseTags,
  resolveAttachmentLinks,
} from '@/lib/attachments/create';
import { attachmentErrorResponse, storageNotConfigured } from '@/lib/attachments/http';

// Reading back and hashing a 100 MB file takes a few seconds; the platform
// default could cut that off and leave the object stored with no row.
export const maxDuration = 60;

// POST /api/attachments/uploads/complete - Record a file sent straight to storage.
//
// Body: { key, filename, noteId?, projectId?, description?, tags? }
//
// The object is read back and put through the same checks as an upload posted
// through the app (allowlist, size, magic bytes, deduplication). Anything
// refused is deleted from storage, so a direct upload can never leave behind a
// file the app does not know about because it was rejected.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isR2Configured()) return storageNotConfigured();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  // Only keys this user was issued: their own prefix, one path segment, no tricks
  const ownPrefix = `${user.id}/`;
  const name = key.slice(ownPrefix.length);
  if (!key.startsWith(ownPrefix) || !/^[a-z0-9][a-z0-9.-]*$/.test(name) || name.includes('..')) {
    return NextResponse.json({ error: 'Unknown upload' }, { status: 400 });
  }

  try {
    const alreadyRecorded = await queryOne<{ id: string }>(
      'SELECT id FROM attachments WHERE user_id = ? AND storage_key = ?',
      [user.id, key]
    );
    if (alreadyRecorded) {
      throw new AttachmentError('This upload has already been recorded', 409);
    }

    let links: Awaited<ReturnType<typeof resolveAttachmentLinks>>;
    try {
      links = await resolveAttachmentLinks(user.id, {
        noteId: typeof body.noteId === 'string' ? body.noteId : null,
        projectId: typeof body.projectId === 'string' ? body.projectId : null,
      });
    } catch (error) {
      // The note went away (or was never theirs) while the file was sending
      if (error instanceof AttachmentError) await deleteFromR2(key).catch(() => {});
      throw error;
    }

    const stored = await getFileMetadata(key);
    if (!stored) {
      throw new AttachmentError(
        'The file did not reach storage. Please try the upload again.',
        400
      );
    }

    // The Content-Type was signed into the upload URL, so it is the type the
    // server chose, not one the browser could change in flight.
    const declaredType = normalizeMimeType(stored.contentType);
    const limit = FILE_SIZE_LIMITS[classifyFileType(declaredType)];
    if ((stored.contentLength ?? 0) > limit) {
      await deleteFromR2(key).catch(() => {});
      throw new AttachmentError(
        `File too large. Maximum size for ${classifyFileType(declaredType)} files is ${formatFileSize(limit)}.`,
        400
      );
    }

    const buffer = await downloadFromR2(key, limit);

    const { attachment, deduplicated } = await createAttachment({
      userId: user.id,
      buffer,
      declaredType,
      filename: typeof body.filename === 'string' ? body.filename : name,
      ...links,
      description: typeof body.description === 'string' ? body.description : null,
      tags: parseTags(body.tags),
      storedKey: key,
    });

    if (deduplicated) {
      return NextResponse.json(
        { attachment, message: 'File already exists', deduplicated: true },
        { status: 200 }
      );
    }
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return attachmentErrorResponse(error, 'Failed to save the upload');
  }
}
