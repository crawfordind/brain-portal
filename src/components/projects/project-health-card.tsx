'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { HealthRisk, RiskLevel } from '@/lib/projects/health';

interface HealthData {
  healthy: boolean;
  risks: HealthRisk[];
  overallRisk: RiskLevel;
  summary: string | null;
  stats: {
    daysSinceLastNote: number | null;
    activeTasks: number;
    urgentOrHighTasks: number;
    overdueTasks: number;
  };
}

interface ProjectHealthCardProps {
  projectId: string;
}

export function ProjectHealthCard({ projectId }: ProjectHealthCardProps) {
  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ['project-health', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/health`);
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  if (isLoading || !data || data.healthy) return null;

  const isAtRisk = data.overallRisk === 'critical' || data.overallRisk === 'high';
  const Icon = isAtRisk ? AlertCircle : AlertTriangle;
  const badgeClass = isAtRisk
    ? 'bg-red-500 text-white'
    : 'bg-amber-500 text-white';
  const cardClass = isAtRisk
    ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
    : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20';

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${isAtRisk ? 'text-red-500' : 'text-amber-500'}`} />
          <span className="font-medium text-sm">Project Health</span>
        </div>
        <Badge className={badgeClass}>
          {data.overallRisk}
        </Badge>
      </div>

      <ul className="space-y-1">
        {data.risks.map((risk) => (
          <li key={risk.type} className="text-sm text-muted-foreground flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
            <span>
              <span className="font-medium text-foreground">{risk.label}</span>
              {' — '}
              {risk.detail}
            </span>
          </li>
        ))}
      </ul>

      {data.summary && (
        <p className="text-sm leading-relaxed border-t pt-3">
          {data.summary}
        </p>
      )}
    </div>
  );
}
