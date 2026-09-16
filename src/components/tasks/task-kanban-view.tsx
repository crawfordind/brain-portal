"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, useDroppable, useDraggable } from "@dnd-kit/core";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { useTaskDrag } from "@/hooks/use-task-drag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { useAskAbout } from "@/hooks/use-ask-about";

interface TaskKanbanViewProps {
  projectFilter?: string;
}

const COLUMNS = [
  { id: "pending", label: "To Do", bgColor: "bg-gray-50 dark:bg-gray-900" },
  { id: "in_progress", label: "In Progress", bgColor: "bg-blue-50 dark:bg-blue-950" },
  { id: "completed", label: "Completed", bgColor: "bg-green-50 dark:bg-green-950" },
] as const;

interface DraggableTaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  onLongPress?: (task: Task) => void;
  inMoveMode?: boolean;
  currentColumn: string;
}

function DraggableTaskCard({ task, onClick, onLongPress, inMoveMode, currentColumn }: DraggableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartPos.current = { x: touch.clientX, y: touch.clientY };

    // Start long-press timer (300ms)
    const timer = setTimeout(() => {
      // Trigger haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      onLongPress?.(task);
    }, 300);
    setLongPressTimer(timer);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current || !longPressTimer) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPos.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartPos.current.y);

    // Cancel long-press if finger moves too much (>10px)
    if (deltaX > 10 || deltaY > 10) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    touchStartPos.current = null;
  };

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
      className={cn(
        "select-none", // Prevent text selection
        isDragging && "opacity-50"
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <TaskCard
        task={task}
        onClick={onClick}
        variant="kanban"
        className="cursor-grab active:cursor-grabbing transition-all select-none"
      />
    </div>
  );
}

interface KanbanColumnProps {
  id: string;
  label: string;
  bgColor: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onTaskLongPress?: (task: Task) => void;
  taskInMoveMode?: Task | null;
}

