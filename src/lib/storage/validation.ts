import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

// File size limits in bytes
export const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024, // 10MB
  pdf: 50 * 1024 * 1024, // 50MB
  audio: 100 * 1024 * 1024, // 100MB
  video: 100 * 1024 * 1024, // 100MB
  document: 25 * 1024 * 1024, // 25MB
  other: 25 * 1024 * 1024, // 25MB
} as const;

// Allowed MIME types.
//
// image/svg+xml is deliberately absent. An SVG is a script-bearing document,
// not a picture: served from the attachment host it executes JavaScript in
// that origin. If you need SVG, serve attachments from a domain that shares
// no cookies with the app and add it back knowingly.
export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  // PDFs
  'application/pdf',
  // Audio
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-m4a',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  // Documents
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
] as const;

export type FileType = 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';

/**
 * Classify a file based on its MIME type
 */
export function classifyFileType(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('document') ||
    mimeType.includes('word') ||
    mimeType.includes('excel') ||
    mimeType.includes('powerpoint') ||
    mimeType.includes('spreadsheet')
  ) {
    return 'document';
  }
  return 'other';
}

/**
 * Validate file MIME type
 */
export function isValidMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(mimeType as any);
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
 * Format: user_id/hash-filename.ext
 */
export function generateStorageKey(
  userId: string,
  hash: string,
  filename: string
): string {
  const sanitized = sanitizeFilename(filename);
  // Use first 12 chars of hash for uniqueness
  const shortHash = hash.substring(0, 12);
  return `${userId}/${shortHash}-${sanitized}`;
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Types whose bytes carry no reliable magic number, so sniffing cannot confirm
 * them. Plain text really is "anything", and a sniff returning `undefined` for
 * these is the expected result rather than a failure.
 */
const UNSNIFFABLE_MIME_TYPES = new Set<string>([
  'text/plain',
  'text/markdown',
  'text/csv',
]);

/**
 * Some containers are shared by several formats, so the sniffer names the
 * container while the browser names the codec. Treat these as agreeing.
 */
const EQUIVALENT_MIME_TYPES: Record<string, string[]> = {
  'audio/mpeg': ['audio/mpeg', 'audio/mp3'],
  'audio/mp3': ['audio/mpeg', 'audio/mp3'],
  'audio/m4a': ['audio/m4a', 'audio/x-m4a', 'audio/mp4', 'video/mp4'],
  'audio/x-m4a': ['audio/m4a', 'audio/x-m4a', 'audio/mp4', 'video/mp4'],
  'video/mp4': ['video/mp4', 'audio/mp4', 'video/quicktime'],
  'video/quicktime': ['video/quicktime', 'video/mp4'],
  'application/msword': ['application/msword', 'application/x-cfb'],
  'application/vnd.ms-excel': ['application/vnd.ms-excel', 'application/x-cfb'],
  'application/vnd.ms-powerpoint': ['application/vnd.ms-powerpoint', 'application/x-cfb'],
  // OOXML files are ZIP containers; the sniffer usually says so.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ],
};

function mimeTypesAgree(declared: string, sniffed: string): boolean {
  if (declared === sniffed) return true;
  return (EQUIVALENT_MIME_TYPES[declared] ?? []).includes(sniffed);
}

/**
 * Validate a complete file for upload.
 *
 * `mimeType` is whatever the *client* said the file was, which is a claim, not
 * a fact — a browser sends what it inferred from the extension and a script can
 * send anything at all. So the declared type is checked against the allowlist
 * and then against the file's own magic bytes; a file whose contents disagree
 * with its label is rejected rather than stored and later served under the
 * attacker's chosen Content-Type.
 */
export async function validateFile(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<{ valid: boolean; error?: string; fileType?: FileType }> {
  // Check the declared MIME type against the allowlist
  if (!isValidMimeType(mimeType)) {
    return {
      valid: false,
      error: `File type not allowed. Allowed types: images, PDFs, audio, video, and documents.`,
    };
  }

  // Classify file
  const fileType = classifyFileType(mimeType);

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
  if (!UNSNIFFABLE_MIME_TYPES.has(mimeType)) {
    const sniffed = await fileTypeFromBuffer(buffer);

    if (!sniffed) {
      return {
        valid: false,
        error: 'Could not verify the file contents. Upload rejected.',
        fileType,
      };
    }

    if (!mimeTypesAgree(mimeType, sniffed.mime)) {
      return {
        valid: false,
        error: `File contents do not match its type (declared ${mimeType}, detected ${sniffed.mime}).`,
        fileType,
      };
    }
  }

  return { valid: true, fileType };
}
