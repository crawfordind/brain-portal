/**
 * Project Health Scoring Service
 * Pure functions for assessing project health and generating alert prompts.
 */

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface HealthRisk {
  type: 'stalled' | 'abandoned' | 'overdue_tasks' | 'urgent_pileup';
  label: string;
  detail: string;
  riskLevel: RiskLevel;
}

export interface ProjectHealthStats {
  projectId: string;
  projectName: string;
  status: string;
  daysSinceLastNote: number | null;
  activeTasks: number;
  urgentOrHighTasks: number;
  overdueTasks: number;
}

export interface ProjectHealthAssessment {
  projectId: string;
  projectName: string;
  overallRisk: RiskLevel;
  risks: HealthRisk[];
  shouldGenerateInsight: boolean;
}

const RISK_PRIORITY: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_PRIORITY[a] >= RISK_PRIORITY[b] ? a : b;
}

export function assessProjectHealth(stats: ProjectHealthStats): ProjectHealthAssessment {
  const risks: HealthRisk[] = [];

  // Skip completed/archived projects
  if (stats.status === 'completed' || stats.status === 'archived') {
    return {
      projectId: stats.projectId,
      projectName: stats.projectName,
      overallRisk: 'none',
      risks: [],
      shouldGenerateInsight: false,
    };
  }

  // Stalled / Abandoned detection
  if (stats.daysSinceLastNote !== null && stats.daysSinceLastNote >= 30 && stats.activeTasks > 0) {
    risks.push({
      type: 'abandoned',
      label: 'Possibly abandoned',
      detail: `No notes in ${stats.daysSinceLastNote} days with ${stats.activeTasks} open task${stats.activeTasks === 1 ? '' : 's'}`,
      riskLevel: 'critical',
    });
  } else if (stats.daysSinceLastNote !== null && stats.daysSinceLastNote >= 7 && stats.activeTasks > 0) {
    risks.push({
      type: 'stalled',
      label: 'Stalled',
      detail: `No notes in ${stats.daysSinceLastNote} days with ${stats.activeTasks} open task${stats.activeTasks === 1 ? '' : 's'}`,
      riskLevel: 'medium',
    });
  } else if (stats.daysSinceLastNote === null && stats.activeTasks > 0) {
    // Never had a note but has open tasks
    risks.push({
      type: 'abandoned',
      label: 'Possibly abandoned',
      detail: `No notes ever written with ${stats.activeTasks} open task${stats.activeTasks === 1 ? '' : 's'}`,
      riskLevel: 'critical',
    });
  }

  // Overdue tasks
  if (stats.overdueTasks > 0) {
    risks.push({
      type: 'overdue_tasks',
      label: 'Overdue tasks',
      detail: `${stats.overdueTasks} task${stats.overdueTasks === 1 ? '' : 's'} past due date`,
      riskLevel: stats.overdueTasks >= 3 ? 'high' : 'medium',
    });
  }

  // Urgent pile-up
  if (stats.urgentOrHighTasks >= 3) {
    risks.push({
      type: 'urgent_pileup',
      label: 'Urgent task pile-up',
      detail: `${stats.urgentOrHighTasks} urgent/high priority pending tasks`,
      riskLevel: stats.urgentOrHighTasks >= 5 ? 'high' : 'medium',
    });
  }

  let overallRisk: RiskLevel = 'none';
  for (const risk of risks) {
    overallRisk = maxRisk(overallRisk, risk.riskLevel);
  }

  return {
    projectId: stats.projectId,
    projectName: stats.projectName,
    overallRisk,
    risks,
    shouldGenerateInsight: risks.length > 0,
  };
}

export function buildHealthAlertPrompt(assessment: ProjectHealthAssessment): string {
  const riskDescriptions = assessment.risks
    .map((r) => `- ${r.label}: ${r.detail}`)
    .join('\n');

  return `You are a project management assistant. Write a concise, actionable alert (2-3 sentences max) about the following project health issues.

Project: "${assessment.projectName}"
Overall risk level: ${assessment.overallRisk}
Issues detected:
${riskDescriptions}

Write a brief, friendly alert that:
1. States the main concern
2. Suggests a specific next step
Do not use markdown formatting. Keep it under 150 words.`;
}
