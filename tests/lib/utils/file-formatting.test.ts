import { describe, it, expect } from 'vitest';
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';

describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });
});

describe('formatDate', () => {
  it('formats date string correctly', () => {
    const date = '2024-01-15T10:30:00Z';
    const formatted = formatDate(date);
    // Should match: "January 15, 2024 at 10:30 AM" (locale-dependent)
    expect(formatted).toContain('January');
    expect(formatted).toContain('15');
    expect(formatted).toContain('2024');
  });
});
