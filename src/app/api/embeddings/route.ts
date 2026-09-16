import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryAll } from "@/lib/db/client";
import { embedNote, batchEmbedNotes, deleteEmbedding } from "@/lib/ai/embeddings";
import type { Note, Embedding } from "@/lib/db/schema";

// GET /api/embeddings - Get embedding stats
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "stats") {
    // Get embedding statistics
    const stats = await queryAll<{
      entity_type: string;
      count: number;
    }>(
      `SELECT entity_type, COUNT(*) as count
       FROM embeddings
       WHERE user_id = ?
       GROUP BY entity_type`,
      [user.id]
    );

    const notesWithoutEmbeddings = await queryAll<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM notes n
       WHERE n.user_id = ?
       AND n.is_archived = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM embeddings e
         WHERE e.entity_type = 'note' AND e.entity_id = n.id
       )`,
      [user.id]
    );

    return NextResponse.json({
      stats: {
        notes: stats.find((s) => s.entity_type === "note")?.count || 0,
        captures: stats.find((s) => s.entity_type === "capture")?.count || 0,
        notesWithoutEmbeddings: notesWithoutEmbeddings[0]?.count || 0,
      },
    });
  }

  // Default: list notes with embeddings
  const embeddings = await queryAll<{
    entity_id: string;
    content_hash: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT entity_id, content_hash, created_at, updated_at
     FROM embeddings
     WHERE user_id = ? AND entity_type = 'note'
     ORDER BY updated_at DESC
     LIMIT 100`,
    [user.id]
  );

  return NextResponse.json({ embeddings });
}

// POST /api/embeddings - Generate embeddings
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, noteId, noteIds } = body;

    if (action === "generate" && noteId) {
      // Generate embedding for a single note
      const note = await queryAll<Note>(
        `SELECT id, title, content FROM notes
         WHERE id = ? AND user_id = ? AND is_archived = FALSE`,
        [noteId, user.id]
      );

      if (note.length === 0) {
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }

      await embedNote(user.id, note[0].id, note[0].content, note[0].title);

      return NextResponse.json({
        success: true,
        message: "Embedding generated",
        noteId: note[0].id,
      });
    }

    if (action === "batch" && noteIds && Array.isArray(noteIds)) {
      // Generate embeddings for multiple notes
      const notes = await queryAll<Note>(
        `SELECT id, title, content FROM notes
         WHERE id IN (${noteIds.map(() => "?").join(",")})
         AND user_id = ? AND is_archived = FALSE`,
        [...noteIds, user.id]
      );

      const result = await batchEmbedNotes(user.id, notes);

      return NextResponse.json({
        message: `Generated ${result.success} embeddings, ${result.failed} failed`,
        generated: result.success,
        failed: result.failed,
      });
    }

    if (action === "generate-all") {
      // Generate embeddings for all notes without embeddings
      const notes = await queryAll<Note>(
        `SELECT n.id, n.title, n.content
         FROM notes n
         WHERE n.user_id = ? AND n.is_archived = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM embeddings e
           WHERE e.entity_type = 'note' AND e.entity_id = n.id
         )
         LIMIT 100`,
        [user.id]
      );

      if (notes.length === 0) {
        return NextResponse.json({
          message: "All notes already have embeddings",
          generated: 0,
          failed: 0,
        });
      }

      const result = await batchEmbedNotes(user.id, notes);

      return NextResponse.json({
        message: `Generated ${result.success} embeddings, ${result.failed} failed`,
        generated: result.success,
        failed: result.failed,
        remaining: Math.max(0, notes.length - result.success),
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'generate', 'batch', or 'generate-all'" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Embedding generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate embeddings" },
      { status: 500 }
    );
  }
}

// DELETE /api/embeddings - Delete embeddings
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { entityType, entityId } = body;

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "entityType and entityId are required" },
        { status: 400 }
      );
    }

    await deleteEmbedding(entityType, entityId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete embedding error:", error);
    return NextResponse.json(
      { error: "Failed to delete embedding" },
      { status: 500 }
    );
  }
}
