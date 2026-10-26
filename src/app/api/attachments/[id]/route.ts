import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mutate, queryOne } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';
import type { InValue } from '@libsql/client';
import { deleteAttachment, parseTags, resolveAttachmentLinks } from '@/lib/attachments/create';
import { attachmentErrorResponse } from '@/lib/attachments/http';
import { getNoteAccess } from '@/lib/sharing/access';

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

  const attachment = await queryOne<Attachment>('SELECT * FROM attachments WHERE id = ?', [id]);

  // Readable by its uploader, or by anyone who can open the note it is filed
  // under (the list route applies the same rule). Not found either way.
  const readable =
    attachment &&
    (attachment.user_id === user.id ||
      (attachment.note_id !== null && (await getNoteAccess(attachment.note_id, user.id)) !== null));
  if (!attachment || !readable) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  return NextResponse.json({
    attachment: { ...attachment, can_manage: attachment.user_id === user.id },
  });
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { description, tags, projectId, noteId } = body;

    // Build update query dynamically
    const updates: string[] = [];
    const values: InValue[] = [];

    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        return NextResponse.json({ error: "'description' must be a string" }, { status: 400 });
      }
      updates.push('description = ?');
      values.push(description?.trim().slice(0, 5000) || null);
    }

    if (tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(parseTags(tags)));
    }

    // Moving a file is checked like filing one: only to a note or project the
    // user may write to. `null` unlinks.
    if (projectId !== undefined || noteId !== undefined) {
      const links = await resolveAttachmentLinks(user.id, {
        noteId: typeof noteId === 'string' ? noteId : null,
        projectId: typeof projectId === 'string' ? projectId : null,
      });
      if (projectId !== undefined) {
        updates.push('project_id = ?');
        values.push(links.projectId);
      }
      if (noteId !== undefined) {
        updates.push('note_id = ?');
        values.push(links.noteId);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push("updated_at = datetime('now')");

    const attachment = await mutate<Attachment>(
      `UPDATE attachments
       SET ${updates.join(', ')}
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [...values, id, user.id]
    );

    if (!attachment) {
      return NextResponse.json(
        { error: 'Failed to update attachment' },
        { status: 500 }
      );
    }

    // Search reads content_plain, which carries the description
    if (description !== undefined) {
      const refreshed = await mutate<Attachment>(
        `UPDATE attachments
         SET content_plain = NULLIF(trim(
           COALESCE(description, '') || char(10) || char(10) || COALESCE(extracted_text, '')
         ), '')
         WHERE id = ? AND user_id = ?
         RETURNING *`,
        [id, user.id]
      );
      return NextResponse.json({ attachment: refreshed ?? attachment });
    }

    return NextResponse.json({ attachment });
  } catch (error) {
    return attachmentErrorResponse(error, 'Failed to update attachment');
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

    await deleteAttachment(attachment);

    return NextResponse.json({ success: true, message: 'Attachment deleted' });
  } catch (error) {
    console.error('Failed to delete attachment:', error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}
