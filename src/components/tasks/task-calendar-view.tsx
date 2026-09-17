"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addWeeks, subWeeks, addDays, subDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WeekStrip } from "./calendar/week-strip";
import { DayView } from "./calendar/day-view";
import { BacklogSheet } from "./calendar/backlog-sheet";
import { TaskPanel } from "./task-panel";
import { useProjects } from "@/hooks/use-projects";
import { getWeekRange } from "@/lib/tasks/calendar-utils";
import { toast } from "sonner";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { MobileCalendarView } from "./calendar/mobile-calendar-view";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Task } from "@/types/task";
import { useAskAbout } from "@/hooks/use-ask-about";

interface TaskCalendarViewProps {
  projectFilter?: string;
  statusFilter?: string;
}

export function TaskCalendarView({
  projectFilter = "all",
  statusFilter = "open",
}: TaskCalendarViewProps) {
  const [focusedDate, setFocusedDate] = useState(() => new Date());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { data: projects = [] } = useProjects();
  const { askAbout } = useAskAbout();
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const queryClient = useQueryClient();

  const weekStart = startOfWeek(focusedDate, { weekStartsOn: 1 });
  const weekRange = getWeekRange(weekStart);

  // Fetch tasks for the current week + all unscheduled
  const { data: weekTasks = [], isLoading: weekLoading } = useQuery({
    queryKey: ["tasks", "calendar", weekRange.start, weekRange.end, projectFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: weekRange.start,
        end: weekRange.end,
      });

      if (projectFilter && projectFilter !== "all") {
        params.set("projectId", projectFilter);
      }

      if (statusFilter === "open") {
        params.set("includeCompleted", "false");
      } else if (statusFilter === "completed") {
        params.set("status", "completed");
      } else {
        params.set("includeCompleted", "true");
      }

      const response = await fetch(`/api/tasks?${params}`);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      const data = await response.json();
      return data.tasks || [];
    },
  });

  // Fetch all unscheduled tasks for backlog
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", "all", projectFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();

      if (projectFilter && projectFilter !== "all") {
        params.set("projectId", projectFilter);
      }

      if (statusFilter === "open") {
        params.set("includeCompleted", "false");
      }

      const response = await fetch(`/api/tasks?${params}`);
      if (!response.ok) throw new Error("Failed to fetch all tasks");
      const data = await response.json();
      return data.tasks || [];
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ taskId, scheduledAt }: { taskId: string; scheduledAt: string }) => {
      const response = await fetch(`/api/tasks/${taskId}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: scheduledAt }),
      });
      if (!response.ok) throw new Error("Failed to reschedule task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task scheduled!");
    },
    onError: () => {
      toast.error("Failed to schedule task");
    },
  });

  const goToPreviousWeek = () => setFocusedDate(subWeeks(focusedDate, 1));
  const goToNextWeek = () => setFocusedDate(addWeeks(focusedDate, 1));
  const goToToday = () => setFocusedDate(new Date());

  const handleTaskSchedule = (taskId: string, scheduledAt: string) => {
    rescheduleMutation.mutate({ taskId, scheduledAt });
  };

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 15, // 15px movement required to start drag
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250, // 250ms hold before drag starts
        tolerance: 8, // 8px movement tolerance
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    // Find the task being dragged and show it in overlay
    const task = [...weekTasks, ...allTasks].find(t => t.id === event.active.id);
    setActiveTask(task || null);

    // Close backlog sheet when drag starts so user can see calendar
    setBacklogOpen(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Clear active task
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const dropTargetId = over.id as string;

    // Parse drop target: "slot-{yyyy-MM-dd}-{HH:mm}"
    const match = dropTargetId.match(/^slot-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/);
    if (!match) return;

    const [, dateStr, timeSlot] = match;

    // Construct scheduled_at timestamp in local time format (no timezone conversion)
    const scheduledAt = `${dateStr}T${timeSlot}:00`;

    handleTaskSchedule(taskId, scheduledAt);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setFocusedDate(prev => subDays(prev, 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setFocusedDate(prev => addDays(prev, 1));
          break;
        case "t":
        case "T":
          e.preventDefault();
          goToToday();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (weekLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading calendar...</p>
        </div>
      </div>
    );
  }

  const combinedTasks = [...weekTasks, ...allTasks];

  // Editing from the calendar used to be a `// TODO` behind an Edit button,
  // so a task opened from here could be read and nothing else. The panel is
  // editable in place, which removes both the button and the dead end.
  const taskDetailDialog = selectedTask && (
    <TaskPanel
      task={selectedTask}
      open={!!selectedTask}
      onClose={() => setSelectedTask(null)}
      projects={projects}
      onAskAbout={(t) =>
        askAbout({
          id: t.id,
          type: "task",
          title: t.title || t.content,
          content: t.description || t.content,
        })
      }
    />
  );

  // Mobile: clean agenda view (no DnD)
  if (!isDesktop) {
    return (
      <div className="flex flex-col h-[calc(100vh-12rem)]">
        {/* Week navigation */}
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={goToNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-sm font-semibold">
            {format(weekStart, "MMM d")} - {format(addWeeks(weekStart, 1), "MMM d, yyyy")}
          </h2>
        </div>

        <MobileCalendarView
          focusedDate={focusedDate}
          onDaySelect={setFocusedDate}
          tasks={combinedTasks}
          onTaskClick={setSelectedTask}
        />

        {taskDetailDialog}
      </div>
    );
  }

  // Desktop: full DnD calendar
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
    <div className="flex flex-col lg:flex-row h-[calc(100vh-10rem)]">
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Week navigation */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPreviousWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={goToNextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-base font-semibold">
            {format(weekStart, "MMM d")} - {format(addWeeks(weekStart, 1), "MMM d, yyyy")}
          </h2>
        </div>

        {/* Week strip */}
        <WeekStrip
          focusedDate={focusedDate}
          onDaySelect={setFocusedDate}
          tasks={combinedTasks}
        />

        {/* Day view */}
        <DayView
          date={focusedDate}
          tasks={combinedTasks}
          onTaskClick={setSelectedTask}
          onDateChange={setFocusedDate}
        />
      </div>

      {/* Backlog sheet/sidebar */}
      <BacklogSheet
        tasks={allTasks}
        onTaskClick={setSelectedTask}
        isOpen={backlogOpen}
        onOpenChange={setBacklogOpen}
      />

      {taskDetailDialog}
    </div>

    {/* Drag overlay - shows task being dragged */}
    <DragOverlay>
      {activeTask && (
        <div className="p-3 rounded-lg border-l-4 bg-card shadow-2xl opacity-90 rotate-3 scale-105 select-none border-l-blue-500">
          <div className="text-sm font-medium line-clamp-2">
            {activeTask.title || activeTask.content}
          </div>
          {activeTask.project_name && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {activeTask.project_name}
            </div>
          )}
        </div>
      )}
    </DragOverlay>
    </DndContext>
  );
}
