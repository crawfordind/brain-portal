import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { query, mutate } from "@/lib/db/client";
import type { Note } from "@/lib/db/schema";
import type { InValue } from "@libsql/client";
import { enqueue } from "@/lib/processing/queue";
import { processLocally, extractWikilinks } from "@/lib/processing/local";

// GET /api/notes - List notes with advanced filtering
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // Filter params
  const search = searchParams.get("search");
  const projectId = searchParams.get("projectId");
  const type = searchParams.get("type");
  const pinned = searchParams.get("pinned");
  const archived = searchParams.get("archived");
  const sortBy = searchParams.get("sortBy") || "updated";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // Pagination params - default 200, max 500
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(1, parseInt(limitParam || "200")), 500);
  const offset = parseInt(searchParams.get("offset") || "0");

  // Shared project access subquery
  const sharedAccess = `
    EXISTS (
      SELECT 1 FROM project_collaborators pc
      WHERE pc.project_id = n.project_id AND pc.user_id = ? AND pc.status = 'accepted'
    )`;

  // Build base query — own notes + notes in shared projects.
  // COUNT(*) OVER () computes the total alongside each row so we return
  // both the page and the total in one round-trip instead of running
  // the full filtered query twice.
  let sql = `
    SELECT n.*, p.name as project_name, p.slug as project_slug, p.color as project_color,
           COUNT(*) OVER () as _total_count
    FROM notes n
    LEFT JOIN projects p ON n.project_id = p.id
    WHERE (n.user_id = ? OR (n.project_id IS NOT NULL AND ${sharedAccess}))
  `;
  const args: InValue[] = [user.id, user.id];

  // Full-text search using FTS5
  if (search && search.trim()) {
    const searchTerm = search.trim().replace(/"/g, '""'); // Escape quotes
    sql = `
      SELECT n.*, p.name as project_name, p.slug as project_slug, p.color as project_color,
             highlight(notes_fts, 0, '<mark>', '</mark>') as title_highlight,
             snippet(notes_fts, 1, '<mark>', '</mark>', '...', 64) as content_snippet,
             COUNT(*) OVER () as _total_count
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      INNER JOIN notes_fts ON notes_fts.rowid = n.rowid
      WHERE (n.user_id = ? OR (n.project_id IS NOT NULL AND ${sharedAccess}))
        AND notes_fts MATCH ?
    `;
    args.push(`"${searchTerm}"*`);
  }

  // Filter by archived status (default: show non-archived)
  if (archived === "true") {
    sql += " AND n.is_archived = TRUE";
  } else if (archived === "only") {
    sql += " AND n.is_archived = TRUE";
  } else {
    sql += " AND n.is_archived = FALSE";
  }

  // Filter by pinned
  if (pinned === "true") {
    sql += " AND n.is_pinned = TRUE";
  }

  // Filter by project
  if (projectId) {
    if (projectId === "none") {
      sql += " AND n.project_id IS NULL";
    } else {
      sql += " AND n.project_id = ?";
      args.push(projectId);
    }
  }

  // Filter by note type (support multiple types)
  if (type) {
    const types = type.split(",").filter(Boolean);
    if (types.length === 1) {
      sql += " AND n.note_type = ?";
      args.push(types[0]);
    } else if (types.length > 1) {
      const placeholders = types.map(() => "?").join(",");
      sql += ` AND n.note_type IN (${placeholders})`;
      args.push(...types);
    }
  }

  // Filter by metadata source (e.g., source=voice for voice notes)
  const source = searchParams.get("source");
  if (source) {
    sql += ` AND json_extract(n.metadata, '$.source') = ?`;
    args.push(source);
  }

  // Sorting
  const validSortFields: Record<string, string> = {
    updated: "n.updated_at",
    created: "n.created_at",
    title: "n.title",
    wordCount: "n.word_count",
  };
  const sortField = validSortFields[sortBy] || "n.updated_at";
  const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";

  // For search results, optionally sort by relevance first
  if (search && search.trim()) {
    sql += ` ORDER BY bm25(notes_fts) ${order}, ${sortField} ${order}`;
  } else {
    // Always show pinned first, then sort by specified field
    sql += ` ORDER BY n.is_pinned DESC, ${sortField} ${order}`;
  }

  sql += " LIMIT ? OFFSET ?";
  args.push(limit, offset);

  const rows = await query<Note & {
    project_name: string | null;
    project_slug: string | null;
    project_color: string | null;
    title_highlight?: string;
    content_snippet?: string;
    _total_count?: number;
  }>(sql, args);

  // Total comes from COUNT(*) OVER () on each row. Empty page → 0.
  const total = rows[0]?._total_count ?? 0;
  const notes = rows.map(({ _total_count, ...rest }) => rest);

  return NextResponse.json({
    notes,
    total,
    hasMore: (offset + notes.length) < total,
  });
}

// POST /api/notes - Create note
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, content = "", projectId = null, noteType = "note", metadata = "{}" } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Generate slug from title
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Make slug unique
    const existing = await query<{ slug: string }>(
      "SELECT slug FROM notes WHERE user_id = ? AND slug LIKE ?",
      [user.id, `${baseSlug}%`]
    );

    let slug = baseSlug;
    if (existing.length > 0) {
      const existingSlugs = new Set(existing.map((n) => n.slug));
      let counter = 1;
      while (existingSlugs.has(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
    }

    // Run local processing (free, synchronous)
    const localResult = processLocally(content);
    const wordCount = localResult.structure.wordCount;

    // Validate metadata is valid JSON string
    const metadataStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

    const note = await mutate<Note>(
      `INSERT INTO notes (user_id, project_id, title, slug, content, content_plain, note_type, word_count, metadata, processing_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       RETURNING *`,
      [user.id, projectId, title, slug, content, localResult.contentPlain, noteType, wordCount, metadataStr]
    );

    if (note) {
      // Queue background processing jobs (non-blocking)
      try {
        // Always queue embedding generation
        await enqueue({
          userId: user.id,
          entityType: "note",
          entityId: note.id,
          operation: "generate_embedding",
          tier: "embedding",
          priority: 1,
        });

        // Queue summary generation for notes with enough content
        if (wordCount > 50) {
          await enqueue({
            userId: user.id,
            entityType: "note",
            entityId: note.id,
            operation: "generate_summary",
            tier: "fast_llm",
            priority: 0,
          });
        }

        // Queue connection discovery for all notes (not just those with wikilinks)
        // Embedding-based similarity will find connections even without explicit wikilinks
        await enqueue({
          userId: user.id,
          entityType: "note",
          entityId: note.id,
          operation: "find_connections",
          tier: "embedding",
          priority: 0,
          metadata: { wikilinks: localResult.wikilinks },
        });
      } catch (queueError) {
        // Log but don't fail the request if queueing fails
        console.error("Failed to queue processing jobs:", queueError);
      }
    }

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Failed to create note:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
