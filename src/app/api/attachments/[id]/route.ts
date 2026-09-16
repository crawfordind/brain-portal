import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query, mutate, queryOne } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';
import { deleteFromR2 } from '@/lib/storage/r2';
import { enqueue } from '@/lib/processing/queue';

// GET /api/attachments/[id] - Get single attachment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const attachment = await queryOne<Attachment>(
    'SELECT * FROM attachments WHERE id = ? AND user_id = ?',
    [id, user.id]
  );

  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  return NextResponse.json({ attachment });
}

// PATCH /api/attachments/[id] - Update attachment metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Verify ownership
    const existing = await queryOne<Attachment>(
      'SELECT * FROM attachments WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!existing) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      description,
      tags,
      projectId,
      noteId,
    } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (tags !== undefined) {
      updates.push('tags = ?');
      values.push(Array.isArray(tags) ? JSON.stringify(tags) : tags);
    }

    if (projectId !== undefined) {
      updates.push('project_id = ?');
      values.push(projectId);
    }

    if (noteId !== undefined) {
      updates.push('note_id = ?');
      values.push(noteId);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push('updated_at = datetime(\'now\')');

    const sql = `
      UPDATE attachments
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
      RETURNING *
    `;
    values.push(id, user.id);

    const attachment = await mutate<Attachment>(sql, values);

    if (!attachment) {
      return NextResponse.json(
        { error: 'Failed to update attachment' },
        { status: 500 }
      );
    }

    // If description changed, re-generate embedding
    if (description !== undefined && description !== existing.description) {
      try {
        await enqueue({
          userId: user.id,
          entityType: 'attachment',
          entityId: attachment.id,
          operation: 'generate_embedding',
          tier: 'embedding',
          priority: 1,
        });
      } catch (queueError) {
        console.error('Failed to queue re-embedding:', queueError);
      }
    }

    return NextResponse.json({ attachment });
  } catch (error) {
    console.error('Failed to update attachment:', error);
    return NextResponse.json(
      { error: 'Failed to update attachment' },
      { status: 500 }
    );
  }
}

// DELETE /api/attachments/[id] - Delete attachment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get attachment to retrieve storage key
    const attachment = await queryOne<Attachment>(
      'SELECT * FROM attachments WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Delete from R2 storage
    try {
      await deleteFromR2(attachment.storage_key);
    } catch (storageError) {
      console.error('Failed to delete from R2:', storageError);
      // Continue with database deletion even if R2 deletion fails
      // This prevents orphaned database records
    }

    // Delete from database (will cascade to embeddings via foreign key)
    await mutate(
      'DELETE FROM attachments WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    return NextResponse.json({ success: true, message: 'Attachment deleted' });
  } catch (error) {
    console.error('Failed to delete attachment:', error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}
