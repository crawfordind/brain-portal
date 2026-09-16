"use client";

import { format, parseISO, isPast, differenceInDays } from "date-fns";
import { Calendar, Clock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";
import { rruleToText } from "@/lib/tasks/recurrence";

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
  variant?: "list" | "calendar" | "kanban";
  className?: string;
}

const PRIORITY_BORDER_COLORS: Record<string, string> = {
  low: "border-l-gray-300",
  medium: "border-l-blue-500",
  high: "border-l-orange-500",
  urgent: "border-l-red-500",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 dark:bg-gray-800",
  in_progress: "bg-blue-50 dark:bg-blue-950",
  completed: "bg-green-50 dark:bg-green-950",
  cancelled: "bg-gray-50 dark:bg-gray-900",
};

export function TaskCard({ task, onClick, variant = "list", className }: TaskCardProps) {
  const isOverdue = task.due_date && !task.completed_at && isPast(parseISO(task.due_date));
  const daysUntilDue = task.due_date && task.scheduled_at
    ? differenceInDays(parseISO(task.due_date), parseISO(task.scheduled_at))
    : null;

  const handleClick = () => {
    if (onClick) onClick(task);
  };

  return (
    <article
      role="article"
      onClick={handleClick}
      tabIndex={0}
      className={cn(
        "border-l-4 rounded-lg p-3 cursor-pointer transition-all hover:shadow-md",
        PRIORITY_BORDER_COLORS[task.priority],
        STATUS_COLORS[task.status],
        isOverdue && "ring-2 ring-red-500",
        task.status === "completed" && "opacity-60",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Title */}
      <h3 className="font-semibold text-sm mb-2">{task.title || task.content}</h3>

      {/* Project Badge */}
      {task.project_name && (
        <Badge variant="secondary" className="mb-2">
          {task.project_name}
        </Badge>
      )}

      {/* Date Badges */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {/* Due Date */}
        {task.due_date && (
          <div className={cn("flex items-center gap-1", isOverdue && "text-red-600")}>
            <Calendar className="h-3 w-3" />
            <span>{format(parseISO(task.due_date), "MMM d")}</span>
            {isOverdue && <AlertCircle className="h-3 w-3" />}
          </div>
        )}

        {/* Scheduled Time */}
        {task.scheduled_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{format(parseISO(task.scheduled_at), "h:mm a")}</span>
          </div>
        )}

        {/* Days Until Due */}
        {daysUntilDue !== null && daysUntilDue > 0 && (
          <Badge variant="outline" className="text-xs">
            {daysUntilDue}d until due
          </Badge>
        )}

        {/* Estimated Completion */}
        {task.estimated_completion_date && (
          <div className="flex items-center gap-1 text-blue-600">
            <Clock className="h-3 w-3" />
            <span>Est: {format(parseISO(task.estimated_completion_date), "MMM d")}</span>
          </div>
        )}

        {/* Recurring indicator */}
        {task.recurrence_rule && (
          <span title={rruleToText(task.recurrence_rule) || 'Recurring'} className="text-muted-foreground">
            ↻
          </span>
        )}
      </div>
    </article>
  );
}
