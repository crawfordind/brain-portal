import { NextResponse } from 'next/server';
import { missingR2Config } from '@/lib/storage/r2';
import { AttachmentError } from './create';

/**
 * The answer for an instance with no file storage. Names the missing
 * variables (never values) so the person can forward it to whoever runs the
 * server, instead of a bare 500 from a client that could not be built.
 */
export function storageNotConfigured() {
  return NextResponse.json(
    {
      error: 'File uploads are not set up on this server yet.',
      code: 'STORAGE_NOT_CONFIGURED',
      adminHint: `Set ${missingR2Config().join(', ')} (Cloudflare R2).`,
    },
    { status: 503 }
  );
}

export function attachmentErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AttachmentError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
