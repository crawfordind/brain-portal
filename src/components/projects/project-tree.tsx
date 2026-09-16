import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckSquare, FolderOpen } from "lucide-react";

interface SubProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  note_count: number;
  open_task_count: number;
}

interface ProjectTreeProps {
  projects: SubProject[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  planning: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  stalled: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  completed: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  archived: "bg-gray-400/10 text-gray-400 border-gray-400/20",
};

export function ProjectTree({ projects }: ProjectTreeProps) {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No sub-projects yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/projects/${project.slug}`}
          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors min-h-14"
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium truncate">{project.name}</span>
              <Badge
                variant="outline"
                className={`${STATUS_COLORS[project.status]} shrink-0 text-xs`}
              >
                {project.status}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span>{project.note_count}</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckSquare className="h-3 w-3" />
                <span>{project.open_task_count}</span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
