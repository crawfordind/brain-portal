import { NextRequest, NextResponse } from 'next/server';
import { db, queryOne, queryAll } from '@/lib/db/client';
import { getCurrentUser } from '@/lib/auth';
import { complete } from '@/lib/ai/client';
import { getModelForSlot } from '@/lib/ai/models';
import {
  assessProjectHealth,
  buildHealthAlertPrompt,
  type ProjectHealthStats,
  type ProjectHealthAssessment,
} from '@/lib/projects/health';
import { createHash } from 'crypto';
import { getProjectAccess } from '@/lib/permissions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const access = await getProjectAccess(id, user.id);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const project = access.project;

  // Query project stats in parallel
  const [noteRows, taskRows] = await Promise.all([
    queryAll<{ days_since_last_note: number | null }>(
      `SELECT CAST(julianday('now') - julianday(MAX(updated_at)) AS INTEGER) as days_since_last_note
       FROM notes WHERE project_id = ?`,
      [id]
    ),
    queryAll<{ active_tasks: number; urgent_or_high_tasks: number; overdue_tasks: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress')) as active_tasks,
        COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress') AND priority IN ('urgent', 'high')) as urgent_or_high_tasks,
        COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress') AND due_date IS NOT NULL AND due_date < datetime('now')) as overdue_tasks
       FROM tasks WHERE project_id = ?`,
      [id]
    ),
  ]);

  const stats: ProjectHealthStats = {
    projectId: id,
    projectName: project.name,
    status: project.status,
    daysSinceLastNote: noteRows[0]?.days_since_last_note ?? null,
    activeTasks: taskRows[0]?.active_tasks ?? 0,
    urgentOrHighTasks: taskRows[0]?.urgent_or_high_tasks ?? 0,
    overdueTasks: taskRows[0]?.overdue_tasks ?? 0,
  };

  const assessment: ProjectHealthAssessment = assessProjectHealth(stats);
  const healthy = !assessment.shouldGenerateInsight;

  if (healthy) {
    // Dismiss any existing health insight for this project
    await db.execute({
      sql: `UPDATE insights SET is_dismissed = TRUE
            WHERE user_id = ? AND insight_type = 'action'
              AND metadata LIKE '%"project_id":"' || ? || '"%'
              AND metadata LIKE '%"alert_type":"project_health"%'`,
      args: [user.id, id],
    });
    return NextResponse.json({
      healthy: true,
      risks: [],
      overallRisk: 'none',
      summary: null,
      stats,
    });
  }

  // Unhealthy: get or generate AI summary
  const flagHash = assessment.risks.map(r => r.type).sort().join(',');
  const cacheKey = `health:${id}:${createHash('sha256').update(flagHash).digest('hex').slice(0, 8)}`;
  let summary: string | null = null;

  const cached = await queryOne<{ output: string }>(
    "SELECT output FROM ai_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [cacheKey]
  );
  if (cached) {
    summary = cached.output;
  } else {
    try {
      const prompt = buildHealthAlertPrompt(assessment);
      summary = await complete(prompt, {
        slot: 'fast',
        userId: user.id,
        maxTokens: 150,
        temperature: 0.4,
      });
      summary = summary?.trim() ?? null;

      if (summary) {
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        await db.execute({
          sql: `INSERT OR REPLACE INTO ai_cache
                (user_id, cache_key, operation_type, tier, model, input_hash, output, expires_at)
                VALUES (?, ?, 'project_health', 'full_llm', ?, ?, ?, ?)`,
          args: [user.id, cacheKey, await getModelForSlot('fast', user.id), flagHash, summary, expiresAt],
        });
      }
    } catch {
      // LLM failure is non-blocking — card renders without summary
    }
  }

  // Upsert health insight for dashboard feed
  const insightTitle = `${assessment.overallRisk === 'critical' ? 'Project at risk' : 'Project needs attention'}: ${project.name}`;
  const insightContent = summary || assessment.risks.map(r => r.detail).join('; ');
  const metadata = JSON.stringify({
    alert_type: 'project_health',
    project_id: id,
    project_name: project.name,
    risk_level: assessment.overallRisk,
    risks: assessment.risks,
  });

  const existingInsight = await queryOne<{ id: string }>(
    `SELECT id FROM insights WHERE user_id = ? AND insight_type = 'action'
     AND metadata LIKE '%"project_id":"' || ? || '"%'
     AND metadata LIKE '%"alert_type":"project_health"%'`,
    [user.id, id]
  );

  if (existingInsight) {
    await db.execute({
      sql: `UPDATE insights SET title = ?, content = ?, is_dismissed = FALSE, generated_at = datetime('now'), metadata = ?
            WHERE id = ?`,
      args: [insightTitle, insightContent, metadata, existingInsight.id],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO insights (user_id, insight_type, title, content, source_notes, source_captures, confidence, metadata)
            VALUES (?, 'action', ?, ?, '[]', '[]', 0.85, ?)`,
      args: [user.id, insightTitle, insightContent, metadata],
    });
  }

  return NextResponse.json({
    healthy: false,
    risks: assessment.risks,
    overallRisk: assessment.overallRisk,
    summary,
    stats,
  });
}
