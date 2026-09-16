import { describe, it, expect } from 'vitest';
import {
  assessProjectHealth,
  buildHealthAlertPrompt,
  type ProjectHealthStats,
} from '@/lib/projects/health';

describe('assessProjectHealth', () => {
  const baseStats: ProjectHealthStats = {
    projectId: 'proj-1',
    projectName: 'Test Project',
    status: 'active',
    daysSinceLastNote: 3,
    activeTasks: 5,
    urgentOrHighTasks: 0,
    overdueTasks: 0,
  };

  it('returns no risks for a healthy project', () => {
    const result = assessProjectHealth(baseStats);
    expect(result.overallRisk).toBe('none');
    expect(result.risks).toHaveLength(0);
    expect(result.shouldGenerateInsight).toBe(false);
  });

  it('detects stalled project (7-29 days, has tasks)', () => {
    const result = assessProjectHealth({ ...baseStats, daysSinceLastNote: 10 });
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0].type).toBe('stalled');
    expect(result.risks[0].riskLevel).toBe('medium');
    expect(result.shouldGenerateInsight).toBe(true);
  });

  it('detects abandoned project (30+ days)', () => {
    const result = assessProjectHealth({ ...baseStats, daysSinceLastNote: 45 });
    expect(result.risks.some(r => r.type === 'abandoned')).toBe(true);
    expect(result.overallRisk).toBe('critical');
  });

  it('detects abandoned when daysSinceLastNote is null and has tasks', () => {
    const result = assessProjectHealth({ ...baseStats, daysSinceLastNote: null });
    expect(result.risks.some(r => r.type === 'abandoned')).toBe(true);
    expect(result.overallRisk).toBe('critical');
  });

  it('does not flag stalled when no active tasks', () => {
    const result = assessProjectHealth({
      ...baseStats,
      daysSinceLastNote: 15,
      activeTasks: 0,
    });
    expect(result.risks.filter(r => r.type === 'stalled')).toHaveLength(0);
  });

  it('detects overdue tasks (medium for 1-2)', () => {
    const result = assessProjectHealth({ ...baseStats, overdueTasks: 2 });
    const risk = result.risks.find(r => r.type === 'overdue_tasks');
    expect(risk).toBeDefined();
    expect(risk!.riskLevel).toBe('medium');
  });

  it('detects overdue tasks (high for 3+)', () => {
    const result = assessProjectHealth({ ...baseStats, overdueTasks: 4 });
    const risk = result.risks.find(r => r.type === 'overdue_tasks');
    expect(risk).toBeDefined();
    expect(risk!.riskLevel).toBe('high');
  });

  it('detects urgent pile-up (medium for 3-4)', () => {
    const result = assessProjectHealth({ ...baseStats, urgentOrHighTasks: 3 });
    const risk = result.risks.find(r => r.type === 'urgent_pileup');
    expect(risk).toBeDefined();
    expect(risk!.riskLevel).toBe('medium');
  });

  it('detects urgent pile-up (high for 5+)', () => {
    const result = assessProjectHealth({ ...baseStats, urgentOrHighTasks: 6 });
    const risk = result.risks.find(r => r.type === 'urgent_pileup');
    expect(risk).toBeDefined();
    expect(risk!.riskLevel).toBe('high');
  });

  it('skips completed projects', () => {
    const result = assessProjectHealth({
      ...baseStats,
      status: 'completed',
      daysSinceLastNote: 100,
      overdueTasks: 5,
    });
    expect(result.overallRisk).toBe('none');
    expect(result.risks).toHaveLength(0);
    expect(result.shouldGenerateInsight).toBe(false);
  });

  it('skips archived projects', () => {
    const result = assessProjectHealth({
      ...baseStats,
      status: 'archived',
      daysSinceLastNote: 100,
    });
    expect(result.shouldGenerateInsight).toBe(false);
  });

  it('overall risk is the maximum of all individual risks', () => {
    const result = assessProjectHealth({
      ...baseStats,
      daysSinceLastNote: 10, // medium (stalled)
      overdueTasks: 4, // high
    });
    expect(result.overallRisk).toBe('high');
  });
});

describe('buildHealthAlertPrompt', () => {
  it('includes project name and risk level', () => {
    const assessment = assessProjectHealth({
      projectId: 'p1',
      projectName: 'My Big Project',
      status: 'active',
      daysSinceLastNote: 45,
      activeTasks: 3,
      urgentOrHighTasks: 0,
      overdueTasks: 0,
    });
    const prompt = buildHealthAlertPrompt(assessment);
    expect(prompt).toContain('My Big Project');
    expect(prompt).toContain('critical');
  });

  it('includes risk details', () => {
    const assessment = assessProjectHealth({
      projectId: 'p1',
      projectName: 'Test',
      status: 'active',
      daysSinceLastNote: 10,
      activeTasks: 2,
      urgentOrHighTasks: 4,
      overdueTasks: 1,
    });
    const prompt = buildHealthAlertPrompt(assessment);
    expect(prompt).toContain('Stalled');
    expect(prompt).toContain('Urgent task pile-up');
    expect(prompt).toContain('Overdue tasks');
  });
});
