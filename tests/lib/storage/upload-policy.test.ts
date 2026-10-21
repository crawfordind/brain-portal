import { describe, it, expect } from 'vitest';
import {
  DIRECT_UPLOAD_THRESHOLD,
  FILE_SIZE_LIMITS,
  checkUpload,
  cleanFilename,
  normalizeMimeType,
  resolveMimeType,
} from '@/lib/storage/upload-policy';

describe('normalizeMimeType', () => {
  it('lower-cases, drops parameters and maps aliases', () => {
    expect(normalizeMimeType('Text/Plain; charset=UTF-8')).toBe('text/plain');
    expect(normalizeMimeType('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeMimeType('image/jpg')).toBe('image/jpeg');
    expect(normalizeMimeType('audio/mp3')).toBe('audio/mpeg');
    expect(normalizeMimeType(undefined)).toBe('');
  });
});

describe('resolveMimeType', () => {
  it('keeps an allowed declared type', () => {
    expect(resolveMimeType('application/pdf', 'report.pdf')).toBe('application/pdf');
  });

  it('falls back to the extension when the browser sends no type', () => {
    // Chrome on Windows sends "" for .heic and .md
    expect(resolveMimeType('', 'IMG_0001.HEIC')).toBe('image/heic');
    expect(resolveMimeType('', 'notes.md')).toBe('text/markdown');
    expect(resolveMimeType('application/octet-stream', 'memo.m4a')).toBe('audio/mp4');
  });

  it('treats a CSV labelled as Excel by Windows as CSV', () => {
    expect(resolveMimeType('application/vnd.ms-excel', 'export.csv')).toBe('text/csv');
  });

  it('refuses what neither the label nor the name allows', () => {
    expect(resolveMimeType('image/svg+xml', 'logo.svg')).toBeNull();
    expect(resolveMimeType('', 'setup.exe')).toBeNull();
    expect(resolveMimeType('', 'no-extension')).toBeNull();
  });
});

describe('checkUpload', () => {
  it('applies the per-type limit', () => {
    expect(checkUpload('image/png', 'a.png', FILE_SIZE_LIMITS.image).ok).toBe(true);
    const tooBig = checkUpload('image/png', 'a.png', FILE_SIZE_LIMITS.image + 1);
    expect(tooBig).toMatchObject({ ok: false });
    if (!tooBig.ok) expect(tooBig.error).toMatch(/Maximum size for image files is 10 MB/);
  });

  it('refuses empty files', () => {
    expect(checkUpload('text/plain', 'a.txt', 0)).toMatchObject({ ok: false, error: 'The file is empty.' });
  });

  it('allows a large PDF that only the direct path can carry', () => {
    const result = checkUpload('application/pdf', 'big.pdf', 30 * 1024 * 1024);
    expect(result).toMatchObject({ ok: true, fileType: 'pdf' });
    expect(30 * 1024 * 1024).toBeGreaterThan(DIRECT_UPLOAD_THRESHOLD);
  });
});

describe('cleanFilename', () => {
  it('strips paths, control characters and newlines', () => {
    expect(cleanFilename('C:\\Users\\someone\\photo.jpg')).toBe('photo.jpg');
    expect(cleanFilename('bad\r\nname\u0000.txt')).toBe('bad name .txt');
    expect(cleanFilename('   ')).toBe('file');
  });

  it('bounds the length but keeps the extension', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const cleaned = cleanFilename(long);
    expect(cleaned.length).toBe(200);
    expect(cleaned.endsWith('.pdf')).toBe(true);
  });
});
