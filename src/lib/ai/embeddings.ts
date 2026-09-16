/**
 * Embedding generation and similarity computation
 * Uses OpenRouter for embeddings (openai/text-embedding-3-small)
 */

import { openrouter } from "./client";
import { db, queryOne, queryAll, mutate } from "@/lib/db/client";
import type { Embedding, Note } from "@/lib/db/schema";
import { hashContent } from "@/lib/processing/cache";
import { cosineSimilarity } from "./vector";

// Re-exported for backward compatibility — the pure implementation now lives
// in ./vector so it can be imported without the OpenAI client.
export { cosineSimilarity };

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_INPUT_LENGTH = 8191; // Token limit for embedding model

export interface SimilarNote {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  content_plain: string | null;
  note_type: string;
  project_name?: string | null;
  created_at: string;
  updated_at: string;
  similarity: number;
}

/**
 * Generate an embedding for text using OpenRouter
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate to max length
  const truncatedText = text.substring(0, MAX_INPUT_LENGTH);

  const response = await openrouter.embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncatedText,
  });

  if (!response.data?.[0]?.embedding) {
    throw new Error("Embedding API returned no data");
  }
  return response.data[0].embedding;
}

/**
 * Store an embedding in the database
 */
export async function storeEmbedding(
  userId: string,
  entityType: "note" | "capture",
  entityId: string,
  embedding: number[],
  contentHash: string
): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO embeddings
          (user_id, entity_type, entity_id, model, embedding, content_hash, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      userId,
      entityType,
      entityId,
      EMBEDDING_MODEL,
      JSON.stringify(embedding),
      contentHash,
    ],
  });
}

/**
 * Get an embedding from the database
 */
export async function getEmbedding(
  entityType: "note" | "capture",
  entityId: string
): Promise<{ embedding: number[]; contentHash: string } | null> {
  const result = await queryOne<Embedding>(
    `SELECT embedding, content_hash FROM embeddings
     WHERE entity_type = ? AND entity_id = ?`,
    [entityType, entityId]
  );

  if (!result) {
    return null;
  }

  try {
    return {
      embedding: JSON.parse(result.embedding),
      contentHash: result.content_hash,
    };
  } catch {
    return null;
  }
}

/**
 * Check if embedding needs update based on content hash
 */
export async function needsEmbeddingUpdate(
  entityType: "note" | "capture",
  entityId: string,
  currentContentHash: string
): Promise<boolean> {
  const existing = await getEmbedding(entityType, entityId);
  if (!existing) {
    return true;
  }
  return existing.contentHash !== currentContentHash;
}

/**
 * Generate and store embedding for a note
 */
export async function embedNote(
  userId: string,
  noteId: string,
  content: string,
  title: string
): Promise<number[]> {
  // Combine title and content for better semantic representation
  const textToEmbed = `${title}\n\n${content}`;
  const contentHash = hashContent(textToEmbed);

  // Check if we already have an up-to-date embedding
  const existing = await getEmbedding("note", noteId);
  if (existing && existing.contentHash === contentHash) {
    return existing.embedding;
  }

  // Generate new embedding
  const embedding = await generateEmbedding(textToEmbed);

  // Store it
  await storeEmbedding(userId, "note", noteId, embedding, contentHash);

  return embedding;
}

/**
 * Find notes similar to a given note
 */
export async function findSimilarNotes(
  userId: string,
  noteId: string,
  threshold: number = 0.5,
  limit: number = 10
): Promise<SimilarNote[]> {
  // Get the source note's embedding
  const sourceEmbedding = await getEmbedding("note", noteId);

  if (!sourceEmbedding) {
    // Note doesn't have an embedding yet, fetch note and generate
    const note = await queryOne<Note>(
      `SELECT id, title, content FROM notes WHERE id = ? AND user_id = ?`,
      [noteId, userId]
    );

    if (!note) {
      return [];
    }

    // Generate embedding
    await embedNote(userId, noteId, note.content, note.title);
    const newEmbedding = await getEmbedding("note", noteId);
    if (!newEmbedding) {
      return [];
    }

    return findSimilarNotesWithEmbedding(
      userId,
      noteId,
      newEmbedding.embedding,
      threshold,
      limit
    );
  }

  return findSimilarNotesWithEmbedding(
    userId,
    noteId,
    sourceEmbedding.embedding,
    threshold,
    limit
  );
}

/**
 * Find similar notes given an embedding vector
 */
