import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  parseISO,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import type { Task } from "@/types/task";

/**
 * Get an array of 7 dates representing a week starting from Monday
 */
export function getWeekDays(startDate: Date): Date[] {
  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 }); // 1 = Monday
  const weekEnd = endOfWeek(startDate, { weekStartsOn: 1 });

  return eachDayOfInterval({ start: weekStart, end: weekEnd });
}

/**
 * Get time slots from 6 AM to 10 PM
 */
export function getTimeSlots(): string[] {
  const slots: string[] = [];

  for (let hour = 6; hour <= 22; hour++) {
    slots.push(format(new Date(2024, 0, 1, hour, 0), "HH:mm"));
  }

  return slots;
}

/**
 * Check if a task is scheduled in a specific time slot on a specific day
 */
export function isTaskInTimeSlot(task: Task, day: Date, slotTime: string): boolean {
  if (!task.scheduled_at) return false;

  const taskDate = parseISO(task.scheduled_at);

  // Check if same day (UTC comparison)
  const taskUTCDate = taskDate.getUTCDate();
  const taskUTCMonth = taskDate.getUTCMonth();
  const taskUTCYear = taskDate.getUTCFullYear();

  const dayUTCDate = day.getUTCDate();
  const dayUTCMonth = day.getUTCMonth();
  const dayUTCYear = day.getUTCFullYear();

  if (
    taskUTCDate !== dayUTCDate ||
    taskUTCMonth !== dayUTCMonth ||
    taskUTCYear !== dayUTCYear
  ) {
    return false;
  }

  // Extract hour and minute from task date in UTC (since scheduled_at is stored in UTC)
  const taskHours = taskDate.getUTCHours();
  const taskMinutes = taskDate.getUTCMinutes();
  const taskTime = `${String(taskHours).padStart(2, "0")}:${String(taskMinutes).padStart(2, "0")}`;

  return taskTime === slotTime;
}

/**
 * Get the date range for a week (for API queries)
 */
export function getWeekRange(startDate: Date): { start: string; end: string } {
  const weekStart = startOfWeek(startDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(startDate, { weekStartsOn: 1 });

  return {
    start: startOfDay(weekStart).toISOString(),
    end: endOfDay(weekEnd).toISOString(),
  };
}

/**
 * Get the date range for a calendar month grid view.
 * Extends to full weeks (Mon–Sun) so the grid has no gaps.
 */
export function getMonthRange(date: Date): { start: string; end: string } {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return {
    start: startOfDay(calendarStart).toISOString(),
    end: endOfDay(calendarEnd).toISOString(),
  };
}

/**
 * Get tasks that have a due date on the given day but no scheduled_at
 */
export function getUnscheduledTasksForDay(tasks: Task[], day: Date): Task[] {
  return tasks.filter((task) => {
    // Must have due_date but no scheduled_at
    if (!task.due_date || task.scheduled_at) return false;

    const dueDate = parseISO(task.due_date);

    // Compare dates in UTC
    const dueUTCDate = dueDate.getUTCDate();
    const dueUTCMonth = dueDate.getUTCMonth();
    const dueUTCYear = dueDate.getUTCFullYear();

    const dayUTCDate = day.getUTCDate();
    const dayUTCMonth = day.getUTCMonth();
    const dayUTCYear = day.getUTCFullYear();

    return (
      dueUTCDate === dayUTCDate &&
      dueUTCMonth === dayUTCMonth &&
      dueUTCYear === dayUTCYear
    );
  });
}
