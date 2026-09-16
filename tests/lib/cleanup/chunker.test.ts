// tests/lib/cleanup/chunker.test.ts
import { describe, test, expect } from 'vitest';
import { chunkNote } from '@/lib/cleanup/chunker';

describe('chunkNote', () => {
  test('returns single chunk for short notes', () => {
    const content = 'Short note content';
    const chunks = chunkNote(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('full');
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].precedingContext).toBeUndefined();
  });

  test('splits by headings for long notes', () => {
    const content = `# Title

Some intro text here.

## Section 1

Content for section 1 with enough text to make it long.
${'x'.repeat(3000)}

## Section 2

More content here.`;

    const chunks = chunkNote(content);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].heading).toBe('# Title');  // FIX: Exact match
    expect(chunks[1].heading).toBe('## Section 1');  // FIX: Exact match
    expect(chunks[1].precedingContext).toBeDefined();
  });

  test('preserves line number ranges', () => {
    const content = `## First

Content ${'x'.repeat(1500)}

## Second

More content ${'x'.repeat(1500)}`;

    const chunks = chunkNote(content);

    expect(chunks[0].startLine).toBe(0);
    expect(chunks[0].endLine).toBeGreaterThan(0);
    expect(chunks[1].startLine).toBeGreaterThan(chunks[0].endLine);
  });

  // NEW: Edge case tests
  test('handles empty content', () => {
    const chunks = chunkNote('');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('');
    expect(chunks[0].endLine).toBe(0);
  });

  test('handles content exactly at boundary', () => {
    const content = 'x'.repeat(3000);
    const chunks = chunkNote(content);
    expect(chunks).toHaveLength(1);  // Should NOT chunk at exactly 3000
  });

  test('handles long content without headings', () => {
    const content = 'x'.repeat(4000);
    const chunks = chunkNote(content);
    expect(chunks).toHaveLength(1);  // No headings = single chunk
    expect(chunks[0].heading).toBeUndefined();
  });
});
