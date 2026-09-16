import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db, queryOne, mutate } from "@/lib/db/client";
import type { Note } from "@/lib/db/schema";
import type { InValue } from "@libsql/client";
import { enqueue, cancelJobs } from "@/lib/processing/queue";
import { processLocally } from "@/lib/processing/local";
import { hashContent, invalidateCache } from "@/lib/processing/cache";
import { deleteEmbedding } from "@/lib/ai/embeddings";
import { shouldTriggerAutoScan, updateScanMetadata } from "@/lib/recommendations/auto-scan";
import { getProjectAccess, canEdit } from "@/lib/permissions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/notes/[id] - Get single note (supports both id and slug)
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Try to find by id first, then by slug — owned OR in a shared project
  const collaboratorJoin = `
    LEFT JOIN project_collaborators pc ON (
      n.project_id = pc.project_id AND pc.user_id = ? AND pc.status = 'accepted'
    )`;

  let note = await queryOne<Note & { project_name: string | null; viewer_only: number }>(
    `SELECT n.*, p.name as project_name,
            CASE WHEN n.user_id = ? THEN 0 ELSE 1 END as viewer_only
     FROM notes n
     LEFT JOIN projects p ON n.project_id = p.id
     ${collaboratorJoin}
     WHERE n.id = ? AND (n.user_id = ? OR pc.user_id IS NOT NULL)`,
    [user.id, user.id, id, user.id]
  );

  if (!note) {
    note = await queryOne<Note & { project_name: string | null; viewer_only: number }>(
      `SELECT n.*, p.name as project_name,
              CASE WHEN n.user_id = ? THEN 0 ELSE 1 END as viewer_only
       FROM notes n
       LEFT JOIN projects p ON n.project_id = p.id
       ${collaboratorJoin}
       WHERE n.slug = ? AND (n.user_id = ? OR pc.user_id IS NOT NULL)`,
      [user.id, user.id, id, user.id]
    );
  }

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // Determine edit permission for collaborators
  let canEditNote = note.user_id === user.id;
  if (!canEditNote && note.project_id) {
    const access = await getProjectAccess(note.project_id, user.id);
    canEditNote = canEdit(access);
  }

  return NextResponse.json({ note, canEdit: canEditNote });
}

