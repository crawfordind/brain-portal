import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { findSimilarToText } from "@/lib/ai/embeddings";
import {
  ELLIPSIS,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  buildSnippet,
  cleanFtsSnippet,
  hasHighlight,
  queryTerms,
  toSearchText,
} from "@/lib/search/snippet";

interface SearchResult {
  id: string;
  type: "note" | "capture" | "task" | "attachment";
  title: string;
  /** Readable plain text, trimmed. Never the stored HTML. */
  content: string;
  /**
   * Plain text around the match, matched words wrapped in HIGHLIGHT_START /
   * HIGHLIGHT_END (see src/lib/search/snippet.ts). Never HTML.
   */
  snippet: string;
  slug?: string;
  project_name?: string;
  note_title?: string;
  capture_type?: string;
  file_type?: string;
  file_size?: number;
  storage_url?: string;
  created_at: string;
  updated_at: string;
  rank?: number;
}

/** What the queries select; the raw bodies are cleaned before they leave. */
interface RawRow extends Omit<SearchResult, "content" | "snippet"> {
  body?: string | null;
  fts_snippet?: string | null;
}

const ATTACHMENT_FILE_TYPES = new Set(["image", "pdf", "document", "audio", "video", "other"]);

/** How much plain text each result carries in `content`. */
const CONTENT_PREVIEW_LENGTH = 300;
const TITLE_LENGTH = 80;

// FTS5 snippet() markers: the same control characters the client splits on.
// Bound as parameters (they come first, since snippet() precedes MATCH ?).
const FTS_SNIPPET_ARGS = "?, ?, ?, 24";
const FTS_SNIPPET_PARAMS = [HIGHLIGHT_START, HIGHLIGHT_END, ELLIPSIS];

