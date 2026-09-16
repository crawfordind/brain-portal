import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { scanForTasks } from '@/lib/recommendations/scanner';
import { queryOne, queryAll } from '@/lib/db/client';

// POST /api/tasks/recommendations/scan
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sourceType, sourceId, daysBack: rawDaysBack = 7 } = body;
    const daysBack = Math.max(1, Math.min(90, Math.floor(Number(rawDaysBack)) || 7));

    // Validate sourceType
    if (!['note', 'daily_note', 'capture', 'recent'].includes(sourceType)) {
      return NextResponse.json(
        { error: 'Invalid sourceType. Must be: note, daily_note, capture, or recent' },
        { status: 400 }
      );
    }

    // Check for existing pending scan job
    if (sourceType !== 'recent' && sourceId) {
      const existingJob = await queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM processing_queue
         WHERE user_id = ? AND entity_type = ? AND entity_id = ?
         AND operation = 'scan_for_tasks' AND status IN ('pending', 'processing')`,
        [user.id, sourceType, sourceId]
      );

      if (existingJob) {
        return NextResponse.json({
          status: 'already_scanning',
          jobId: existingJob.id,
          message: 'Scan already in progress'
        });
      }
    }

    // Handle 'recent' sourceType - scan recent notes
    if (sourceType === 'recent') {
      const recentNotes = await queryAll<{ id: string; note_type: string }>(
        `SELECT id, note_type FROM notes
         WHERE user_id = ? AND updated_at >= datetime('now', '-${daysBack} days')
         AND is_archived = FALSE
         ORDER BY updated_at DESC
         LIMIT 10`,
        [user.id]
      );

      let totalScanned = 0;
      let totalRecommendations = 0;
      const allRecommendations: any[] = [];

      for (const note of recentNotes) {
        const result = await scanForTasks(user.id, 'note', note.id);
        totalScanned += result.scannedCount;
        totalRecommendations += result.recommendationCount;
        allRecommendations.push(...result.recommendations);
      }

      return NextResponse.json({
        scannedCount: totalScanned,
        recommendationCount: totalRecommendations,
        recommendations: allRecommendations.slice(0, 10) // Top 10 overall
      });
    }

    // Single source scan
    if (!sourceId) {
      return NextResponse.json(
        { error: 'sourceId required when sourceType is not "recent"' },
        { status: 400 }
      );
    }

    const result = await scanForTasks(user.id, sourceType, sourceId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Scan error:', error);
    return NextResponse.json(
      { error: 'Failed to scan for tasks' },
      { status: 500 }
    );
  }
}
