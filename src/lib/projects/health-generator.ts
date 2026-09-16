/**
 * Project Health Insight Generator
 * Queries project stats, scores health, and generates AI-driven alerts.
 */

import { db, queryAll, queryOne } from '@/lib/db/client';
import { complete } from '@/lib/ai/client';
import {
  assessProjectHealth,
  buildHealthAlertPrompt,
  type ProjectHealthStats,
  type ProjectHealthAssessment,
} from './health';

interface ProjectStatsRow {
  id: string;
  name: string;
  status: string;
  days_since_last_note: number | null;
  active_tasks: number;
  urgent_or_high_tasks: number;
  overdue_tasks: number;
}

export async function generateHealthInsightsForUser(
  userId: string
): Promise<{ generated: string[]; skipped: string[] }> {
  const generated: string[] = [];
  const skipped: string[] = [];

  // Single query: all active/planning projects with health stats
  const projects = await queryAll<ProjectStatsRow>(
    `SELECT
      p.id,
      p.name,
      p.status,
      (SELECT CAST(julianday('now') - julianday(MAX(n.updated_at)) AS INTEGER)
       FROM notes n WHERE n.project_id = p.id) as days_since_last_note,
      (SELECT COUNT(*) FROM tasks t
       WHERE t.project_id = p.id AND t.status IN ('pending', 'in_progress')) as active_tasks,
      (SELECT COUNT(*) FROM tasks t
       WHERE t.project_id = p.id AND t.status IN ('pending', 'in_progress')
       AND t.priority IN ('urgent', 'high')) as urgent_or_high_tasks,
      (SELECT COUNT(*) FROM tasks t
       WHERE t.project_id = p.id AND t.status IN ('pending', 'in_progress')
       AND t.due_date IS NOT NULL AND t.due_date < datetime('now')) as overdue_tasks
    FROM projects p
    WHERE p.user_id = ? AND p.status IN ('active', 'planning')
    ORDER BY p.name`,
    [userId]
  );

  for (const proj of projects) {
    const stats: ProjectHealthStats = {
      projectId: proj.id,
      projectName: proj.name,
      status: proj.status,
      daysSinceLastNote: proj.days_since_last_note,
      activeTasks: proj.active_tasks,
      urgentOrHighTasks: proj.urgent_or_high_tasks,
      overdueTasks: proj.overdue_tasks,
    };

    const assessment = assessProjectHealth(stats);

    if (!assessment.shouldGenerateInsight) {
      skipped.push(proj.name);
      continue;
    }

    // Dedup: skip if a health insight for this project was generated in the last 6 days
    const recent = await queryOne<{ id: string }>(
      `SELECT id FROM insights
       WHERE user_id = ?
         AND insight_type = 'action'
         AND metadata LIKE '%"alert_type":"project_health"%'
         AND metadata LIKE '%"project_id":"' || ? || '"%'
         AND generated_at > datetime('now', '-6 days')
       LIMIT 1`,
      [userId, proj.id]
    );

    if (recent) {
      skipped.push(proj.name);
      continue;
    }

    // Generate alert text via AI
    const prompt = buildHealthAlertPrompt(assessment);
    let alertText: string;
    try {
      alertText = await complete(prompt, {
        slot: 'fast',
        userId,
        maxTokens: 150,
        temperature: 0.4,
      });
      alertText = alertText.trim();
    } catch (err) {
      console.error(`[HealthGenerator] Failed to generate alert for ${proj.name}:`, err);
      skipped.push(proj.name);
      continue;
    }

    // Build title from risk level
    const riskEmoji =
      assessment.overallRisk === 'critical' ? 'Project at risk' :
      assessment.overallRisk === 'high' ? 'Project needs attention' :
      'Project health check';

    const metadata = JSON.stringify({
      alert_type: 'project_health',
      project_id: proj.id,
      project_name: proj.name,
      risk_level: assessment.overallRisk,
      risks: assessment.risks,
    });

    await db.execute({
      sql: `INSERT INTO insights
        (user_id, insight_type, title, content, source_notes, source_captures, confidence, metadata)
        VALUES (?, 'action', ?, ?, '[]', '[]', 0.85, ?)`,
      args: [userId, `${riskEmoji}: ${proj.name}`, alertText, metadata],
    });

    generated.push(proj.name);
  }

  return { generated, skipped };
}
