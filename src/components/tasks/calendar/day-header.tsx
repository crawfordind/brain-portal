"use client";

import { format } from "date-fns";
import type { Task } from "@/types/task";

interface DayHeaderProps {
  date: Date;
  tasks: Task[];
}

export function DayHeader({ date, tasks }: DayHeaderProps) {
  const scheduledCount = tasks.filter(t => t.scheduled_at).length;
  const totalCount = tasks.length;

  return (
    <div className="border-b bg-muted/30 p-3 lg:p-4">
      <h2 className="text-lg lg:text-xl font-bold">
        {format(date, "EEEE, MMMM d")}
      </h2>
      <p className="text-xs lg:text-sm text-muted-foreground">
        {totalCount} {totalCount === 1 ? "task" : "tasks"} • {scheduledCount} scheduled
      </p>
    </div>
  );
}
