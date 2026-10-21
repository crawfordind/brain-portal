// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { generateStorageKey, mimeTypesAgree, validateFile } from '@/lib/storage/validation';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
// Minimal EBML header with doctype "webm": what a MediaRecorder voice note starts with
const WEBM = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
  0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04,
  0x42, 0x85, 0x81, 0x02,
]);

describe('validateFile', () => {
  it('accepts a PNG and returns its canonical type', async () => {
    const result = await validateFile(PNG, 'image/png', 'dot.png');
    expect(result).toMatchObject({ valid: true, fileType: 'image', mimeType: 'image/png' });
  });

  it('accepts a file the browser sent without a type, by its name and bytes', async () => {
    const result = await validateFile(PDF, '', 'report.pdf');
    expect(result).toMatchObject({ valid: true, fileType: 'pdf', mimeType: 'application/pdf' });
  });

  it('rejects bytes that disagree with the label', async () => {
    const result = await validateFile(PNG, 'application/pdf', 'fake.pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/do not match/);
  });

  it('accepts a WebM voice note, which the sniffer calls video', async () => {
    const result = await validateFile(WEBM, 'audio/webm', 'voice.webm');
    expect(result).toMatchObject({ valid: true, fileType: 'audio', mimeType: 'audio/webm' });
  });

  it('accepts a CSV that Windows labelled as Excel', async () => {
    const csv = Buffer.from('name,amount\nNorthwind,12\n');
    const result = await validateFile(csv, 'application/vnd.ms-excel', 'export.csv');
    expect(result).toMatchObject({ valid: true, mimeType: 'text/csv', fileType: 'document' });
  });

  it('rejects binary content claiming to be text', async () => {
    const binary = Buffer.concat([Buffer.from('abc'), Buffer.from([0, 1, 2])]);
    const result = await validateFile(binary, 'text/plain', 'a.txt');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not text/);
  });

  it('rejects SVG, which is a script-bearing document', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await validateFile(svg, 'image/svg+xml', 'x.svg');
    expect(result.valid).toBe(false);
  });

  it('rejects an empty file', async () => {
    const result = await validateFile(Buffer.alloc(0), 'image/png', 'a.png');
    expect(result).toMatchObject({ valid: false, error: 'The file is empty.' });
  });
});

describe('mimeTypesAgree', () => {
  it('matches containers the sniffer names differently', () => {
    expect(mimeTypesAgree('audio/mp4', 'audio/x-m4a')).toBe(true);
    expect(mimeTypesAgree('image/heic', 'image/heif')).toBe(true);
    expect(mimeTypesAgree('video/x-msvideo', 'video/vnd.avi')).toBe(true);
    expect(mimeTypesAgree('image/png', 'image/jpeg')).toBe(false);
  });
});

describe('generateStorageKey', () => {
  it('gives identical files different keys, under the owner', () => {
    const a = generateStorageKey('user1', 'abcdef1234567890', 'Photo 1.JPG');
    const b = generateStorageKey('user1', 'abcdef1234567890', 'Photo 1.JPG');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^user1\/abcdef123456-[0-9a-f]{8}-photo-1\.jpg$/);
  });

  it('never produces an empty name', () => {
    expect(generateStorageKey('u', 'abcdef1234567890', '照片.png')).toMatch(/-file\.png$/);
  });
});
