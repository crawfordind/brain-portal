/**
 * Pure vector math for embeddings.
 *
 * Kept dependency-free (no OpenAI client, no DB) so similarity logic can be
 * imported and unit-tested without environment credentials.
 */

/**
 * Compute cosine similarity between two equal-length embedding vectors.
 * Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embedding dimensions must match");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
