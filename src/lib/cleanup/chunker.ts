// src/lib/cleanup/chunker.ts
export interface Chunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  heading?: string;
  precedingContext?: string;
}

export function chunkNote(content: string): Chunk[] {
  // Handle empty content
  if (!content || content.trim().length === 0) {
    return [{
      id: 'full',
      content: '',
      startLine: 0,
      endLine: 0
    }];
  }

  // If small enough, return whole note
  if (content.length < 3000) {
    const lines = content.split('\n');
    return [{
      id: 'full',
      content,
      startLine: 0,
      endLine: lines.length - 1  // FIX: zero-indexed
    }];
  }

  // Split by markdown headings
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentHeading: string | undefined;
  let startLine = 0;

  lines.forEach((line, idx) => {
    const isHeading = /^#{1,3}\s/.test(line);

    if (isHeading && currentChunk.length > 0) {
      // Save previous chunk
      chunks.push({
        id: `chunk-${chunks.length}`,
        content: currentChunk.join('\n'),
        startLine,
        endLine: idx - 1,
        heading: currentHeading
      });
      currentChunk = [line];
      currentHeading = line;  // FIX: Capture new heading
      startLine = idx;
    } else {
      currentChunk.push(line);
      if (isHeading && !currentHeading) {  // FIX: Only set if not already set
        currentHeading = line;
      }
    }
  });

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      id: `chunk-${chunks.length}`,
      content: currentChunk.join('\n'),
      startLine,
      endLine: lines.length - 1,
      heading: currentHeading
    });
  }

  // Add context to chunks (summary of previous content)
  return chunks.map((chunk, idx) => {
    if (idx === 0) return chunk;

    const previousHeadings = chunks
      .slice(0, idx)
      .map(c => c.heading)
      .filter(Boolean)
      .join(', ');

    return {
      ...chunk,
      precedingContext: `Previous sections: ${previousHeadings}`
    };
  });
}
