import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';
import type { InValue } from '@libsql/client';
import { isR2Configured } from '@/lib/storage/r2';
import { createAttachment, parseTags, resolveAttachmentLinks } from '@/lib/attachments/create';
import { attachmentErrorResponse, storageNotConfigured } from '@/lib/attachments/http';
import { getNoteAccess } from '@/lib/sharing/access';

const FILE_TYPES = new Set(['image', 'pdf', 'audio', 'video', 'document', 'other']);

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// POST /api/attachments - Upload a file through the app.
//
// For files up to DIRECT_UPLOAD_THRESHOLD (4 MB). Larger files cannot reach a
// route on Vercel at all (4.5 MB request cap), so the browser sends them
// straight to storage via /api/attachments/uploads instead.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isR2Configured()) return storageNotConfigured();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'The upload did not arrive complete. Please try again.' },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  try {
    const links = await resolveAttachmentLinks(user.id, {
      noteId: formString(formData, 'noteId'),
      projectId: formString(formData, 'projectId'),
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const { attachment, deduplicated } = await createAttachment({
      userId: user.id,
      buffer,
      declaredType: file.type,
      filename: file.name,
      ...links,
      description: formString(formData, 'description'),
      tags: parseTags(formString(formData, 'tags')),
    });

    if (deduplicated) {
      return NextResponse.json(
        { attachment, message: 'File already exists', deduplicated: true },
        { status: 200 }
      );
    }
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    return attachmentErrorResponse(error, 'Failed to upload attachment');
  }
}

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// GET /api/attachments - List attachments with filtering
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // Filter params
  const search = searchParams.get('search')?.trim() ?? '';
  const projectId = searchParams.get('projectId');
  const noteId = searchParams.get('noteId');
  const fileType = searchParams.get('fileType');
  const sortBy = searchParams.get('sortBy') || 'created';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  // Pagination params. A bad value used to reach SQL as NaN and 500 the list.
  const limit = boundedInt(searchParams.get('limit'), 50, 1, 200);
  const offset = boundedInt(searchParams.get('offset'), 0, 0, 1_000_000);

  const select = `SELECT a.*, p.name as project_name, n.title as note_title`;
  const joins = `
    FROM attachments a
    LEFT JOIN projects p ON a.project_id = p.id
    LEFT JOIN notes n ON a.note_id = n.id`;

  // A note's files go wherever the note goes. Asked for one note, the list is
  // every file filed under it, whoever uploaded it, as long as the viewer can
  // open the note (owner, project collaborator or share recipient). Otherwise
  // it is the viewer's own files. Before, it was always the viewer's own, so a
  // shared note arrived without its files, and an owner never saw files a
  // project editor had added.
  let scope = 'a.user_id = ?';
  const args: InValue[] = [user.id];
  if (noteId) {
    try {
      const access = await getNoteAccess(noteId, user.id);
      if (!access) {
        return NextResponse.json({ error: 'Note not found' }, { status: 404 });
      }
      scope = 'a.note_id = ?';
      args[0] = access.note.id;
    } catch (error) {
      console.error('Failed to check note access for attachments:', error);
      return NextResponse.json({ error: 'Failed to list attachments' }, { status: 500 });
    }
  }

  let from = `${joins}
    WHERE ${scope}`;
  let snippets = '';

  // Full-text search using FTS5
  if (search) {
    const searchTerm = search.replace(/"/g, '""'); // Escape quotes
    snippets = `,
             snippet(attachments_fts, 0, '<mark>', '</mark>', '...', 32) as filename_snippet,
             snippet(attachments_fts, 1, '<mark>', '</mark>', '...', 64) as description_snippet`;
    from = `${joins}
      INNER JOIN attachments_fts ON attachments_fts.rowid = a.rowid
      WHERE ${scope} AND attachments_fts MATCH ?`;
    args.push(`"${searchTerm}"*`);
  }

  // Filter by project
  if (projectId) {
    if (projectId === 'none') {
      from += ' AND a.project_id IS NULL';
    } else {
      from += ' AND a.project_id = ?';
      args.push(projectId);
    }
  }

  // Filter by file type
  if (fileType && FILE_TYPES.has(fileType)) {
    from += ' AND a.file_type = ?';
    args.push(fileType);
  }

  // Sorting
  const validSortFields: Record<string, string> = {
    created: 'a.created_at',
    updated: 'a.updated_at',
    filename: 'a.filename',
    size: 'a.file_size',
  };
  const sortField = validSortFields[sortBy] || 'a.created_at';
  const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // For search results, sort by relevance first
  const orderBy = search
    ? ` ORDER BY bm25(attachments_fts) ${order}, ${sortField} ${order}`
    : ` ORDER BY ${sortField} ${order}`;

  try {
    const countResult = await query<{ count: number }>(`SELECT COUNT(*) as count ${from}`, args);
    const total = Number(countResult[0]?.count ?? 0);

    const attachments = await query<
      Attachment & {
        project_name: string | null;
        note_title: string | null;
        filename_snippet?: string;
        description_snippet?: string;
      }
    >(`${select}${snippets} ${from}${orderBy} LIMIT ? OFFSET ?`, [...args, limit, offset]);

    return NextResponse.json({
      // Only the uploader may delete, pin or re-file a file (those routes are
      // scoped to user_id), so the UI offers those controls only where true.
      attachments: attachments.map((a) => ({ ...a, can_manage: a.user_id === user.id })),
      total,
      hasMore: offset + attachments.length < total,
    });
  } catch (error) {
    console.error('Failed to list attachments:', error);
    return NextResponse.json({ error: 'Failed to list attachments' }, { status: 500 });
  }
}
