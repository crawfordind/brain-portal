/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching when exact target string isn't found
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0 to 1)
 * 1 = identical, 0 = completely different
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

/**
 * Find the best matching substring in content for a target string
 * Returns null if no match above threshold
 */
export interface FuzzyMatch {
  match: string;
  similarity: number;
  index: number;
}

export function findBestMatch(
  content: string,
  target: string,
  threshold: number = 0.7
): FuzzyMatch | null {
  // First try exact match
  if (content.includes(target)) {
    return {
      match: target,
      similarity: 1.0,
      index: content.indexOf(target),
    };
  }

  // Try fuzzy matching on lines or headings
  const lines = content.split('\n');
  let bestMatch: FuzzyMatch | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const similarity = stringSimilarity(line.trim(), target.trim());

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        // Find the actual position in full content
        const precedingText = lines.slice(0, i).join('\n');
        const index = precedingText.length + (precedingText.length > 0 ? 1 : 0);

        bestMatch = {
          match: line,
          similarity,
          index,
        };
      }
    }
  }

  return bestMatch;
}
