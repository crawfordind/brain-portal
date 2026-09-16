import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Bot, Code, FileText, Search, TrendingUp, Briefcase } from "lucide-react";
import { AgentTask } from "@/lib/db/schema";

interface AgentTasksCardProps {
  agentTasks: AgentTask[];
}

const AGENT_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  code: { icon: <Code className="h-3 w-3" />, label: "Dev" },
  copy: { icon: <FileText className="h-3 w-3" />, label: "Writer" },
  research: { icon: <Search className="h-3 w-3" />, label: "Researcher" },
  marketing: { icon: <TrendingUp className="h-3 w-3" />, label: "Marketer" },
  analyst: { icon: <Briefcase className="h-3 w-3" />, label: "Analyst" },
  general: { icon: <Bot className="h-3 w-3" />, label: "Assistant" },
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  processing: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  awaiting_review: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  approved: "bg-green-500/10 text-green-600 border-green-500/20",
  revision_requested: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  failed: "bg-red-500/10 text-red-600 border-red-500/20",
};

export function AgentTasksCard({ agentTasks }: AgentTasksCardProps) {
  if (agentTasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No AI tasks for this project yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {agentTasks.map((task) => {
        const config = AGENT_TYPE_CONFIG[task.task_type] || AGENT_TYPE_CONFIG.general;

        return (
          <div
            key={task.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-600">
                  {config.icon}
                  <span className="ml-1 text-xs">{config.label}</span>
                </Badge>
                <Badge variant="outline" className={`${STATUS_COLORS[task.status]} text-xs`}>
                  {task.status.replace("_", " ")}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm line-clamp-2">{task.description}</p>
          </div>
        );
      })}
    </div>
  );
}
