import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getPresignedUploadUrl, isR2Configured } from '@/lib/storage/r2';
import { sanitizeFilename } from '@/lib/storage/validation';
import { checkUpload, cleanFilename } from '@/lib/storage/upload-policy';
import { resolveAttachmentLinks } from '@/lib/attachments/create';
import { attachmentErrorResponse, storageNotConfigured } from '@/lib/attachments/http';

/** How long the browser has to start sending the file. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

// POST /api/attachments/uploads - Get a URL to send a large file straight to storage.
//
// Body: { filename, mimeType, size, noteId?, projectId? }
// Returns: { uploadUrl, key, headers } — PUT the file to uploadUrl with exactly
// those headers, then POST { key, filename, noteId?, projectId? } to
// /api/attachments/uploads/complete, which checks the stored bytes and records
// the attachment.
//
// Exists because a file over ~4.5 MB never reaches a Vercel function: the
// platform refuses the request first, with a plain-text error the app never
// sees. Nothing is trusted from this request except for choosing the key and
// the signed Content-Type; the completion step validates the actual bytes.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isR2Configured()) return storageNotConfigured();

  let body: { filename?: unknown; mimeType?: unknown; size?: unknown; noteId?: unknown; projectId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const filename = cleanFilename(typeof body.filename === 'string' ? body.filename : '');
  const size = typeof body.size === 'number' ? body.size : Number.NaN;
  if (!Number.isFinite(size)) {
    return NextResponse.json({ error: "Missing 'size'" }, { status: 400 });
  }

  const check = checkUpload(typeof body.mimeType === 'string' ? body.mimeType : '', filename, size);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    // Refuse up front rather than after the user has sent 80 MB
    await resolveAttachmentLinks(user.id, {
      noteId: typeof body.noteId === 'string' ? body.noteId : null,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
    });

    const nonce = crypto.randomBytes(8).toString('hex');
    const safeName = sanitizeFilename(filename);
    const key = `${user.id}/${nonce}-${safeName.startsWith('.') || !safeName ? `file${safeName}` : safeName}`;

    const uploadUrl = await getPresignedUploadUrl(key, check.mimeType, UPLOAD_URL_TTL_SECONDS);

    return NextResponse.json({
      uploadUrl,
      key,
      headers: { 'Content-Type': check.mimeType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
  } catch (error) {
    return attachmentErrorResponse(error, 'Could not prepare the upload');
  }
}
