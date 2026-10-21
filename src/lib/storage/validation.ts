import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

import {
  FILE_SIZE_LIMITS,
  TEXT_MIME_TYPES,
  TYPE_NOT_ALLOWED_MESSAGE,
  classifyFileType,
  formatFileSize,
  isAllowedMimeType,
  normalizeMimeType,
  resolveMimeType,
  type FileType,
} from './upload-policy';

// The rules themselves live in upload-policy.ts so the browser can apply them
// too; re-exported for the server code that has always imported them here.
export {
  ALLOWED_MIME_TYPES,
  FILE_SIZE_LIMITS,
  classifyFileType,
  formatFileSize,
  type FileType,
} from './upload-policy';

/**
 * Validate file MIME type
 */
export function isValidMimeType(mimeType: string): boolean {
  return isAllowedMimeType(normalizeMimeType(mimeType));
}

/**
 * Validate file size based on its type
 */
export function isValidFileSize(fileSize: number, fileType: FileType): boolean {
  const limit = FILE_SIZE_LIMITS[fileType];
  return fileSize <= limit;
}

/**
 * Calculate SHA-256 hash of a buffer
 */
export function calculateHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Generate a safe filename (remove special characters, spaces, etc.)
 */
export function sanitizeFilename(filename: string): string {
  // Get extension
  const lastDot = filename.lastIndexOf('.');
  const name = lastDot > 0 ? filename.substring(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.substring(lastDot) : '';

  // Sanitize name: lowercase, replace spaces and special chars with hyphens
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .substring(0, 100); // Limit length

  // Sanitize extension: lowercase, only alphanumeric
  const safeExt = ext
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');

  return safeName + safeExt;
}

/**
 * Generate a unique storage key for R2
 * Format: user_id/hash-nonce-filename.ext
 *
 * The random part means two rows never share an object, even for identical
 * bytes: deleting one attachment must not pull the file out from under
 * another, and two simultaneous uploads of the same file must not collide on
 * `UNIQUE(user_id, storage_key)`.
 */
export function generateStorageKey(
  userId: string,
  hash: string,
  filename: string
): string {
  const sanitized = sanitizeFilename(filename);
  const name = sanitized.startsWith('.') || !sanitized ? `file${sanitized}` : sanitized;
  // Use first 12 chars of hash to keep keys readable when browsing the bucket
  const shortHash = hash.substring(0, 12);
  const nonce = crypto.randomBytes(4).toString('hex');
  return `${userId}/${shortHash}-${nonce}-${name}`;
}

/**
 * Some containers are shared by several formats, so the sniffer names the
 * container while the browser names the codec. Treat these as agreeing. Keys
 * are canonical types (see `normalizeMimeType`); values are what `file-type`
 * actually reports for them.
 */
const EQUIVALENT_MIME_TYPES: Record<string, string[]> = {
  'image/png': ['image/apng'],
  'image/heic': ['image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  'image/heif': ['image/heic', 'image/heic-sequence', 'image/heif-sequence'],
  'audio/mp4': ['audio/x-m4a', 'audio/m4a', 'video/mp4', 'video/quicktime'],
  'audio/aac': ['audio/x-aac', 'audio/mp4', 'audio/x-m4a'],
  'audio/flac': ['audio/x-flac'],
  'audio/wav': ['audio/vnd.wave', 'audio/x-wav', 'audio/wave'],
  // Ogg is a container: Vorbis and Opus voice notes both sniff as one of these.
  'audio/ogg': ['audio/opus', 'application/ogg', 'video/ogg'],
  // MediaRecorder voice notes are WebM, which the sniffer calls video.
  'audio/webm': ['video/webm', 'video/matroska'],
  'video/webm': ['video/matroska'],
  'video/mp4': ['audio/mp4', 'video/quicktime', 'video/x-m4v'],
  'video/quicktime': ['video/mp4'],
  'video/x-msvideo': ['video/vnd.avi', 'video/avi'],
  'application/msword': ['application/x-cfb'],
  'application/vnd.ms-excel': ['application/x-cfb'],
  'application/vnd.ms-powerpoint': ['application/x-cfb'],
  // OOXML files are ZIP containers; the sniffer sometimes says only that.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['application/zip'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['application/zip'],
};

export function mimeTypesAgree(declared: string, sniffed: string): boolean {
  if (declared === sniffed || normalizeMimeType(sniffed) === declared) return true;
  return (EQUIVALENT_MIME_TYPES[declared] ?? []).includes(sniffed);
}

/**
 * Text has no magic number, so "is it text" is the check: no NUL bytes in the
 * first 64 KB. A PDF or an executable renamed `.txt` fails it.
 */
function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 64 * 1024);
  return !sample.includes(0);
}

export interface FileValidation {
  valid: boolean;
  error?: string;
  fileType?: FileType;
  /** The canonical type to store and serve the file as. */
  mimeType?: string;
}

/**
 * Validate a complete file for upload.
 *
 * `mimeType` is whatever the *client* said the file was, which is a claim, not
 * a fact — a browser sends what it inferred from the extension and a script can
 * send anything at all. So the declared type (or, when it says nothing useful,
 * the extension) is checked against the allowlist and then against the file's
 * own magic bytes; a file whose contents disagree with its label is rejected
 * rather than stored and later served under the attacker's chosen Content-Type.
 */
export async function validateFile(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<FileValidation> {
  if (buffer.length === 0) {
    return { valid: false, error: 'The file is empty.' };
  }

  const resolved = resolveMimeType(mimeType, filename);
  if (!resolved) {
    return { valid: false, error: TYPE_NOT_ALLOWED_MESSAGE };
  }

  // Classify file
  const fileType = classifyFileType(resolved);

  // Check file size
  if (!isValidFileSize(buffer.length, fileType)) {
    const limit = formatFileSize(FILE_SIZE_LIMITS[fileType]);
    return {
      valid: false,
      error: `File too large. Maximum size for ${fileType} files is ${limit}.`,
      fileType,
    };
  }

  // Confirm the bytes match the label
  if (TEXT_MIME_TYPES.has(resolved)) {
    if (!looksLikeText(buffer)) {
      return {
        valid: false,
        error: `File contents do not match its type (declared ${resolved}, but the file is not text).`,
        fileType,
      };
    }
    return { valid: true, fileType, mimeType: resolved };
  }

  const sniffed = await fileTypeFromBuffer(buffer);

  if (!sniffed) {
    return {
      valid: false,
      error: 'Could not verify the file contents. Upload rejected.',
      fileType,
    };
  }

  if (!mimeTypesAgree(resolved, sniffed.mime)) {
    return {
      valid: false,
      error: `File contents do not match its type (declared ${resolved}, detected ${sniffed.mime}).`,
      fileType,
    };
  }

  return { valid: true, fileType, mimeType: resolved };
}