function KanbanColumn({ id, label, bgColor, tasks, onTaskClick, onTaskLongPress, taskInMoveMode }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg p-3 md:p-4 min-h-[500px] snap-center",
        "w-full md:w-auto flex-shrink-0",
        bgColor,
        isOver && "ring-2 ring-primary",
        id === "completed" && "opacity-75"
      )}
    >
      <div className="flex items-center justify-between mb-3 md:mb-4 sticky top-0 bg-inherit z-10 pb-2">
        <h3 className="font-semibold text-base md:text-sm">{label}</h3>
        <Badge variant="secondary" className="text-xs min-w-[28px] h-6 flex items-center justify-center">
          {tasks.length}
        </Badge>
      </div>

      <div className="space-y-3 md:space-y-2 flex-1">
        {tasks.map((task) => (
          <DraggableTaskCard
            key={task.id}
            task={task}
            onClick={onTaskClick}
            onLongPress={onTaskLongPress}
            inMoveMode={taskInMoveMode?.id === task.id}
            currentColumn={id}
          />
        ))}

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="h-6 w-6 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskKanbanView({ projectFilter = "all" }: TaskKanbanViewProps) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { askAbout } = useAskAbout();
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [taskToMove, setTaskToMove] = useState<Task | null>(null);
  const [currentColumnIndex, setCurrentColumnIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch tasks
  const { data: tasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["tasks", "kanban", projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        includeCompleted: "true",
      });

      if (projectFilter && projectFilter !== "all") {
        params.set("projectId", projectFilter);
      }

      const response = await fetch(`/api/tasks?${params}`);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      const data = await response.json();
      return data.tasks || [];
    },
  });

  // Update task status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const updates: any = { status };

      // Auto-fill completed_at when moving to Completed
      if (status === "completed") {
        updates.completed_at = new Date().toISOString();
      }

      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "kanban"] });
    },
  });

  const handleDrop = (taskId: string, newStatus: string) => {
    updateStatusMutation.mutate({ taskId, status: newStatus });
  };

  const { sensors, handleDragEnd } = useTaskDrag(handleDrop);

  // Handle task long-press - show move sheet
  const handleTaskLongPress = (task: Task) => {
    setTaskToMove(task);
  };

  // Move task to a specific column
  const moveTaskToColumn = (newStatus: string) => {
    if (!taskToMove) return;

    handleDrop(taskToMove.id, newStatus);
    setTaskToMove(null);
    toast.success("Task moved!");
  };

  // Scroll to specific column in carousel
  const scrollToColumn = (index: number) => {
    if (!carouselRef.current) return;
    const columnWidth = carouselRef.current.scrollWidth / COLUMNS.length;
    carouselRef.current.scrollTo({
      left: columnWidth * index,
      behavior: "smooth",
    });
    setCurrentColumnIndex(index);
  };

  // Handle carousel scroll (update current column index)
  useEffect(() => {
    if (!carouselRef.current) return;

    const handleScroll = () => {
      if (!carouselRef.current) return;
      const scrollLeft = carouselRef.current.scrollLeft;
      const columnWidth = carouselRef.current.scrollWidth / COLUMNS.length;
      const index = Math.round(scrollLeft / columnWidth);
      setCurrentColumnIndex(index);
    };

    const carousel = carouselRef.current;
    carousel.addEventListener("scroll", handleScroll);
    return () => carousel.removeEventListener("scroll", handleScroll);
  }, []);

  // Group tasks by status
  const tasksByStatus = {
    pending: tasks.filter((t: Task) => t.status === "pending"),
    in_progress: tasks.filter((t: Task) => t.status === "in_progress"),
    completed: tasks.filter((t: Task) => t.status === "completed"),
  };

  const handleDragStart = (event: any) => {
    const task = tasks.find((t: Task) => t.id === event.active.id);
    setActiveTask(task || null);
  };

  const handleDragEndWithCleanup = (event: any) => {
    handleDragEnd(event);
    setActiveTask(null);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEndWithCleanup}
    >
      <div className="space-y-4">
        {isLoading ? (
          <div className="grid md:grid-cols-3 gap-4">
            {COLUMNS.map((col) => (
              <div key={col.id} className={cn("rounded-lg p-3 md:p-4 min-h-[300px]", col.bgColor)}>
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <div className="h-5 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-6 w-7 rounded bg-muted animate-pulse" />
                </div>
                <div className="space-y-3 md:space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-[72px] rounded-lg bg-background/60 animate-pulse" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 mb-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <h3 className="text-sm font-medium mb-1">Couldn&apos;t load tasks</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Something went wrong. Check your connection and try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile: Column Indicators */}
            <div className="flex md:hidden items-center justify-center gap-2 mb-4">
              {COLUMNS.map((column, index) => (
                <button
                  key={column.id}
                  onClick={() => scrollToColumn(index)}
                  className={cn(
                    "transition-all text-xs px-3 py-1.5 rounded-full",
                    currentColumnIndex === index
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {column.label} {tasksByStatus[column.id as keyof typeof tasksByStatus].length}
                </button>
              ))}
            </div>

            {/* Kanban Columns */}
            <div
              ref={carouselRef}
              className={cn(
                "flex gap-4",
                // Mobile: horizontal scroll with snap
                "md:grid md:grid-cols-3",
                "overflow-x-auto md:overflow-x-visible",
                "snap-x snap-mandatory md:snap-none",
                "scrollbar-hide",
                "-mx-4 px-4 md:mx-0 md:px-0"
              )}
            >
              {COLUMNS.map((column) => (
                <KanbanColumn
                  key={column.id}
                  id={column.id}
                  label={column.label}
                  bgColor={column.bgColor}
                  tasks={tasksByStatus[column.id as keyof typeof tasksByStatus]}
                  onTaskClick={setSelectedTask}
                  onTaskLongPress={handleTaskLongPress}
                  taskInMoveMode={null}
                />
              ))}
            </div>
          </>
        )}

        {/* Task Detail Dialog */}
        {selectedTask && (
          <TaskDetailDialog
            task={selectedTask}
            open={!!selectedTask}
            onClose={() => setSelectedTask(null)}
            onEdit={() => {
              console.log("Edit task:", selectedTask);
            }}
            onAskAbout={() =>
              askAbout({
                id: selectedTask.id,
                type: "task",
                title: selectedTask.title || selectedTask.content,
                content: selectedTask.description || selectedTask.content,
              })
            }
          />
        )}
      </div>

      {/* Bottom Sheet for Moving Task */}
      <Sheet open={!!taskToMove} onOpenChange={(open) => !open && setTaskToMove(null)}>
        <SheetContent side="bottom" className="px-4 pb-8">
          <SheetHeader>
            <SheetTitle>Move Task</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-2">
            {COLUMNS.map((column) => (
              <Button
                key={column.id}
                variant={taskToMove?.status === column.id ? "secondary" : "outline"}
                className="w-full h-14 text-base justify-start"
                onClick={() => moveTaskToColumn(column.id)}
                disabled={taskToMove?.status === column.id}
              >
                <span className="flex-1 text-left">{column.label}</span>
                {taskToMove?.status === column.id && (
                  <Badge variant="secondary" className="ml-2">Current</Badge>
                )}
              </Button>
            ))}
            <Button
              variant="ghost"
              className="w-full h-12 mt-4"
              onClick={() => setTaskToMove(null)}
            >
              Cancel
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <DragOverlay>
        {activeTask && (
          <div className="opacity-90 rotate-3 scale-105">
            <TaskCard
              task={activeTask}
              onClick={() => {}}
              variant="kanban"
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
