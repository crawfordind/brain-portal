"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

interface DayButtonProps {
  day: Date;
  isFocused: boolean;
  isToday: boolean;
  tasks: Task[];
  onClick: () => void;
}

export function DayButton({ day, isFocused, isToday, tasks, onClick }: DayButtonProps) {
  const taskCount = tasks.length;

  // Count priority tasks (max 3 dots)
  const priorityCounts = {
    urgent: tasks.filter(t => t.priority === 'urgent').length,
    high: tasks.filter(t => t.priority === 'high').length,
    medium: tasks.filter(t => t.priority === 'medium').length,
  };

  const renderPriorityDots = () => {
    const dots: React.ReactNode[] = [];
    let dotCount = 0;

    if (priorityCounts.urgent > 0 && dotCount < 3) {
      dots.push(<div key="urgent" className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-red-500" />);
      dotCount++;
    }
    if (priorityCounts.high > 0 && dotCount < 3) {
      dots.push(<div key="high" className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-orange-500" />);
      dotCount++;
    }
    if (priorityCounts.medium > 0 && dotCount < 3) {
      dots.push(<div key="medium" className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-blue-500" />);
      dotCount++;
    }

    const remaining = taskCount - dotCount;
    if (remaining > 0 && dotCount === 3) {
      dots.push(<span key="more" className="text-[8px] lg:text-[10px] text-muted-foreground">+{remaining}</span>);
    }

    return dots;
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center p-2 lg:p-3 min-w-[50px] lg:min-w-[80px] snap-center",
        "rounded-lg transition-all",
        isToday && "bg-primary/10 ring-2 ring-primary",
        isFocused && !isToday && "bg-accent",
        "hover:bg-muted cursor-pointer"
      )}
    >
      <div className="text-[10px] lg:text-xs text-muted-foreground">
        {format(day, "EEE")}
      </div>
      <div className="text-base lg:text-lg font-semibold">
        {format(day, "d")}
      </div>
      <div className="text-xs lg:text-sm font-semibold text-muted-foreground mt-0.5">
        {taskCount}
      </div>
      <div className="flex gap-0.5 mt-1 h-2 lg:h-2.5 items-center">
        {taskCount > 0 ? renderPriorityDots() : (
          <span className="text-muted-foreground text-[10px]">-</span>
        )}
      </div>
    </button>
  );
}