async function findSimilarNotesWithEmbedding(
  userId: string,
  excludeNoteId: string,
  sourceEmbedding: number[],
  threshold: number,
  limit: number
): Promise<SimilarNote[]> {
  // Get all note embeddings for this user (except the source note)
  const allEmbeddings = await queryAll<{
    entity_id: string;
    embedding: string;
  }>(
    `SELECT e.entity_id, e.embedding
     FROM embeddings e
     WHERE e.entity_type = 'note'
     AND e.user_id = ?
     AND e.entity_id != ?`,
    [userId, excludeNoteId]
  );

  // Compute similarities
  const similarities: { noteId: string; similarity: number }[] = [];

  for (const e of allEmbeddings) {
    let embedding: number[];
    try {
      embedding = JSON.parse(e.embedding);
    } catch {
      continue;
    }
    const similarity = cosineSimilarity(sourceEmbedding, embedding);

    if (similarity >= threshold) {
      similarities.push({
        noteId: e.entity_id,
        similarity,
      });
    }
  }

  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);

  // Take top N
  const topSimilar = similarities.slice(0, limit);

  if (topSimilar.length === 0) {
    return [];
  }

  // Fetch note details
  const noteIds = topSimilar.map((s) => s.noteId);
  const placeholders = noteIds.map(() => "?").join(",");

  const notes = await queryAll<
    Pick<Note, "id" | "title" | "slug" | "summary" | "content_plain" | "note_type" | "created_at" | "updated_at"> & { project_name?: string | null }
  >(
    `SELECT n.id, n.title, n.slug, n.summary, n.content_plain, n.note_type, n.created_at, n.updated_at, p.name as project_name
     FROM notes n
     LEFT JOIN projects p ON n.project_id = p.id
     WHERE n.id IN (${placeholders})`,
    noteIds
  );

  // Combine with similarity scores
  return topSimilar.map((s) => {
    const note = notes.find((n) => n.id === s.noteId);
    return {
      id: s.noteId,
      title: note?.title || "",
      slug: note?.slug || "",
      summary: note?.summary || null,
      content_plain: note?.content_plain || null,
      note_type: note?.note_type || "note",
      project_name: note?.project_name || null,
      created_at: note?.created_at || "",
      updated_at: note?.updated_at || "",
      similarity: s.similarity,
    };
  });
}

/**
 * Find notes similar to arbitrary text (for search/discovery)
 */
export async function findSimilarToText(
  userId: string,
  text: string,
  threshold: number = 0.5,
  limit: number = 10
): Promise<SimilarNote[]> {
  // Generate embedding for the query text
  const queryEmbedding = await generateEmbedding(text);

  // Get all note embeddings for this user
  const allEmbeddings = await queryAll<{
    entity_id: string;
    embedding: string;
  }>(
    `SELECT e.entity_id, e.embedding
     FROM embeddings e
     WHERE e.entity_type = 'note' AND e.user_id = ?`,
    [userId]
  );

  // Compute similarities
  const similarities: { noteId: string; similarity: number }[] = [];

  for (const e of allEmbeddings) {
    let embedding: number[];
    try {
      embedding = JSON.parse(e.embedding);
    } catch {
      continue;
    }
    const similarity = cosineSimilarity(queryEmbedding, embedding);

    if (similarity >= threshold) {
      similarities.push({
        noteId: e.entity_id,
        similarity,
      });
    }
  }

  // Sort and limit
  similarities.sort((a, b) => b.similarity - a.similarity);
  const topSimilar = similarities.slice(0, limit);

  if (topSimilar.length === 0) {
    return [];
  }

  // Fetch note details
  const noteIds = topSimilar.map((s) => s.noteId);
  const placeholders = noteIds.map(() => "?").join(",");

  const notes = await queryAll<
    Pick<Note, "id" | "title" | "slug" | "summary" | "content_plain" | "note_type" | "created_at" | "updated_at"> & { project_name?: string | null }
  >(
    `SELECT n.id, n.title, n.slug, n.summary, n.content_plain, n.note_type, n.created_at, n.updated_at, p.name as project_name
     FROM notes n
     LEFT JOIN projects p ON n.project_id = p.id
     WHERE n.id IN (${placeholders})`,
    noteIds
  );

  return topSimilar.map((s) => {
    const note = notes.find((n) => n.id === s.noteId);
    return {
      id: s.noteId,
      title: note?.title || "",
      slug: note?.slug || "",
      summary: note?.summary || null,
      content_plain: note?.content_plain || null,
      note_type: note?.note_type || "note",
      project_name: note?.project_name || null,
      created_at: note?.created_at || "",
      updated_at: note?.updated_at || "",
      similarity: s.similarity,
    };
  });
}

/**
 * Batch generate embeddings for multiple notes
 */
export async function batchEmbedNotes(
  userId: string,
  notes: { id: string; title: string; content: string }[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const note of notes) {
    try {
      await embedNote(userId, note.id, note.content, note.title);
      success++;
    } catch (error) {
      console.error(`Failed to embed note ${note.id}:`, error);
      failed++;
    }
  }

  return { success, failed };
}

/**
 * Delete embedding for an entity
 */
export async function deleteEmbedding(
  entityType: "note" | "capture",
  entityId: string
): Promise<void> {
  await db.execute({
    sql: `DELETE FROM embeddings WHERE entity_type = ? AND entity_id = ?`,
    args: [entityType, entityId],
  });
}
