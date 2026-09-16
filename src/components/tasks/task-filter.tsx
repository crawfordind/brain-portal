"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderOpen } from "lucide-react";

interface Project {
  id: string;
  name: string;
}

interface TaskFilterProps {
  selectedProject: string;
  onProjectChange: (projectId: string) => void;
  projects: Project[];
}

export function TaskFilter({ selectedProject, onProjectChange, projects }: TaskFilterProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedProject} onValueChange={onProjectChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Tasks" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
