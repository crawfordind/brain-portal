"use client";

import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import type { Task } from "@/types/task";

interface DraggableTaskProps {
  task: Task;
  onTaskClick: (task: Task) => void;
}

function DraggableTask({ task, onTaskClick }: DraggableTaskProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(isDragging && "opacity-50")}
    >
      <div
        onClick={(e) => {
          // Prevent click during drag
          if (!isDragging) {
            onTaskClick(task);
          }
        }}
        className={cn(
          "p-2 rounded-lg border-l-4 bg-card cursor-grab active:cursor-grabbing hover:shadow-md transition-all select-none touch-none",
          task.priority === "urgent" && "border-l-red-500",
          task.priority === "high" && "border-l-orange-500",
          task.priority === "medium" && "border-l-blue-500",
          task.priority === "low" && "border-l-gray-300"
        )}
      >
        <div className="text-xs lg:text-sm font-medium line-clamp-2">
          {task.title || task.content}
        </div>
        {task.project_name && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {task.project_name}
          </div>
        )}
      </div>
    </div>
  );
}

export { DraggableTask };

interface TimeSlotProps {
  timeSlot: string;
  date: Date;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

export function TimeSlot({ timeSlot, date, tasks, onTaskClick }: TimeSlotProps) {
  const dropId = `slot-${format(date, 'yyyy-MM-dd')}-${timeSlot}`;
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  const timeLabel = format(new Date(`2024-01-01T${timeSlot}`), "h a");

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "grid grid-cols-[60px_1fr] lg:grid-cols-[80px_1fr]",
        "min-h-[40px] lg:min-h-[48px] border-b last:border-b-0",
        isOver && "bg-primary/5 ring-2 ring-primary ring-inset"
      )}
    >
      {/* Time label */}
      <div className="p-2 text-xs lg:text-sm text-muted-foreground border-r flex items-start justify-end">
        {timeLabel}
      </div>

      {/* Task area */}
      <div className="p-1">
        {tasks.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground/40">
            {isOver ? "Drop here" : ""}
          </div>
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => (
              <DraggableTask
                key={task.id}
                task={task}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
