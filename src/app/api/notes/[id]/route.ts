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
import { getNoteAccess, redactForViewer } from "@/lib/sharing/access";
import { canEditRole } from "@/lib/sharing/types";

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

  // Owned, in a shared project, or shared with this account directly — one
  // check for all three (src/lib/sharing/access.ts).
  const access = await getNoteAccess(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  const isOwner = access.role === "owner";
  const note = {
    ...redactForViewer(access.note, access.role),
    viewer_only: isOwner ? 0 : 1,
  };

  return NextResponse.json({
    note,
    canEdit: canEditRole(access.role),
    // Some actions (sending to the agent, sharing) are owner-only, not editor-level.
    isOwner,
    access: {
      role: access.role,
      via: access.via,
      sharedBy: access.share
        ? { email: access.share.ownerEmail, name: access.share.ownerName }
        : null,
    },
  });
}

// PUT /api/notes/[id] - Update note (supports both id and slug)
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: idOrSlug } = await params;

  const access = await getNoteAccess(idOrSlug, user.id);
  if (!access) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  if (!canEditRole(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const existing = access.note;
  const isOwner = access.role === "owner";
  // Background work on the note (embedding, summary, connections, task scan)
  // belongs to its owner, whoever typed the edit. Queuing it under an editor's
  // id put the owner's note into the editor's search index and could turn
  // its contents into tasks in the editor's account.
  const ownerId = existing.user_id;

  const id = existing.id; // Use the actual id for updates

  try {
    const body = await request.json();
    const { title, content, projectId, isPinned, isArchived } = body;

    // Editors change words, not where the note lives. Moving, pinning or
    // archiving someone else's note would rearrange the owner's workspace,
    // and moving it out of a shared project would also revoke the editor's
    // own access mid-edit.
    if (!isOwner && (projectId !== undefined || isPinned !== undefined || isArchived !== undefined)) {
      return NextResponse.json(
        { error: "Only the owner can move, pin or archive this note" },
        { status: 403 }
      );
    }

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
        await invalidateCache(ownerId, { entityId: id });

        // Queue new processing jobs
        await enqueue({
          userId: ownerId,
          entityType: "note",
          entityId: id,
          operation: "generate_embedding",
          tier: "embedding",
          priority: 2, // Higher priority for updates
        });

        if (newWordCount > 50) {
          await enqueue({
            userId: ownerId,
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
          userId: ownerId,
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

    // Look for tasks hiding in what was just written.
    //
    // This used to run on daily notes only, which meant the notes where people
    // actually write "I should email them back" were never scanned unless the
    // user went and pressed a button. Both note kinds keep their scan state in
    // their own `metadata`, so the same throttle applies to each: quiet for a
    // few minutes, enough new words to be worth a look, not scanned too
    // recently.
    if (contentChanged && note && content) {
      try {
        const isDaily = note.note_type === "daily";

        // Daily notes track scan state on their `daily_notes` row, which is a
        // different id from the note itself.
        const scanTarget = isDaily
          ? (
              await queryOne<{ id: string }>(
                "SELECT id FROM daily_notes WHERE note_id = ? AND user_id = ?",
                [id, ownerId]
              )
            )?.id
          : id;

        if (scanTarget) {
          const table = isDaily ? "daily_notes" : "notes";
          const check = await shouldTriggerAutoScan(scanTarget, ownerId, content, table);

          if (check.shouldScan) {
            await enqueue({
              userId: ownerId,
              entityType: isDaily ? "daily_note" : "note",
              entityId: scanTarget,
              operation: "scan_for_tasks",
              tier: "fast_llm",
              priority: 5,
            });
          }

          // Recorded either way: the activity timestamp is what the
          // "has this gone quiet yet?" check reads next time.
          await updateScanMetadata(scanTarget, content, check.shouldScan, table);
        }
      } catch (scanError) {
        console.error("Failed to trigger auto-scan:", scanError);
        // A failed scan must never fail the save.
      }
    }

    return NextResponse.json({ note: note ? redactForViewer(note, access.role) : note });
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

  // Only the note owner can delete. Someone who can open the note gets a 403;
  // anyone else gets the same 404 as for a note that does not exist, so ids
  // and slugs cannot be probed across accounts.
  const access = await getNoteAccess(idOrSlug, user.id);
  if (!access) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }
  if (access.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const note = access.note;

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

    // Account shares cascade with the note; deleted explicitly as well, like
    // the rows above, for a connection that has foreign keys off.
    await db
      .execute({ sql: "DELETE FROM note_shares WHERE note_id = ?", args: [id] })
      .catch(() => {});

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
