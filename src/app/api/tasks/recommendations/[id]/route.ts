import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { TaskRecommendation } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// DELETE /api/tasks/recommendations/[id] - Dismiss recommendation
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;

    // Get the recommendation
    const recommendation = await queryOne<TaskRecommendation>(
      'SELECT * FROM task_recommendations WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!recommendation) {
      return NextResponse.json(
        { error: 'Recommendation not found' },
        { status: 404 }
      );
    }

    // Update to dismissed (doesn't provide feedback for learning)
    await db.execute({
      sql: `UPDATE task_recommendations SET status = ? WHERE id = ?`,
      args: ['dismissed', id]
    });

    const updatedRec = await queryOne<TaskRecommendation>(
      'SELECT * FROM task_recommendations WHERE id = ?',
      [id]
    );

    return NextResponse.json({
      success: true,
      recommendation: updatedRec
    });
  } catch (error) {
    console.error('Dismiss error:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss recommendation' },
      { status: 500 }
    );
  }
}
