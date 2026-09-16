import { describe, it, expect } from "vitest";
import {
  getWeekDays,
  getTimeSlots,
  isTaskInTimeSlot,
  getWeekRange,
  getUnscheduledTasksForDay,
  getMonthRange,
} from "@/lib/tasks/calendar-utils";
import type { Task } from "@/types/task";

const mockTask: Task = {
  id: "task-1",
  user_id: "user-1",
  note_id: null,
  project_id: null,
  content: "Test task",
  title: "Test task",
  description: null,
  delegated_to: null,
  agent_task_id: null,
  linked_note_ids: "[]",
  status: "pending",
  priority: "medium",
  due_date: null,
  scheduled_at: null,
  estimated_completion_date: null,
  completed_at: null,
  estimation_accuracy: null,
  position: 0,
  tags: "[]",
  metadata: "{}",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  project_name: null,
  note_title: null,
  note_slug: null,
  recurrence_rule: null,
  recurrence_end_date: null,
  parent_task_id: null,
};

describe("getWeekDays", () => {
  it("returns 7 days starting from Monday", () => {
    const startDate = new Date("2024-03-04T00:00:00Z"); // Monday
    const weekDays = getWeekDays(startDate);

    expect(weekDays).toHaveLength(7);
    expect(weekDays[0].getDay()).toBe(1); // Monday
    expect(weekDays[6].getDay()).toBe(0); // Sunday
  });

  it("adjusts to start from Monday if given non-Monday date", () => {
    const wednesday = new Date("2024-03-06T00:00:00Z"); // Wednesday
    const weekDays = getWeekDays(wednesday);

    expect(weekDays).toHaveLength(7);
    expect(weekDays[0].getDay()).toBe(1); // Should start from Monday
  });
});

describe("getTimeSlots", () => {
  it("returns time slots from 6 AM to 10 PM", () => {
    const slots = getTimeSlots();

    expect(slots[0]).toBe("06:00");
    expect(slots[slots.length - 1]).toBe("22:00");
  });

  it("returns hourly slots", () => {
    const slots = getTimeSlots();

    expect(slots).toContain("06:00");
    expect(slots).toContain("12:00");
    expect(slots).toContain("18:00");
    expect(slots).toContain("22:00");
  });

  it("returns 17 time slots", () => {
    const slots = getTimeSlots();
    // 6 AM to 10 PM = 17 hours (6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22)
    expect(slots).toHaveLength(17);
  });
});

describe("isTaskInTimeSlot", () => {
  it("returns true when task is scheduled in the time slot", () => {
    const task = {
      ...mockTask,
      scheduled_at: "2024-03-04T14:00:00Z", // 2 PM UTC
    };
    const day = new Date("2024-03-04T00:00:00Z");

    expect(isTaskInTimeSlot(task, day, "14:00")).toBe(true);
  });

  it("returns false when task is scheduled at different time", () => {
    const task = {
      ...mockTask,
      scheduled_at: "2024-03-04T14:00:00Z", // 2 PM
    };
    const day = new Date("2024-03-04T00:00:00Z");

    expect(isTaskInTimeSlot(task, day, "15:00")).toBe(false);
  });

  it("returns false when task has no scheduled_at", () => {
    const task = { ...mockTask, scheduled_at: null };
    const day = new Date("2024-03-04T00:00:00Z");

    expect(isTaskInTimeSlot(task, day, "14:00")).toBe(false);
  });

  it("returns false when task is on different day", () => {
    const task = {
      ...mockTask,
      scheduled_at: "2024-03-05T14:00:00Z", // Different day
    };
    const day = new Date("2024-03-04T00:00:00Z");

    expect(isTaskInTimeSlot(task, day, "14:00")).toBe(false);
  });
});

describe("getWeekRange", () => {
  it("returns start and end dates for the week", () => {
    const monday = new Date(2024, 2, 4); // March 4, 2024 (local time)
    const range = getWeekRange(monday);

    // Check that the range contains the expected week (dates may vary by timezone)
    const startDate = new Date(range.start);
    const endDate = new Date(range.end);
    expect(startDate.getDay()).toBe(1); // Monday
    expect(endDate.getDay()).toBe(0); // Sunday
    expect(endDate.getTime() - startDate.getTime()).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);
  });

  it("returns ISO formatted dates", () => {
    const monday = new Date("2024-03-04T00:00:00Z");
    const range = getWeekRange(monday);

    // Should be valid ISO strings
    expect(new Date(range.start).toISOString()).toBeDefined();
    expect(new Date(range.end).toISOString()).toBeDefined();
  });
});

describe("getUnscheduledTasksForDay", () => {
  it("returns tasks with due_date on the day but no scheduled_at", () => {
    const tasks: Task[] = [
      {
        ...mockTask,
        id: "task-1",
        due_date: "2024-03-04T00:00:00Z",
        scheduled_at: null,
      },
      {
        ...mockTask,
        id: "task-2",
        due_date: "2024-03-04T00:00:00Z",
        scheduled_at: "2024-03-04T14:00:00Z", // Has scheduled time
      },
      {
        ...mockTask,
        id: "task-3",
        due_date: "2024-03-05T00:00:00Z", // Different day
        scheduled_at: null,
      },
    ];

    const day = new Date("2024-03-04T00:00:00Z");
    const unscheduled = getUnscheduledTasksForDay(tasks, day);

    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0].id).toBe("task-1");
  });

  it("returns empty array when no unscheduled tasks for day", () => {
    const tasks: Task[] = [
      {
        ...mockTask,
        due_date: "2024-03-05T00:00:00Z",
        scheduled_at: null,
      },
    ];

    const day = new Date("2024-03-04T00:00:00Z");
    const unscheduled = getUnscheduledTasksForDay(tasks, day);

    expect(unscheduled).toHaveLength(0);
  });
});

describe("getMonthRange", () => {
  it("returns a range covering the full calendar grid for the month", () => {
    // March 2024 starts on Friday → grid starts Mon 2024-02-26
    const march2024 = new Date("2024-03-15T00:00:00Z");
    const range = getMonthRange(march2024);

    const start = new Date(range.start);
    const end = new Date(range.end);

    // Grid start must be a Monday on or before March 1
    expect(start.getDay()).toBe(1); // Monday
    expect(start.toISOString().startsWith("2024-02-26")).toBe(true);
    // Grid end must be a Sunday on or after March 31
    expect(end.getDay()).toBe(0); // Sunday
    // End must be after start
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("returns valid ISO formatted strings", () => {
    const date = new Date("2024-06-01T00:00:00Z");
    const range = getMonthRange(date);
    expect(new Date(range.start).toISOString()).toBe(range.start);
    expect(new Date(range.end).toISOString()).toBe(range.end);
  });

  it("does not extend backwards when month starts on Monday", () => {
    // April 2024 starts on Monday → grid starts exactly on April 1
    const april2024 = new Date("2024-04-15T00:00:00Z");
    const range = getMonthRange(april2024);

    const start = new Date(range.start);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.toISOString().startsWith("2024-04-01")).toBe(true);
  });
});
