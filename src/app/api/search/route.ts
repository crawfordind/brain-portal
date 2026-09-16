import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { findSimilarToText } from "@/lib/ai/embeddings";

interface SearchResult {
  id: string;
  type: "note" | "capture" | "task" | "attachment";
  title: string;
  content: string;
  snippet: string;
  slug?: string;
  project_name?: string;
  note_title?: string;
  file_type?: string;
  file_size?: number;
  storage_url?: string;
  created_at: string;
  updated_at: string;
  rank?: number;
}

// GET /api/search - Full-text search across notes, captures, tasks, and attachments
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const type = searchParams.get("type"); // note, capture, task, attachment, or all
  const projectId = searchParams.get("projectId");
  const fileType = searchParams.get("fileType"); // image, pdf, document, audio, video
  const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20")), 100);

  if (!query?.trim()) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const searchTerm = query.trim();
  const results: SearchResult[] = [];

  // Search notes using FTS5
  if (!type || type === "note" || type === "all") {
    let noteQuery = `
      SELECT
        n.id,
        'note' as type,
        n.title,
        n.content,
        snippet(notes_fts, 1, '<mark>', '</mark>', '...', 32) as snippet,
        n.slug,
        p.name as project_name,
        n.created_at,
        n.updated_at,
        bm25(notes_fts) as rank
      FROM notes_fts
      JOIN notes n ON notes_fts.rowid = n.rowid
      LEFT JOIN projects p ON n.project_id = p.id
      WHERE notes_fts MATCH ? AND n.user_id = ?
    `;
    const noteArgs: (string | number)[] = [searchTerm, user.id];

    if (projectId) {
      noteQuery += " AND n.project_id = ?";
      noteArgs.push(projectId);
    }

    noteQuery += " ORDER BY rank LIMIT ?";
    noteArgs.push(limit);

    try {
      const noteResults = await queryAll<SearchResult>(noteQuery, noteArgs);
      results.push(...noteResults);
    } catch {
      // Fallback to LIKE search if FTS fails (e.g., syntax error in query)
      const fallbackQuery = `
        SELECT
          n.id,
          'note' as type,
          n.title,
          n.content,
          substr(n.content, 1, 200) as snippet,
          n.slug,
          p.name as project_name,
          n.created_at,
          n.updated_at
        FROM notes n
        LEFT JOIN projects p ON n.project_id = p.id
        WHERE n.user_id = ? AND (n.title LIKE ? OR n.content LIKE ?)
        ${projectId ? "AND n.project_id = ?" : ""}
        ORDER BY n.updated_at DESC
        LIMIT ?
      `;
      const fallbackArgs = projectId
        ? [user.id, `%${searchTerm}%`, `%${searchTerm}%`, projectId, limit]
        : [user.id, `%${searchTerm}%`, `%${searchTerm}%`, limit];

      const noteResults = await queryAll<SearchResult>(fallbackQuery, fallbackArgs);
      results.push(...noteResults);
    }

    // HYBRID SEARCH: Add semantic search results using vector embeddings
    // This finds notes similar in meaning, not just keyword matches
    try {
      const semanticResults = await findSimilarToText(
        user.id,
        searchTerm,
        0.5, // Lower threshold for search (0.5 = moderately similar)
        Math.min(limit, 10) // Limit semantic results to avoid overwhelming
      );

      // Convert to SearchResult format and merge with keyword results
      for (const similar of semanticResults) {
        // Only add if not already in results (deduplicate)
        if (!results.some(r => r.id === similar.id)) {
          results.push({
            id: similar.id,
            type: "note" as const,
            title: similar.title,
            content: similar.content_plain || '',
            snippet: similar.content_plain ? similar.content_plain.substring(0, 200) : '',
            slug: similar.slug,
            project_name: similar.project_name || undefined,
            created_at: similar.created_at,
            updated_at: similar.updated_at,
            rank: similar.similarity * -10 // Convert similarity to BM25-like score
          });
        }
      }

      // Re-sort combined results by relevance
      results.sort((a, b) => (a.rank || 0) - (b.rank || 0));
    } catch (error) {
      // Semantic search is optional - don't fail if embeddings not available
      console.error('Semantic search failed:', error);
    }
  }

  // Search captures
  if (!type || type === "capture" || type === "all") {
    let captureQuery = `
      SELECT
        c.id,
        'capture' as type,
        c.capture_type as title,
        c.content,
        substr(c.content, 1, 200) as snippet,
        c.created_at,
        c.created_at as updated_at
      FROM captures c
      WHERE c.user_id = ? AND c.content LIKE ?
    `;
    const captureArgs: (string | number)[] = [user.id, `%${searchTerm}%`];

    // Note: Captures don't have a direct project_id - they use linked_projects JSON array
    // Filtering by project for captures would require JSON parsing, skip for now
    // if (projectId) { ... }

    captureQuery += " ORDER BY c.created_at DESC LIMIT ?";
    captureArgs.push(limit);

    const captureResults = await queryAll<SearchResult>(captureQuery, captureArgs);
    results.push(...captureResults);
  }

  // Search tasks
  if (!type || type === "task" || type === "all") {
    let taskQuery = `
      SELECT
        t.id,
        'task' as type,
        t.content as title,
        t.content,
        t.content as snippet,
        p.name as project_name,
        t.created_at,
        t.updated_at
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? AND t.content LIKE ?
    `;
    const taskArgs: (string | number)[] = [user.id, `%${searchTerm}%`];

    if (projectId) {
      taskQuery += " AND t.project_id = ?";
      taskArgs.push(projectId);
    }

    taskQuery += " ORDER BY t.created_at DESC LIMIT ?";
    taskArgs.push(limit);

    const taskResults = await queryAll<SearchResult>(taskQuery, taskArgs);
    results.push(...taskResults);
  }

  // Search attachments using FTS5
  if (!type || type === "attachment" || type === "all") {
    let attachmentQuery = `
      SELECT
        a.id,
        'attachment' as type,
        a.filename as title,
        COALESCE(a.description, a.extracted_text, a.filename) as content,
        snippet(attachments_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
        a.file_type,
        a.file_size,
        a.storage_url,
        p.name as project_name,
        n.title as note_title,
        a.created_at,
        a.updated_at,
        bm25(attachments_fts) as rank
      FROM attachments_fts
      JOIN attachments a ON attachments_fts.rowid = a.rowid
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN notes n ON a.note_id = n.id
      WHERE attachments_fts MATCH ? AND a.user_id = ?
    `;
    const attachmentArgs: (string | number)[] = [searchTerm, user.id];

    if (projectId) {
      attachmentQuery += " AND a.project_id = ?";
      attachmentArgs.push(projectId);
    }

    // Filter by file type category
    if (fileType) {
      switch (fileType) {
        case "image":
          attachmentQuery += " AND a.file_type LIKE 'image/%'";
          break;
        case "pdf":
          attachmentQuery += " AND a.file_type = 'application/pdf'";
          break;
        case "document":
          attachmentQuery += " AND (a.file_type LIKE 'application/%' OR a.file_type LIKE 'text/%') AND a.file_type != 'application/pdf'";
          break;
        case "audio":
          attachmentQuery += " AND a.file_type LIKE 'audio/%'";
          break;
        case "video":
          attachmentQuery += " AND a.file_type LIKE 'video/%'";
          break;
      }
    }

    attachmentQuery += " ORDER BY rank LIMIT ?";
    attachmentArgs.push(limit);

    try {
      const attachmentResults = await queryAll<SearchResult>(attachmentQuery, attachmentArgs);
      results.push(...attachmentResults);
    } catch {
      // Fallback to LIKE search if FTS fails
      let fileTypeFilter = "";
      if (fileType) {
        switch (fileType) {
          case "image":
            fileTypeFilter = "AND a.file_type LIKE 'image/%'";
            break;
          case "pdf":
            fileTypeFilter = "AND a.file_type = 'application/pdf'";
            break;
          case "document":
            fileTypeFilter = "AND (a.file_type LIKE 'application/%' OR a.file_type LIKE 'text/%') AND a.file_type != 'application/pdf'";
            break;
          case "audio":
            fileTypeFilter = "AND a.file_type LIKE 'audio/%'";
            break;
          case "video":
            fileTypeFilter = "AND a.file_type LIKE 'video/%'";
            break;
        }
      }

      const fallbackQuery = `
        SELECT
          a.id,
          'attachment' as type,
          a.filename as title,
          COALESCE(a.description, a.extracted_text, a.filename) as content,
          substr(COALESCE(a.description, a.extracted_text, a.filename), 1, 200) as snippet,
          a.file_type,
          a.file_size,
          a.storage_url,
          p.name as project_name,
          n.title as note_title,
          a.created_at,
          a.updated_at
        FROM attachments a
        LEFT JOIN projects p ON a.project_id = p.id
        LEFT JOIN notes n ON a.note_id = n.id
        WHERE a.user_id = ? AND (a.filename LIKE ? OR a.description LIKE ? OR a.extracted_text LIKE ?)
        ${projectId ? "AND a.project_id = ?" : ""}
        ${fileTypeFilter}
        ORDER BY a.updated_at DESC
        LIMIT ?
      `;
      const fallbackArgs = projectId
        ? [user.id, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, projectId, limit]
        : [user.id, `%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`, limit];

      const attachmentResults = await queryAll<SearchResult>(fallbackQuery, fallbackArgs);
      results.push(...attachmentResults);
    }
  }

  // Sort by relevance/recency
  results.sort((a, b) => {
    // Prioritize rank if available
    if (a.rank !== undefined && b.rank !== undefined) {
      return a.rank - b.rank; // Lower rank = more relevant in BM25
    }
    // Fall back to recency
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return NextResponse.json({
    results: results.slice(0, limit),
    query: searchTerm,
    total: results.length,
  });
}
