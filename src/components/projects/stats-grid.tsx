import { FileText, CheckSquare, CheckCircle2, Package, Bot, Activity } from "lucide-react";

interface ProjectStats {
  noteCount: number;
  taskCount: number;
  activeTasks: number;
  completedTasks: number;
  captureCount: number;
  agentTaskCount: number;
  recentActivityCount: number;
  subProjectCount: number;
}

interface StatsGridProps {
  stats: ProjectStats;
  onStatClick?: (section: string) => void;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick?: () => void;
  colorClass?: string;
}

function StatCard({ icon, label, value, onClick, colorClass = "text-primary" }: StatCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left min-h-[80px]"
      disabled={!onClick}
    >
      <div className={`${colorClass} shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

export function StatsGrid({ stats, onStatClick }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
      <StatCard
        icon={<FileText className="h-5 w-5" />}
        label="Notes"
        value={stats.noteCount}
        onClick={() => onStatClick?.('notes')}
        colorClass="text-blue-600"
      />

      <StatCard
        icon={<CheckSquare className="h-5 w-5" />}
        label="Active Tasks"
        value={stats.activeTasks}
        onClick={() => onStatClick?.('tasks')}
        colorClass="text-orange-600"
      />

      <StatCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label="Completed Tasks"
        value={stats.completedTasks}
        onClick={() => onStatClick?.('tasks')}
        colorClass="text-green-600"
      />

      <StatCard
        icon={<Package className="h-5 w-5" />}
        label="Captures"
        value={stats.captureCount}
        onClick={() => onStatClick?.('captures')}
        colorClass="text-purple-600"
      />

      <StatCard
        icon={<Bot className="h-5 w-5" />}
        label="AI Tasks"
        value={stats.agentTaskCount}
        onClick={() => onStatClick?.('agent-tasks')}
        colorClass="text-indigo-600"
      />

      <StatCard
        icon={<Activity className="h-5 w-5" />}
        label="Recent Activity"
        value={stats.recentActivityCount}
        onClick={() => onStatClick?.('activity')}
        colorClass="text-pink-600"
      />
    </div>
  );
}