// PUT /api/notes/[id] - Update note (supports both id and slug)
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idOrSlug } = await params;

  // Find note by id or slug (owned or in a shared project)
  const collabJoin = `
    LEFT JOIN project_collaborators pc ON (
      notes.project_id = pc.project_id AND pc.user_id = ? AND pc.status = 'accepted'
    )`;

  let existing = await queryOne<Note>(
    `SELECT notes.* FROM notes ${collabJoin}
     WHERE notes.id = ? AND (notes.user_id = ? OR pc.user_id IS NOT NULL)`,
    [user.id, idOrSlug, user.id]
  );

  if (!existing) {
    existing = await queryOne<Note>(
      `SELECT notes.* FROM notes ${collabJoin}
       WHERE notes.slug = ? AND (notes.user_id = ? OR pc.user_id IS NOT NULL)`,
      [user.id, idOrSlug, user.id]
    );
  }

  if (!existing) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // Check edit permission for collaborators
  if (existing.user_id !== user.id) {
    const access = existing.project_id
      ? await getProjectAccess(existing.project_id, user.id)
      : null;
    if (!canEdit(access)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const id = existing.id; // Use the actual id for updates

  try {
    const body = await request.json();
    const { title, content, projectId, isPinned, isArchived } = body;

    const updates: string[] = [];
    const values: InValue[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      values.push(title);
    }

    let contentChanged = false;
    let newWordCount = 0;

    if (content !== undefined) {
      updates.push("content = ?");
      values.push(content);

      // Run local processing
      const localResult = processLocally(content);
      newWordCount = localResult.structure.wordCount;

      updates.push("content_plain = ?");
      values.push(localResult.contentPlain);

      updates.push("word_count = ?");
      values.push(newWordCount);

      // Check if content actually changed
      const newHash = hashContent(content);
      const oldHash = hashContent(existing.content);
      contentChanged = newHash !== oldHash;

      if (contentChanged) {
        // Mark for reprocessing
        updates.push("processing_status = ?");
        values.push("pending");
      }
    }

    if (projectId !== undefined) {
      updates.push("project_id = ?");
      values.push(projectId);
    }

    if (isPinned !== undefined) {
      updates.push("is_pinned = ?");
      values.push(isPinned);
    }

    if (isArchived !== undefined) {
      updates.push("is_archived = ?");
      values.push(isArchived);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    const note = await mutate<Note>(
      `UPDATE notes SET ${updates.join(", ")} WHERE id = ? RETURNING *`,
      values
    );

    // If content changed, queue reprocessing
    if (contentChanged && note) {
      try {
        // Cancel any pending jobs for this note
        await cancelJobs("note", id);

        // Invalidate cached insights
        await invalidateCache(user.id, { entityId: id });

        // Queue new processing jobs
        await enqueue({
          userId: user.id,
          entityType: "note",
          entityId: id,
          operation: "generate_embedding",
          tier: "embedding",
          priority: 2, // Higher priority for updates
        });

        if (newWordCount > 50) {
          await enqueue({
            userId: user.id,
            entityType: "note",
            entityId: id,
            operation: "generate_summary",
            tier: "fast_llm",
            priority: 1,
          });
        }

        // Re-discover connections after content change
        const localResult = processLocally(content!);
        await enqueue({
          userId: user.id,
          entityType: "note",
          entityId: id,
          operation: "find_connections",
          tier: "embedding",
          priority: 1, // High priority for updates
          metadata: { wikilinks: localResult.wikilinks },
        });
      } catch (queueError) {
        console.error("Failed to queue reprocessing:", queueError);
      }
    }

    // Auto-scan for task recommendations in daily notes
    if (contentChanged && note && note.note_type === "daily" && content) {
      try {
        // Get the daily_note record
        const dailyNote = await queryOne<{ id: string }>(
          "SELECT id FROM daily_notes WHERE note_id = ? AND user_id = ?",
          [id, user.id]
        );

        if (dailyNote) {
          // Check if auto-scan should trigger
          const scanCheck = await shouldTriggerAutoScan(dailyNote.id, user.id, content);

          if (scanCheck.shouldScan) {
            // Queue scan job
            await enqueue({
              userId: user.id,
              entityType: "daily_note",
              entityId: dailyNote.id,
              operation: "scan_for_tasks",
              tier: "fast_llm",
              priority: 5,
            });

            // Update scan metadata
            await updateScanMetadata(dailyNote.id, content, true);
          } else {
            // Update activity timestamp only
            await updateScanMetadata(dailyNote.id, content, false);
          }
        }
      } catch (scanError) {
        console.error("Failed to trigger auto-scan:", scanError);
        // Don't fail the request if auto-scan fails
      }
    }

    return NextResponse.json({ note });
  } catch (error) {
    console.error("Failed to update note:", error);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

// DELETE /api/notes/[id] - Delete note (supports both id and slug)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idOrSlug } = await params;

  // Only the note owner can delete
  let note = await queryOne<Note>(
    "SELECT id, user_id FROM notes WHERE id = ? AND user_id = ?",
    [idOrSlug, user.id]
  );

  if (!note) {
    note = await queryOne<Note>(
      "SELECT id, user_id FROM notes WHERE slug = ? AND user_id = ?",
      [idOrSlug, user.id]
    );
  }

  if (!note) {
    // Check if note exists but user doesn't own it (collaborator trying to delete)
    const sharedNote = await queryOne<Note>(
      "SELECT id FROM notes WHERE id = ? OR slug = ?",
      [idOrSlug, idOrSlug]
    );
    if (sharedNote) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const id = note.id;

  try {
    // Clean up related data
    await cancelJobs("note", id);
    await deleteEmbedding("note", id);
    await invalidateCache(user.id, { entityId: id });

    // Remove tag associations and connections (defensive — FK cascades may handle this)
    await db.execute({ sql: "DELETE FROM note_tags WHERE note_id = ?", args: [id] });
    await db.execute({
      sql: "DELETE FROM note_connections WHERE source_note_id = ? OR target_note_id = ?",
      args: [id, id],
    });

    await db.execute({
      sql: "DELETE FROM notes WHERE id = ? AND user_id = ?",
      args: [id, user.id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete note:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
