"use client";

import { isSameDay, addDays, subDays } from "date-fns";
import { DayHeader } from "./day-header";
import { TimeSlot } from "./time-slot";
import { getTimeSlots, isTaskInTimeSlot } from "@/lib/tasks/calendar-utils";
import { useSwipe } from "@/hooks/use-swipe";
import type { Task } from "@/types/task";

interface DayViewProps {
  date: Date;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onDateChange?: (date: Date) => void;
}

export function DayView({ date, tasks, onTaskClick, onDateChange }: DayViewProps) {
  // Filter tasks for this day
  const dayTasks = tasks.filter((task) => {
    if (task.scheduled_at) {
      const scheduledDate = new Date(task.scheduled_at);
      return isSameDay(scheduledDate, date);
    }
    if (task.due_date) {
      const dueDate = new Date(task.due_date);
      return isSameDay(dueDate, date);
    }
    return false;
  });

  // Separate scheduled vs unscheduled
  const scheduledTasks = dayTasks.filter(t => t.scheduled_at);
  const unscheduledToday = dayTasks.filter(t => !t.scheduled_at && t.due_date);

  const swipeHandlers = useSwipe({
    onSwipeLeft: () => onDateChange?.(addDays(date, 1)),
    onSwipeRight: () => onDateChange?.(subDays(date, 1)),
  });

  return (
    <div
      className="flex-1 overflow-y-auto"
      {...swipeHandlers}
    >
      <DayHeader date={date} tasks={dayTasks} />

      {/* Unscheduled section - moved to top */}
      {unscheduledToday.length > 0 && (
        <div className="border-b bg-muted/20 p-3 lg:p-4">
          <h3 className="text-sm font-semibold mb-2">Due Today (Not Scheduled)</h3>
          <div className="space-y-2">
            {unscheduledToday.map(task => (
              <div
                key={task.id}
                onClick={() => onTaskClick(task)}
                className="p-2 rounded-lg border-l-4 border-l-blue-500 bg-card cursor-pointer hover:shadow-md transition-all"
              >
                <div className="text-xs lg:text-sm font-medium line-clamp-2">
                  {task.title || task.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state message */}
      {dayTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-center border-b">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-xs text-muted-foreground px-4">
            Free day - drag tasks from backlog to schedule
          </p>
        </div>
      )}

      {/* Always show time slots for dropping */}
      <div className="divide-y">
        {getTimeSlots().map((timeSlot) => {
          const slotTasks = scheduledTasks.filter(task =>
            isTaskInTimeSlot(task, date, timeSlot)
          );

          return (
            <TimeSlot
              key={timeSlot}
              timeSlot={timeSlot}
              date={date}
              tasks={slotTasks}
              onTaskClick={onTaskClick}
            />
          );
        })}
      </div>
    </div>
  );
}