function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}${ELLIPSIS}`;
}

function finish(row: RawRow, terms: string[]): SearchResult {
  const { body, fts_snippet, ...rest } = row;
  const text = toSearchText(body);
  const fromFts = cleanFtsSnippet(fts_snippet);
  return {
    ...rest,
    content: truncate(text, CONTENT_PREVIEW_LENGTH),
    // FTS knows where the match was; when it matched only the title, its
    // snippet is just the opening, so look for the words ourselves.
    snippet: hasHighlight(fromFts) ? fromFts : buildSnippet(text, terms),
  };
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
  const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20") || 20), 100);

  if (!query?.trim()) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const searchTerm = query.trim();
  const terms = queryTerms(searchTerm);
  const like = `%${searchTerm}%`;
  const results: SearchResult[] = [];

  // Search notes using FTS5
  if (!type || type === "note" || type === "all") {
    let noteQuery = `
      SELECT
        n.id,
        'note' as type,
        n.title,
        COALESCE(n.content_plain, n.content) as body,
        snippet(notes_fts, 1, ${FTS_SNIPPET_ARGS}) as fts_snippet,
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
    const noteArgs: (string | number)[] = [...FTS_SNIPPET_PARAMS, searchTerm, user.id];

    if (projectId) {
      noteQuery += " AND n.project_id = ?";
      noteArgs.push(projectId);
    }

    noteQuery += " ORDER BY rank LIMIT ?";
    noteArgs.push(limit);

    try {
      const noteResults = await queryAll<RawRow>(noteQuery, noteArgs);
      results.push(...noteResults.map((r) => finish(r, terms)));
    } catch {
      // Fallback to LIKE search if FTS fails (e.g., syntax error in query)
      const fallbackQuery = `
        SELECT
          n.id,
          'note' as type,
          n.title,
          COALESCE(n.content_plain, n.content) as body,
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
        ? [user.id, like, like, projectId, limit]
        : [user.id, like, like, limit];

      const noteResults = await queryAll<RawRow>(fallbackQuery, fallbackArgs);
      results.push(...noteResults.map((r) => finish(r, terms)));
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
          results.push(finish({
            id: similar.id,
            type: "note",
            title: similar.title,
            body: similar.content_plain,
            slug: similar.slug,
            project_name: similar.project_name || undefined,
            created_at: similar.created_at,
            updated_at: similar.updated_at,
            rank: similar.similarity * -10 // Convert similarity to BM25-like score
          }, terms));
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
    const captureQuery = `
      SELECT
        c.id,
        'capture' as type,
        c.capture_type,
        c.content as body,
        c.created_at,
        c.created_at as updated_at
      FROM captures c
      WHERE c.user_id = ? AND c.content LIKE ?
      ORDER BY c.created_at DESC LIMIT ?
    `;
    // Note: Captures don't have a direct project_id - they use linked_projects JSON array
    // Filtering by project for captures would require JSON parsing, skip for now

    const captureResults = await queryAll<RawRow>(captureQuery, [user.id, like, limit]);
    for (const row of captureResults) {
      const result = finish(row, terms);
      // A capture has no title of its own; its opening words are the best one.
      result.title = truncate(result.content, TITLE_LENGTH) || row.capture_type || "Capture";
      results.push(result);
    }
  }

  // Search tasks
  if (!type || type === "task" || type === "all") {
    let taskQuery = `
      SELECT
        t.id,
        'task' as type,
        COALESCE(NULLIF(t.title, ''), t.content) as title,
        CASE
          WHEN NULLIF(t.title, '') IS NULL THEN t.description
          ELSE t.content || ' ' || COALESCE(t.description, '')
        END as body,
        p.name as project_name,
        t.created_at,
        t.updated_at
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? AND (t.content LIKE ? OR t.title LIKE ? OR t.description LIKE ?)
    `;
    const taskArgs: (string | number)[] = [user.id, like, like, like];

    if (projectId) {
      taskQuery += " AND t.project_id = ?";
      taskArgs.push(projectId);
    }

    taskQuery += " ORDER BY t.created_at DESC LIMIT ?";
    taskArgs.push(limit);

    const taskResults = await queryAll<RawRow>(taskQuery, taskArgs);
    for (const row of taskResults) {
      const result = finish(row, terms);
      result.title = truncate(toSearchText(row.title), TITLE_LENGTH * 2);
      results.push(result);
    }
  }

  // Search attachments using FTS5
  if (!type || type === "attachment" || type === "all") {
    // Column 2 is the extracted text; column 0 (the filename) is already the title.
    let attachmentQuery = `
      SELECT
        a.id,
        'attachment' as type,
        a.filename as title,
        TRIM(COALESCE(a.description, '') || ' ' || COALESCE(a.extracted_text, '')) as body,
        snippet(attachments_fts, 2, ${FTS_SNIPPET_ARGS}) as fts_snippet,
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
    const attachmentArgs: (string | number)[] = [...FTS_SNIPPET_PARAMS, searchTerm, user.id];

    if (projectId) {
      attachmentQuery += " AND a.project_id = ?";
      attachmentArgs.push(projectId);
    }

    // Filter by file type category. `file_type` holds the category itself
    // ('image', 'pdf', ...); this used to compare it to MIME patterns like
    // 'image/%', so every type filter returned no attachments at all.
    const attachmentFileType = fileType && ATTACHMENT_FILE_TYPES.has(fileType) ? fileType : null;
    if (attachmentFileType) {
      attachmentQuery += " AND a.file_type = ?";
      attachmentArgs.push(attachmentFileType);
    }

    attachmentQuery += " ORDER BY rank LIMIT ?";
    attachmentArgs.push(limit);

    try {
      const attachmentResults = await queryAll<RawRow>(attachmentQuery, attachmentArgs);
      results.push(...attachmentResults.map((r) => finish(r, terms)));
    } catch {
      // Fallback to LIKE search if FTS fails
      const fileTypeFilter = attachmentFileType ? "AND a.file_type = ?" : "";

      const fallbackQuery = `
        SELECT
          a.id,
          'attachment' as type,
          a.filename as title,
          TRIM(COALESCE(a.description, '') || ' ' || COALESCE(a.extracted_text, '')) as body,
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
      const fallbackArgs: (string | number)[] = [user.id, like, like, like];
      if (projectId) fallbackArgs.push(projectId);
      if (attachmentFileType) fallbackArgs.push(attachmentFileType);
      fallbackArgs.push(limit);

      const attachmentResults = await queryAll<RawRow>(fallbackQuery, fallbackArgs);
      results.push(...attachmentResults.map((r) => finish(r, terms)));
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
