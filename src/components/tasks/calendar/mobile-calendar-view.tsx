"use client";

import { format, isSameDay, addDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { WeekStrip } from "./week-strip";
import { DayHeader } from "./day-header";
import { useSwipe } from "@/hooks/use-swipe";
import type { Task } from "@/types/task";

interface MobileCalendarViewProps {
  focusedDate: Date;
  onDaySelect: (date: Date) => void;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

const PRIORITY_BORDER: Record<string, string> = {
  low: "border-l-gray-300",
  medium: "border-l-blue-500",
  high: "border-l-orange-500",
  urgent: "border-l-red-500",
};

export function MobileCalendarView({
  focusedDate,
  onDaySelect,
  tasks,
  onTaskClick,
}: MobileCalendarViewProps) {
  const swipeHandlers = useSwipe({
    onSwipeLeft: () => onDaySelect(addDays(focusedDate, 1)),
    onSwipeRight: () => onDaySelect(subDays(focusedDate, 1)),
  });

  // Tasks for the focused day
  const dayTasks = tasks.filter((task) => {
    if (task.scheduled_at) {
      return isSameDay(new Date(task.scheduled_at), focusedDate);
    }
    if (task.due_date) {
      return isSameDay(new Date(task.due_date), focusedDate);
    }
    return false;
  });

  // Split into scheduled (with time) and due-only (no time)
  const scheduled = dayTasks
    .filter((t) => t.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  const dueOnly = dayTasks.filter((t) => !t.scheduled_at && t.due_date);

  return (
    <div className="flex flex-col h-full">
      {/* Week strip */}
      <WeekStrip
        focusedDate={focusedDate}
        onDaySelect={onDaySelect}
        tasks={tasks}
      />

      {/* Day header */}
      <DayHeader date={focusedDate} tasks={dayTasks} />

      {/* Agenda list */}
      <div
        className="flex-1 overflow-y-auto"
        {...swipeHandlers}
      >
        {dayTasks.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No tasks for this day
          </div>
        ) : (
          <div className="divide-y">
            {/* Scheduled tasks */}
            {scheduled.map((task) => (
              <button
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-muted/50 transition-colors"
              >
                <span className="text-xs text-muted-foreground w-16 shrink-0 tabular-nums">
                  {format(new Date(task.scheduled_at!), "h:mm a")}
                </span>
                <div
                  className={cn(
                    "flex-1 border-l-4 pl-3 min-w-0",
                    PRIORITY_BORDER[task.priority] || PRIORITY_BORDER.medium
                  )}
                >
                  <div className="text-sm font-medium truncate">
                    {task.title || task.content}
                  </div>
                  {task.project_name && (
                    <div className="text-xs text-muted-foreground truncate">
                      {task.project_name}
                    </div>
                  )}
                </div>
              </button>
            ))}

            {/* Due today (no time) */}
            {dueOnly.length > 0 && (
              <>
                {scheduled.length > 0 && (
                  <div className="px-4 py-2 bg-muted/30">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Due Today
                    </span>
                  </div>
                )}
                {dueOnly.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-muted/50 transition-colors"
                  >
                    <span className="w-16 shrink-0" />
                    <div
                      className={cn(
                        "flex-1 border-l-4 pl-3 min-w-0",
                        PRIORITY_BORDER[task.priority] || PRIORITY_BORDER.medium
                      )}
                    >
                      <div className="text-sm font-medium truncate">
                        {task.title || task.content}
                      </div>
                      {task.project_name && (
                        <div className="text-xs text-muted-foreground truncate">
                          {task.project_name}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
