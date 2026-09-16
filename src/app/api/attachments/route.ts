import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, mutate } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';
import type { InValue } from '@libsql/client';
import { uploadToR2 } from '@/lib/storage/r2';
import {
  validateFile,
  calculateHash,
  generateStorageKey,
} from '@/lib/storage/validation';
import { enqueue } from '@/lib/processing/queue';

// POST /api/attachments - Upload file
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const noteId = formData.get('noteId') as string | null;
    const description = formData.get('description') as string | null;
    const tagsString = formData.get('tags') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file
    const validation = await validateFile(buffer, file.type, file.name);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const fileType = validation.fileType!;

    // Calculate hash for deduplication
    const contentHash = calculateHash(buffer);

    // Check for existing file with same hash for this user
    const existing = await query<Attachment>(
      'SELECT * FROM attachments WHERE user_id = ? AND content_hash = ? LIMIT 1',
      [user.id, contentHash]
    );

    if (existing.length > 0) {
      // File already exists, return existing attachment
      return NextResponse.json(
        {
          attachment: existing[0],
          message: 'File already exists',
          deduplicated: true,
        },
        { status: 200 }
      );
    }

    // Generate storage key
    const storageKey = generateStorageKey(user.id, contentHash, file.name);

    // Upload to R2
    let storageUrl: string;
    try {
      storageUrl = await uploadToR2(storageKey, buffer, file.type);
    } catch (error) {
      console.error('R2 upload failed:', error);
      return NextResponse.json(
        { error: 'Failed to upload file to storage' },
        { status: 500 }
      );
    }

    // Parse tags
    const tags = tagsString ? JSON.stringify(tagsString.split(',').map(t => t.trim())) : '[]';

    // Create database record
    const attachment = await mutate<Attachment>(
      `INSERT INTO attachments (
        user_id, filename, original_filename, mime_type, file_size,
        storage_key, storage_url, file_type, project_id, note_id,
        description, content_hash, tags, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      RETURNING *`,
      [
        user.id,
        file.name,
        file.name,
        file.type,
        buffer.length,
        storageKey,
        storageUrl,
        fileType,
        projectId,
        noteId,
        description,
        contentHash,
        tags,
      ]
    );

    if (!attachment) {
      return NextResponse.json(
        { error: 'Failed to create attachment record' },
        { status: 500 }
      );
    }

    // Queue processing jobs based on file type
    try {
      // Extract metadata (local tier - free)
      await enqueue({
        userId: user.id,
        entityType: 'attachment',
        entityId: attachment.id,
        operation: 'extract_metadata',
        tier: 'local',
        priority: 2,
      });

      // Type-specific processing
      if (fileType === 'image') {
        // Generate thumbnail (local tier - free)
        await enqueue({
          userId: user.id,
          entityType: 'attachment',
          entityId: attachment.id,
          operation: 'generate_thumbnail',
          tier: 'local',
          priority: 2,
        });

        // Generate AI description (fast_llm tier)
        await enqueue({
          userId: user.id,
          entityType: 'attachment',
          entityId: attachment.id,
          operation: 'generate_description',
          tier: 'fast_llm',
          priority: 1,
        });
      } else if (fileType === 'pdf' || fileType === 'document') {
        // Extract text (embedding tier)
        await enqueue({
          userId: user.id,
          entityType: 'attachment',
          entityId: attachment.id,
          operation: 'extract_text',
          tier: 'embedding',
          priority: 1,
        });
      } else if (fileType === 'audio') {
        // Extract text/transcription (fast_llm tier)
        await enqueue({
          userId: user.id,
          entityType: 'attachment',
          entityId: attachment.id,
          operation: 'extract_text',
          tier: 'fast_llm',
          priority: 1,
        });
      }

      // Always queue embedding generation after content extraction
      await enqueue({
        userId: user.id,
        entityType: 'attachment',
        entityId: attachment.id,
        operation: 'generate_embedding',
        tier: 'embedding',
        priority: 0,
      });
    } catch (queueError) {
      console.error('Failed to queue processing jobs:', queueError);
      // Don't fail the request, processing can be retried later
    }

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error('Failed to upload attachment:', error);
    return NextResponse.json(
      { error: 'Failed to upload attachment' },
      { status: 500 }
    );
  }
}

// GET /api/attachments - List attachments with filtering
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // Filter params
  const search = searchParams.get('search');
  const projectId = searchParams.get('projectId');
  const noteId = searchParams.get('noteId');
  const fileType = searchParams.get('fileType');
  const sortBy = searchParams.get('sortBy') || 'created';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  // Pagination params
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  // Build base query
  let sql = `
    SELECT a.*, p.name as project_name, n.title as note_title
    FROM attachments a
    LEFT JOIN projects p ON a.project_id = p.id
    LEFT JOIN notes n ON a.note_id = n.id
    WHERE a.user_id = ?
  `;
  const args: InValue[] = [user.id];

  // Full-text search using FTS5
  if (search && search.trim()) {
    const searchTerm = search.trim().replace(/"/g, '""'); // Escape quotes
    sql = `
      SELECT a.*, p.name as project_name, n.title as note_title,
             snippet(attachments_fts, 0, '<mark>', '</mark>', '...', 32) as filename_snippet,
             snippet(attachments_fts, 1, '<mark>', '</mark>', '...', 64) as description_snippet
      FROM attachments a
      LEFT JOIN projects p ON a.project_id = p.id
      LEFT JOIN notes n ON a.note_id = n.id
      INNER JOIN attachments_fts ON attachments_fts.rowid = a.rowid
      WHERE a.user_id = ? AND attachments_fts MATCH ?
    `;
    args.push(`"${searchTerm}"*`);
  }

  // Filter by project
  if (projectId) {
    if (projectId === 'none') {
      sql += ' AND a.project_id IS NULL';
    } else {
      sql += ' AND a.project_id = ?';
      args.push(projectId);
    }
  }

  // Filter by note
  if (noteId) {
    sql += ' AND a.note_id = ?';
    args.push(noteId);
  }

  // Filter by file type
  if (fileType) {
    sql += ' AND a.file_type = ?';
    args.push(fileType);
  }

  // Get total count before pagination
  const countSql = sql.replace(
    /SELECT a\.\*, p\.name as project_name, n\.title as note_title[\s\S]*?FROM/,
    'SELECT COUNT(*) as count FROM'
  );
  const countResult = await query<{ count: number }>(countSql, args);
  const total = countResult[0]?.count || 0;

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
  if (search && search.trim()) {
    sql += ` ORDER BY bm25(attachments_fts) ${order}, ${sortField} ${order}`;
  } else {
    sql += ` ORDER BY ${sortField} ${order}`;
  }

  // Apply pagination
  sql += ' LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const attachments = await query<
    Attachment & {
      project_name: string | null;
      note_title: string | null;
      filename_snippet?: string;
      description_snippet?: string;
    }
  >(sql, args);

  return NextResponse.json({
    attachments,
    total,
    hasMore: offset + attachments.length < total,
  });
}
