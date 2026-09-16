"use client";

import { format, parseISO } from "date-fns";
import { X, CheckCircle2, Edit, Trash2, Calendar, FolderOpen, ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjects } from "@/hooks/use-projects";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Task } from "@/types/task";
import { rruleToText } from "@/lib/tasks/recurrence";

interface TaskDetailPanelProps {
  task: Task;
  open: boolean;
  onClose: () => void;
  onComplete?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onReschedule?: (task: Task) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "To Do",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function TaskDetailPanel({
  task,
  open,
  onClose,
  onComplete,
  onEdit,
  onDelete,
  onReschedule,
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();

  const handleChangeProject = async (projectId: string | null) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!response.ok) throw new Error("Failed to update");
      toast.success("Project updated");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      toast.error("Failed to update project");
    }
  };

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <SheetTitle className="text-xl">{task.title || task.content}</SheetTitle>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription>Task details and quick actions</SheetDescription>
          <div className="flex gap-2 mt-2 flex-wrap items-center">
            <Badge variant="secondary">{STATUS_LABELS[task.status]}</Badge>
            <Badge variant="outline">{PRIORITY_LABELS[task.priority]}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors border rounded-md px-2 py-0.5">
                  <FolderOpen className="h-3 w-3" />
                  {task.project_name || "No project"}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={task.project_id ?? "none"}
                  onValueChange={(value) =>
                    handleChangeProject(value === "none" ? null : value)
                  }
                >
                  <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                  {projects?.map((project) => (
                    <DropdownMenuRadioItem key={project.id} value={project.id}>
                      <span className="flex items-center gap-2">
                        {project.color && (
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: project.color }}
                          />
                        )}
                        {project.name}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Description */}
          {task.description && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">{task.description}</p>
            </div>
          )}

          {/* Dates */}
          <div className="space-y-2">
            {task.due_date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Due Date</span>
                <span>{format(parseISO(task.due_date), "MMM d, yyyy")}</span>
              </div>
            )}
            {task.scheduled_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Scheduled</span>
                <span>{format(parseISO(task.scheduled_at), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            )}
            {task.estimated_completion_date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated Completion</span>
                <span>{format(parseISO(task.estimated_completion_date), "MMM d, yyyy")}</span>
              </div>
            )}
            {task.completed_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span>{format(parseISO(task.completed_at), "MMM d, yyyy")}</span>
              </div>
            )}
            {task.recurrence_rule && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>↻</span>
                <span>{rruleToText(task.recurrence_rule) || task.recurrence_rule}</span>
                {task.recurrence_end_date && (
                  <span>· until {task.recurrence_end_date}</span>
                )}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex flex-col gap-2 pt-4 border-t">
            {task.status !== "completed" && onComplete && (
              <Button
                variant="default"
                className="w-full"
                onClick={() => onComplete(task)}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Complete
              </Button>
            )}
            {onReschedule && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onReschedule(task)}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Reschedule
              </Button>
            )}
            {onEdit && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onEdit(task)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => onDelete(task)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
