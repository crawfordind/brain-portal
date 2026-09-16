import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryAll, db } from '@/lib/db/client';
import { TaskRecommendation } from '@/lib/db/schema';

// GET /api/tasks/recommendations
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status') || 'pending';
  const sourceType = searchParams.get('sourceType');
  const limit = parseInt(searchParams.get('limit') || '20');

  let query = `
    SELECT
      tr.*,
      n.title as note_title,
      n.slug as note_slug,
      p.name as project_name,
      p.id as project_id
    FROM task_recommendations tr
    LEFT JOIN notes n ON tr.source_type = 'note' AND tr.source_id = n.id
    LEFT JOIN projects p ON n.project_id = p.id
    WHERE tr.user_id = ? AND tr.status = ?
  `;
  const args: (string | number)[] = [user.id, status];

  if (sourceType) {
    query += ' AND tr.source_type = ?';
    args.push(sourceType);
  }

  query += ' ORDER BY tr.confidence DESC, tr.created_at DESC LIMIT ?';
  args.push(limit);

  const recommendations = await queryAll<TaskRecommendation>(query, args);

  return NextResponse.json({
    recommendations,
    count: recommendations.length,
    hasMore: recommendations.length === limit,
  });
}

// DELETE /api/tasks/recommendations - Dismiss all pending recommendations
export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Update all pending recommendations to dismissed
    const result = await db.execute({
      sql: `UPDATE task_recommendations SET status = ? WHERE user_id = ? AND status = ?`,
      args: ['dismissed', user.id, 'pending']
    });

    return NextResponse.json({
      success: true,
      dismissedCount: result.rowsAffected || 0
    });
  } catch (error) {
    console.error('Bulk dismiss error:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss recommendations' },
      { status: 500 }
    );
  }
}
