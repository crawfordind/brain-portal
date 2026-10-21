/**
 * Uploading a file from the browser.
 *
 * Small files are posted to `/api/attachments`. Larger ones cannot be: Vercel
 * refuses a function request over 4.5 MB before the route runs (with a
 * plain-text error the app never sees), and Next's middleware buffers at most
 * 10 MB of one anywhere else. So they are sent straight to storage with a
 * presigned URL and then recorded, and every upload above a few megabytes used
 * to fail with an unreadable message.
 *
 * XMLHttpRequest rather than fetch because only it reports upload progress.
 */

import type { Attachment } from '@/lib/db/schema';
import { DIRECT_UPLOAD_THRESHOLD, checkUpload } from '@/lib/storage/upload-policy';

/** Fired on `window` whenever an attachment is added or removed, so every list showing them can refresh. */
export const ATTACHMENTS_CHANGED_EVENT = 'brain:attachments-changed';

export interface AttachmentsChangedDetail {
  noteId?: string | null;
  attachmentId?: string;
  change: 'added' | 'removed';
}

export function notifyAttachmentsChanged(detail: AttachmentsChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AttachmentsChangedDetail>(ATTACHMENTS_CHANGED_EVENT, { detail }));
}

export class UploadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'UploadError';
  }
}

interface XhrResult {
  status: number;
  text: string;
}

function send(options: {
  method: string;
  url: string;
  body: XMLHttpRequestBodyInit;
  headers?: Record<string, string>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, options.url);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    if (options.onProgress) {
      const onProgress = options.onProgress;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
      };
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
    // A network error, a CORS refusal and a dropped connection all look the same
    // from here: status 0 and no body.
    xhr.onerror = () => resolve({ status: 0, text: '' });
    xhr.ontimeout = () => resolve({ status: 0, text: '' });
    xhr.onabort = () => reject(new UploadError('Upload cancelled', false));

    if (options.signal) {
      if (options.signal.aborted) {
        reject(new UploadError('Upload cancelled', false));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(options.body);
  });
}

function isRetryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/**
 * A sentence a person can act on, whatever came back: the app's JSON error,
 * a platform's HTML error page, or nothing at all.
 */
export function describeUploadFailure(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error;
  } catch {
    // Not JSON: fall through to the status
  }
  if (status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (status === 401) return 'Your session has expired. Sign in again, then retry.';
  if (status === 413) return 'The file is too large for this server to accept.';
  if (status === 429) return 'Too many uploads at once. Wait a moment and retry.';
  if (status >= 500) return `The server could not save the file (error ${status}). Try again.`;
  return `Upload failed (error ${status}).`;
}

function parseJson<T>(result: XhrResult): T {
  try {
    return JSON.parse(result.text) as T;
  } catch {
    throw new UploadError('The server sent an unreadable reply. Try again.', true);
  }
}

function fail(result: XhrResult): never {
  throw new UploadError(describeUploadFailure(result.status, result.text), isRetryable(result.status));
}

export interface UploadOptions {
  noteId?: string | null;
  projectId?: string | null;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  attachment: Attachment;
  deduplicated: boolean;
}

async function uploadThroughApp(file: File, options: UploadOptions): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (options.projectId) formData.append('projectId', options.projectId);
  if (options.noteId) formData.append('noteId', options.noteId);

  const result = await send({
    method: 'POST',
    url: '/api/attachments',
    body: formData,
    onProgress: (f) => options.onProgress?.(f * 0.95),
    signal: options.signal,
  });
  if (result.status < 200 || result.status >= 300) fail(result);

  const body = parseJson<{ attachment?: Attachment; deduplicated?: boolean }>(result);
  if (!body.attachment) throw new UploadError('The server did not return the saved file.', true);
  return { attachment: body.attachment, deduplicated: Boolean(body.deduplicated) };
}

async function uploadDirect(file: File, options: UploadOptions): Promise<UploadResult> {
  // 1. Ask for somewhere to put it
  const prepared = await send({
    method: 'POST',
    url: '/api/attachments/uploads',
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type,
      size: file.size,
      noteId: options.noteId ?? null,
      projectId: options.projectId ?? null,
    }),
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
  });
  if (prepared.status < 200 || prepared.status >= 300) fail(prepared);
  const target = parseJson<{ uploadUrl: string; key: string; headers: Record<string, string> }>(prepared);

  // 2. Send the bytes straight to storage
  const stored = await send({
    method: 'PUT',
    url: target.uploadUrl,
    body: file,
    headers: target.headers,
    onProgress: (f) => options.onProgress?.(0.02 + f * 0.9),
    signal: options.signal,
  });
  if (stored.status === 0) {
    // Almost always the bucket's CORS rule, which is set once per deployment
    throw new UploadError(
      "Couldn't send the file to storage. If this keeps happening with large files, the storage bucket needs its upload rule set (an admin can run `npm run r2:cors`).",
      true
    );
  }
  if (stored.status < 200 || stored.status >= 300) {
    throw new UploadError(
      `Storage refused the file (error ${stored.status}). Try again.`,
      isRetryable(stored.status)
    );
  }

  // 3. Have the server check it and record it
  const completed = await send({
    method: 'POST',
    url: '/api/attachments/uploads/complete',
    body: JSON.stringify({
      key: target.key,
      filename: file.name,
      noteId: options.noteId ?? null,
      projectId: options.projectId ?? null,
    }),
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
  });
  if (completed.status < 200 || completed.status >= 300) fail(completed);

  const body = parseJson<{ attachment?: Attachment; deduplicated?: boolean }>(completed);
  if (!body.attachment) throw new UploadError('The server did not return the saved file.', true);
  return { attachment: body.attachment, deduplicated: Boolean(body.deduplicated) };
}

/**
 * Upload one file and file it under a note and/or project. Throws
 * `UploadError` with a readable message; `retryable` says whether trying the
 * same file again could work.
 */
export async function uploadAttachment(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  const check = checkUpload(file.type, file.name, file.size);
  if (!check.ok) throw new UploadError(check.error, false);

  options.onProgress?.(0);
  const result =
    file.size <= DIRECT_UPLOAD_THRESHOLD
      ? await uploadThroughApp(file, options)
      : await uploadDirect(file, options);
  options.onProgress?.(1);

  notifyAttachmentsChanged({ noteId: result.attachment.note_id, attachmentId: result.attachment.id, change: 'added' });
  return result;
}

/** Delete an attachment, and tell every list showing it. */
export async function deleteAttachmentRequest(attachment: Pick<Attachment, 'id' | 'note_id'>): Promise<void> {
  const response = await fetch(`/api/attachments/${attachment.id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) {
    throw new UploadError(describeUploadFailure(response.status, await response.text()), isRetryable(response.status));
  }
  notifyAttachmentsChanged({ noteId: attachment.note_id, attachmentId: attachment.id, change: 'removed' });
}
