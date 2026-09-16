import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { getCurrentUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const [recentNotes, recentTasks, recentCaptures, recentProjects] = await db.batch([
      {
        sql: `SELECT DISTINCT n.id as entity_id, n.title, n.content_plain as content,
               n.created_at, n.updated_at, 'note' as entity_type
        FROM notes n
        INNER JOIN activity_log a ON a.entity_id = n.id AND a.entity_type = 'note'
        WHERE n.user_id = ?
          AND n.is_archived = FALSE
        ORDER BY a.created_at DESC
        LIMIT ?`,
        args: [user.id, Math.min(limit, 5)],
      },
      {
        sql: `SELECT DISTINCT t.id as entity_id, t.content, t.created_at, t.updated_at, 'task' as entity_type
        FROM tasks t
        INNER JOIN activity_log a ON a.entity_id = t.id AND a.entity_type = 'task'
        WHERE t.user_id = ?
          AND t.status != 'completed'
        ORDER BY a.created_at DESC
        LIMIT ?`,
        args: [user.id, Math.min(limit, 5)],
      },
      {
        sql: `SELECT DISTINCT c.id as entity_id, c.content, c.created_at, 'capture' as entity_type
        FROM captures c
        INNER JOIN activity_log a ON a.entity_id = c.id AND a.entity_type = 'capture'
        WHERE c.user_id = ?
          AND c.processed = FALSE
        ORDER BY a.created_at DESC
        LIMIT ?`,
        args: [user.id, Math.min(limit, 5)],
      },
      {
        sql: `SELECT DISTINCT p.id as entity_id, p.name as title, p.description as content,
               p.created_at, p.updated_at, 'project' as entity_type
        FROM projects p
        INNER JOIN activity_log a ON a.entity_id = p.id AND a.entity_type = 'project'
        WHERE p.user_id = ?
          AND p.status = 'active'
        ORDER BY a.created_at DESC
        LIMIT ?`,
        args: [user.id, Math.min(limit, 3)],
      },
    ]);

    return NextResponse.json({
      notes: recentNotes.rows || [],
      tasks: recentTasks.rows || [],
      captures: recentCaptures.rows || [],
      projects: recentProjects.rows || [],
    });
  } catch (error) {
    console.error('Error fetching recent items:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent items' },
      { status: 500 }
    );
  }
}
