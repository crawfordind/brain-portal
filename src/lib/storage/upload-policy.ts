/**
 * What may be uploaded, and how big it may be.
 *
 * Imports nothing, so the browser (to refuse a file before spending the
 * user's bandwidth on it) and the server (which decides) read the same rules.
 * They used to keep separate tables, and disagreed: the picker accepted a 20 MB
 * image the server refused at 10 MB, and refused a 30 MB PDF the server would
 * have taken.
 */

export type FileType = 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';

export const FILE_SIZE_LIMITS: Record<FileType, number> = {
  image: 10 * 1024 * 1024, // 10MB
  pdf: 50 * 1024 * 1024, // 50MB
  audio: 100 * 1024 * 1024, // 100MB
  video: 100 * 1024 * 1024, // 100MB
  document: 25 * 1024 * 1024, // 25MB
  other: 25 * 1024 * 1024, // 25MB
};

/**
 * Files at or below this size are posted to `/api/attachments`; larger ones go
 * straight to storage with a presigned URL. Vercel refuses any function request
 * body over 4.5 MB before the route runs (and Next's middleware buffers at most
 * 10 MB of one), so a larger file can never reach the route at all. 4 MB leaves
 * room for the multipart envelope.
 */
export const DIRECT_UPLOAD_THRESHOLD = 4 * 1024 * 1024;

// Allowed MIME types, in their canonical spelling (see normalizeMimeType).
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
  'audio/wav',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
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

/** Types whose bytes carry no magic number, so only their text can be checked. */
export const TEXT_MIME_TYPES = new Set<string>(['text/plain', 'text/markdown', 'text/csv']);

/**
 * Spellings browsers and operating systems use for the same thing. Safari says
 * `audio/x-m4a`, Chrome `audio/mp4`, older Windows `image/pjpeg`; all of them
 * are one allowed type.
 */
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
  'application/x-pdf': 'application/pdf',
  'audio/mp3': 'audio/mpeg',
  'audio/x-mp3': 'audio/mpeg',
  'audio/mpeg3': 'audio/mpeg',
  'audio/x-mpeg': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-aac': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'audio/opus': 'audio/ogg',
  'video/avi': 'video/x-msvideo',
  'video/msvideo': 'video/x-msvideo',
  'video/vnd.avi': 'video/x-msvideo',
  'video/x-m4v': 'video/mp4',
  'text/x-markdown': 'text/markdown',
  'text/x-csv': 'text/csv',
  'application/csv': 'text/csv',
};

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
};


export function isAllowedMimeType(mimeType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Lower-case, drop parameters (`; charset=utf-8`) and map aliases. */
export function normalizeMimeType(raw: string | null | undefined): string {
  const base = (raw ?? '').split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

export function mimeTypeFromFilename(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_MIME_TYPES[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The type a file should be stored as, from what the client declared and its
 * name. `null` when neither says anything allowed.
 *
 * The declared type is a hint, not a fact, and often a poor one: Windows
 * labels a `.csv` `application/vnd.ms-excel`, and Chrome on Windows sends an
 * empty type for `.heic` and `.md`. The bytes are still checked against the
 * result on the server (`validateFile`), so trusting the extension here widens
 * nothing.
 */
export function resolveMimeType(declared: string | null | undefined, filename: string): string | null {
  const normalized = normalizeMimeType(declared);
  const fromName = mimeTypeFromFilename(filename);

  // A text extension wins over a binary label: the spreadsheet label on a CSV
  // would otherwise demand an OLE container the file does not have.
  if (fromName && TEXT_MIME_TYPES.has(fromName) && !TEXT_MIME_TYPES.has(normalized)) {
    return fromName;
  }
  if (isAllowedMimeType(normalized)) return normalized;
  // Empty, `application/octet-stream`, or a label we don't take: the name is
  // the only other evidence, and the bytes still have to agree with it.
  return fromName;
}

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
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export const TYPE_NOT_ALLOWED_MESSAGE =
  'File type not allowed. Allowed types: images, PDFs, audio, video, and documents.';

/**
 * Check a file's type and size before it is sent. Returns the type to store
 * it as, or the reason it cannot be uploaded.
 */
export function checkUpload(
  declaredType: string | null | undefined,
  filename: string,
  size: number
): { ok: true; mimeType: string; fileType: FileType } | { ok: false; error: string } {
  const mimeType = resolveMimeType(declaredType, filename);
  if (!mimeType) return { ok: false, error: TYPE_NOT_ALLOWED_MESSAGE };

  const fileType = classifyFileType(mimeType);
  if (size <= 0) return { ok: false, error: 'The file is empty.' };
  if (size > FILE_SIZE_LIMITS[fileType]) {
    return {
      ok: false,
      error: `File too large. Maximum size for ${fileType} files is ${formatFileSize(FILE_SIZE_LIMITS[fileType])}.`,
    };
  }
  return { ok: true, mimeType, fileType };
}

/**
 * A filename safe to show and to store: no path, no control characters, no
 * newlines (it ends up in HTML, emails and `Content-Disposition`), bounded.
 */
export function cleanFilename(name: string | null | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'file';
  if (cleaned.length <= 200) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 200 - ext.length) + ext;
}
