"use client";

import { format, parseISO, isToday, isYesterday, isPast, formatDistanceToNowStrict } from "date-fns";
import { Circle, CheckCircle2, Trash2, Bot, FolderOpen, Clock, Sparkles, Check, RotateCcw, Sunrise } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SwipeableRow, type SwipeAction } from "@/components/ui/swipeable-row";
import { useTouchFirst } from "@/hooks/use-touch-first";
import type { Task } from "@/types/task";

const PRIORITY_BORDER: Record<string, string> = {
  low: "border-l-gray-300 dark:border-l-gray-600",
  medium: "border-l-blue-500",
  high: "border-l-orange-500",
  urgent: "border-l-red-500",
};

const PRIORITY_LABEL: Record<string, { text: string; color: string }> = {
  urgent: { text: "URG", color: "text-red-600 dark:text-red-400" },
  high: { text: "HI", color: "text-orange-600 dark:text-orange-400" },
};

interface WorkTaskRowProps {
  task: Task;
  onToggleStatus: (id: string, status: string) => void;
  onClick: (task: Task) => void;
  onAskAbout?: (task: Task) => void;
  onDelete?: (id: string) => void;
  /** Move the due date to tomorrow (the left swipe). */
  onSnooze?: (id: string) => void;
  onReview?: (agentTaskId: string) => void;
  selectionMode?: boolean;
  /** Let this row play the one-time "you can swipe" nudge. */
  swipeHint?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

function formatRelativeDate(dateStr: string, completed?: boolean): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (!completed && isPast(date)) {
    return formatDistanceToNowStrict(date, { addSuffix: false }) + " ago";
  }
  return format(date, "MMM d");
}

export function WorkTaskRow({
  task,
  onToggleStatus,
  onClick,
  onAskAbout,
  onDelete,
  onSnooze,
  onReview,
  selectionMode,
  isSelected,
  onToggleSelect,
  swipeHint,
}: WorkTaskRowProps) {
  const confirm = useConfirm();
  const touchFirst = useTouchFirst();
  const isCompleted = task.status === "completed";
  const isOverdue = task.due_date && !isCompleted && isPast(parseISO(task.due_date)) && !isToday(parseISO(task.due_date));
  const title = task.title || task.content;
  const priorityLabel = PRIORITY_LABEL[task.priority];

  const askDelete = () =>
    confirm({ title: "Delete task?", description: "This cannot be undone.", destructive: true, confirmLabel: "Delete" }).then(
      (ok) => {
        if (ok) onDelete?.(task.id);
      }
    );

  // Swipe right: done (or reopen). Swipe left: tomorrow, then delete.
  const leading: SwipeAction[] = [
    isCompleted
      ? { id: "reopen", label: "Reopen", icon: RotateCcw, tone: "neutral", onAction: () => onToggleStatus(task.id, "pending") }
      : { id: "done", label: "Done", icon: Check, tone: "done", onAction: () => onToggleStatus(task.id, "completed") },
  ];
  const trailing: SwipeAction[] = [];
  if (!isCompleted && onSnooze) {
    trailing.push({ id: "tomorrow", label: "Tomorrow", icon: Sunrise, tone: "later", onAction: () => onSnooze(task.id) });
  }
  if (!isCompleted && onAskAbout) {
    trailing.push({ id: "ask", label: "Ask", icon: Sparkles, tone: "ask", onAction: () => onAskAbout(task) });
  }
  if (onDelete) trailing.push({ id: "delete", label: "Delete", icon: Trash2, tone: "danger", onAction: askDelete });

  return (
    <SwipeableRow
      leading={leading}
      trailing={trailing}
      disabled={selectionMode}
      hint={swipeHint}
      className="rounded-r-lg"
      contentClassName="bg-card"
    >
    <div
      className={cn(
        "flex items-center gap-2 border-l-[3px] rounded-r-lg hover:bg-muted/40 transition-colors group min-h-11 sm:min-h-10 cursor-pointer",
        PRIORITY_BORDER[task.priority],
        isCompleted && "opacity-45"
      )}
      onClick={() => onClick(task)}
    >
      {/* Selection checkbox */}
      {selectionMode && (
        <div className="pl-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4"
          />
        </div>
      )}

      {/* Completion circle */}
      <button
        type="button"
        aria-label={isCompleted ? `Reopen: ${title}` : `Complete: ${title}`}
        className={cn(
          "shrink-0 flex items-center justify-center rounded-full hover:bg-muted transition-colors h-11 w-11 -my-1 sm:h-7 sm:w-7 sm:my-0 sm:ml-1",
          selectionMode && "ml-0"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggleStatus(task.id, isCompleted ? "pending" : "completed");
        }}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5 sm:h-4 sm:w-4 text-green-500" />
        ) : (
          <Circle className="h-5 w-5 sm:h-4 sm:w-4 text-muted-foreground/40 hover:text-muted-foreground" />
        )}
      </button>

      {/* Content — title + inline metadata */}
      <div className="flex-1 min-w-0 py-1.5 pr-1 flex items-center gap-2">
        <p
          className={cn(
            "text-base sm:text-sm leading-tight truncate",
            isCompleted && "line-through text-muted-foreground"
          )}
        >
          {title}
        </p>

        {/* Inline metadata chips */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {priorityLabel && (
            <span className={cn("text-[9px] font-bold tracking-wider", priorityLabel.color)}>
              {priorityLabel.text}
            </span>
          )}
          {task.project_name && (
            <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70 max-w-[100px] truncate">
              <FolderOpen className="h-2.5 w-2.5 shrink-0" />
              {task.project_name}
            </span>
          )}
          {task.due_date && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-[11px] tabular-nums",
                isOverdue ? "text-red-500 font-medium" : "text-muted-foreground/70"
              )}
            >
              <Clock className="h-2.5 w-2.5 shrink-0" />
              {formatRelativeDate(task.due_date, isCompleted)}
            </span>
          )}
          {task.delegated_to && (
            <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 text-[9px] h-3.5 px-1 py-0 leading-none">
              <Bot className="h-2 w-2 mr-0.5" />
              {task.delegated_to}
            </Badge>
          )}
          {task.recurrence_rule && (
            <span className="text-muted-foreground/50 text-[11px]" title="Recurring">↻</span>
          )}
        </div>

        {/* Mobile-only: minimal metadata below title */}
        <div className="flex sm:hidden items-center gap-1 shrink-0">
          {task.due_date && (
            <span
              className={cn(
                "text-xs tabular-nums",
                isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"
              )}
            >
              {formatRelativeDate(task.due_date, isCompleted)}
            </span>
          )}
          {task.delegated_to && (
            <Bot className="h-2.5 w-2.5 text-purple-500" />
          )}
        </div>
      </div>

      {/* AI Review button */}
      {task.delegated_to && task.agent_task_id && task.status === "in_progress" && onReview && (
        <Button
          variant="default"
          size="sm"
          className="h-6 text-[10px] shrink-0 bg-purple-600 hover:bg-purple-700 px-2 mr-1"
          onClick={(e) => {
            e.stopPropagation();
            onReview(task.agent_task_id!);
          }}
        >
          Review
        </Button>
      )}

      {/* Mouse-only actions. On a touch screen the row's swipe does this. */}
      {!touchFirst && (
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0 pr-1.5">
        {!isCompleted && onAskAbout && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onAskAbout(task);
            }}
            title="Ask about this"
          >
            <Sparkles className="h-3 w-3" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              askDelete();
            }}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      )}
    </div>
    </SwipeableRow>
  );
}
