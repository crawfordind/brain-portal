import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mutate, query } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';

// POST /api/attachments/[id]/pin - Toggle pin status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get current attachment
    const [attachment] = await query<Attachment>(
      'SELECT * FROM attachments WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Toggle pin status
    const newPinStatus = !attachment.is_pinned;
    const updated = await mutate<Attachment>(
      'UPDATE attachments SET is_pinned = ?, updated_at = datetime("now") WHERE id = ? RETURNING *',
      [newPinStatus, id]
    );

    return NextResponse.json({ attachment: updated, pinned: newPinStatus });
  } catch (error) {
    console.error('Failed to toggle pin status:', error);
    return NextResponse.json({ error: 'Failed to update pin status' }, { status: 500 });
  }
}
