import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ATTACHMENTS_CHANGED_EVENT,
  UploadError,
  describeUploadFailure,
  uploadAttachment,
} from '@/lib/attachments/upload-client';

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (req: Sent) => { status: number; body?: unknown };

let sent: Sent[] = [];
let respond: Responder;

class FakeXhr {
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private req: Sent = { method: '', url: '', headers: {}, body: null };

  open(method: string, url: string) {
    this.req = { method, url, headers: {}, body: null };
  }
  setRequestHeader(name: string, value: string) {
    this.req.headers[name] = value;
  }
  abort() {
    this.onabort?.();
  }
  send(body: unknown) {
    this.req.body = body;
    sent.push(this.req);
    const { status, body: reply } = respond(this.req);
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
      if (status === 0) {
        this.onerror?.();
        return;
      }
      this.status = status;
      this.responseText = typeof reply === 'string' ? reply : JSON.stringify(reply ?? {});
      this.onload?.();
    });
  }
}

const attachment = { id: 'att1', note_id: 'note1' };

function fileOf(size: number, name: string, type: string): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAttachment', () => {
  it('posts a small file through the app', async () => {
    respond = () => ({ status: 201, body: { attachment } });
    const changed = vi.fn();
    window.addEventListener(ATTACHMENTS_CHANGED_EVENT, changed);

    const result = await uploadAttachment(fileOf(1000, 'a.png', 'image/png'), { noteId: 'note1' });

    window.removeEventListener(ATTACHMENTS_CHANGED_EVENT, changed);
    expect(result.attachment.id).toBe('att1');
    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /api/attachments']);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('sends a large file straight to storage, then records it', async () => {
    respond = (req) => {
      if (req.url === '/api/attachments/uploads') {
        return {
          status: 200,
          body: { uploadUrl: 'https://r2.example.com/put', key: 'user1/k-a.pdf', headers: { 'Content-Type': 'application/pdf' } },
        };
      }
      if (req.url === 'https://r2.example.com/put') return { status: 200, body: '' };
      return { status: 201, body: { attachment } };
    };

    await uploadAttachment(fileOf(30 * 1024 * 1024, 'big.pdf', 'application/pdf'));

    expect(sent.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /api/attachments/uploads',
      'PUT https://r2.example.com/put',
      'POST /api/attachments/uploads/complete',
    ]);
    expect(sent[1].headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(JSON.parse(sent[2].body as string).key).toBe('user1/k-a.pdf');
  });

  it('explains a storage refusal (usually the bucket CORS rule) as retryable', async () => {
    respond = (req) =>
      req.method === 'PUT'
        ? { status: 0 }
        : { status: 200, body: { uploadUrl: 'https://r2.example.com/put', key: 'user1/k', headers: {} } };

    const error = await uploadAttachment(fileOf(30 * 1024 * 1024, 'big.pdf', 'application/pdf')).catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.message).toMatch(/npm run r2:cors/);
    expect(error.retryable).toBe(true);
  });

  it('refuses a disallowed file without sending anything', async () => {
    respond = () => ({ status: 500 });
    const error = await uploadAttachment(fileOf(100, 'tool.exe', '')).catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.retryable).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("shows the server's own error message", async () => {
    respond = () => ({ status: 400, body: { error: 'File contents do not match its type' } });
    await expect(uploadAttachment(fileOf(1000, 'a.png', 'image/png'))).rejects.toThrow(
      'File contents do not match its type'
    );
  });
});

describe('describeUploadFailure', () => {
  it('turns a platform error page into a sentence', () => {
    expect(describeUploadFailure(413, '<html>Request Entity Too Large</html>')).toMatch(/too large/);
    expect(describeUploadFailure(502, 'An error occurred')).toMatch(/could not save the file \(error 502\)/);
    expect(describeUploadFailure(401, '')).toMatch(/Sign in again/);
  });
});
