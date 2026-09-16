"use client";

import { format, isSameDay, isToday, startOfWeek } from "date-fns";
import { getWeekDays } from "@/lib/tasks/calendar-utils";
import { DayButton } from "./day-button";
import type { Task } from "@/types/task";

interface WeekStripProps {
  focusedDate: Date;
  onDaySelect: (date: Date) => void;
  tasks: Task[];
}

export function WeekStrip({ focusedDate, onDaySelect, tasks }: WeekStripProps) {
  const weekDays = getWeekDays(startOfWeek(focusedDate, { weekStartsOn: 1 }));

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide">
        {weekDays.map((day) => {
          const dayTasks = tasks.filter((task) => {
            if (task.scheduled_at) {
              const scheduledDate = new Date(task.scheduled_at);
              return isSameDay(scheduledDate, day);
            }
            if (task.due_date) {
              const dueDate = new Date(task.due_date);
              return isSameDay(dueDate, day);
            }
            return false;
          });

          return (
            <DayButton
              key={day.toISOString()}
              day={day}
              isFocused={isSameDay(day, focusedDate)}
              isToday={isToday(day)}
              tasks={dayTasks}
              onClick={() => onDaySelect(day)}
            />
          );
        })}
      </div>
    </div>
  );
}
