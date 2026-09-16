import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { TaskRecommendation, Task } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/tasks/recommendations/[id]/feedback
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { feedback, editedTask } = body;

    if (!['accepted', 'rejected'].includes(feedback)) {
      return NextResponse.json(
        { error: 'feedback must be "accepted" or "rejected"' },
        { status: 400 }
      );
    }

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

    const now = new Date().toISOString();

    if (feedback === 'accepted') {
      // Create the task
      const taskContent = editedTask || recommendation.recommended_task;

      // Get source note's project_id if this is from a note
      let projectId = null;
      if (recommendation.source_type === 'note') {
        const sourceNote = await queryOne<{ project_id: string | null }>(
          'SELECT project_id FROM notes WHERE id = ?',
          [recommendation.source_id]
        );
        projectId = sourceNote?.project_id || null;
      }

      await db.execute({
        sql: `INSERT INTO tasks (user_id, content, status, priority, note_id, project_id)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          taskContent,
          'pending',
          recommendation.priority,
          recommendation.source_type === 'note' ? recommendation.source_id : null,
          projectId
        ]
      });

      const task = await queryOne<Task>(
        'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [user.id]
      );

      // Update recommendation
      await db.execute({
        sql: `UPDATE task_recommendations
              SET status = ?, user_feedback = ?, feedback_at = ?, task_id = ?
              WHERE id = ?`,
        args: ['accepted', 'accepted', now, task?.id || null, id]
      });

      const updatedRec = await queryOne<TaskRecommendation>(
        'SELECT * FROM task_recommendations WHERE id = ?',
        [id]
      );

      return NextResponse.json({
        recommendation: updatedRec,
        task: task
      });
    } else {
      // Rejected
      await db.execute({
        sql: `UPDATE task_recommendations
              SET status = ?, user_feedback = ?, feedback_at = ?
              WHERE id = ?`,
        args: ['rejected', 'rejected', now, id]
      });

      const updatedRec = await queryOne<TaskRecommendation>(
        'SELECT * FROM task_recommendations WHERE id = ?',
        [id]
      );

      return NextResponse.json({
        recommendation: updatedRec
      });
    }
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json(
      { error: 'Failed to process feedback' },
      { status: 500 }
    );
  }
}
