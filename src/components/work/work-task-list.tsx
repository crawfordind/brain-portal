"use client";

import { useMemo } from "react";
import { parseISO, isToday, isPast, isYesterday, isThisWeek, startOfDay } from "date-fns";
import { CheckSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkTaskRow } from "./work-task-row";
import type { Task } from "@/types/task";
import type { SummaryFilter } from "@/hooks/use-work-state";

interface DateGroup {
  key: string;
  label: string;
  tasks: Task[];
  accent?: string;
}

interface WorkTaskListProps {
  tasks: Task[];
  statusFilter: "open" | "completed" | "all";
  summaryFilter: SummaryFilter;
  onToggleStatus: (id: string, status: string) => void;
  onTaskClick: (task: Task) => void;
  onAskAbout: (task: Task) => void;
  onDelete: (id: string) => void;
  onReview: (agentTaskId: string) => void;
  onCreateTask: () => void;
  selectionMode: boolean;
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
}

function groupOpenTasks(tasks: Task[]): DateGroup[] {
  const overdue: Task[] = [];
  const today: Task[] = [];
  const thisWeek: Task[] = [];
  const later: Task[] = [];
  const noDate: Task[] = [];

  for (const task of tasks) {
    if (!task.due_date) {
      noDate.push(task);
      continue;
    }
    const date = parseISO(task.due_date);
    const dateStart = startOfDay(date);
    if (isToday(dateStart)) {
      today.push(task);
    } else if (isPast(dateStart)) {
      overdue.push(task);
    } else if (isThisWeek(dateStart, { weekStartsOn: 1 })) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  const groups: DateGroup[] = [];
  if (overdue.length > 0) groups.push({ key: "overdue", label: "OVERDUE", tasks: overdue, accent: "text-red-500" });
  if (today.length > 0) groups.push({ key: "today", label: "TODAY", tasks: today, accent: "text-amber-600 dark:text-amber-400" });
  if (thisWeek.length > 0) groups.push({ key: "this-week", label: "THIS WEEK", tasks: thisWeek });
  if (later.length > 0) groups.push({ key: "later", label: "LATER", tasks: later });
  if (noDate.length > 0) groups.push({ key: "no-date", label: "NO DATE", tasks: noDate });
  return groups;
}

function groupCompletedTasks(tasks: Task[]): DateGroup[] {
  const today: Task[] = [];
  const yesterday: Task[] = [];
  const thisWeek: Task[] = [];
  const earlier: Task[] = [];

  for (const task of tasks) {
    const dateStr = task.completed_at || task.updated_at;
    const date = parseISO(dateStr);
    if (isToday(date)) {
      today.push(task);
    } else if (isYesterday(date)) {
      yesterday.push(task);
    } else if (isThisWeek(date, { weekStartsOn: 1 })) {
      thisWeek.push(task);
    } else {
      earlier.push(task);
    }
  }

  const groups: DateGroup[] = [];
  if (today.length > 0) groups.push({ key: "today", label: "TODAY", tasks: today });
  if (yesterday.length > 0) groups.push({ key: "yesterday", label: "YESTERDAY", tasks: yesterday });
  if (thisWeek.length > 0) groups.push({ key: "this-week", label: "THIS WEEK", tasks: thisWeek });
  if (earlier.length > 0) groups.push({ key: "earlier", label: "EARLIER", tasks: earlier });
  return groups;
}

function applySummaryFilter(tasks: Task[], filter: SummaryFilter): Task[] {
  if (!filter) return tasks;
  switch (filter) {
    case "overdue":
      return tasks.filter(t => t.due_date && isPast(parseISO(t.due_date)) && !isToday(parseISO(t.due_date)) && t.status !== "completed");
    case "due_today":
      return tasks.filter(t => t.due_date && isToday(parseISO(t.due_date)) && t.status !== "completed");
    case "in_progress":
      return tasks.filter(t => t.status === "in_progress");
    default:
      return tasks;
  }
}

export function WorkTaskList({
  tasks,
  statusFilter,
  summaryFilter,
  onToggleStatus,
  onTaskClick,
  onAskAbout,
  onDelete,
  onReview,
  onCreateTask,
  selectionMode,
  isSelected,
  onToggleSelect,
}: WorkTaskListProps) {
  const filteredTasks = useMemo(
    () => applySummaryFilter(tasks, summaryFilter),
    [tasks, summaryFilter]
  );

  const groups = useMemo(() => {
    const openTasks = filteredTasks.filter(t => t.status !== "completed" && t.status !== "cancelled");
    const completedTasks = filteredTasks.filter(t => t.status === "completed");

    if (statusFilter === "completed") return groupCompletedTasks(completedTasks);
    if (statusFilter === "all") {
      return [
        ...groupOpenTasks(openTasks),
        ...(completedTasks.length > 0
          ? [{ key: "completed", label: "COMPLETED", tasks: completedTasks, accent: "text-green-500" }]
          : []),
      ];
    }
    return groupOpenTasks(openTasks);
  }, [filteredTasks, statusFilter]);

  if (filteredTasks.length === 0) {
    const message = summaryFilter
      ? `No ${summaryFilter.replace("_", " ")} tasks`
      : statusFilter === "completed"
        ? "No completed tasks yet"
        : "No open tasks";

    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h3 className="text-base font-medium mb-1">{message}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {statusFilter === "completed"
            ? "Complete tasks to see them here"
            : "Create a task to get started"}
        </p>
        {statusFilter !== "completed" && !summaryFilter && (
          <Button size="sm" onClick={onCreateTask}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Task
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.key}>
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`text-[10px] font-semibold tracking-widest uppercase ${group.accent || "text-muted-foreground/70"}`}>
              {group.label}
            </h3>
            <span className="text-[10px] text-muted-foreground/50 tabular-nums">{group.tasks.length}</span>
            <div className="flex-1 border-b border-border/30" />
          </div>
          <div className="space-y-px">
            {group.tasks.map((task) => (
              <WorkTaskRow
                key={task.id}
                task={task}
                onToggleStatus={onToggleStatus}
                onClick={onTaskClick}
                onAskAbout={onAskAbout}
                onDelete={onDelete}
                onReview={onReview}
                selectionMode={selectionMode}
                isSelected={isSelected(task.id)}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
