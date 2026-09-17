"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseISO, isToday, isPast, startOfDay } from "date-fns";
import { Plus, Filter, Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { BulkActionToolbar } from "@/components/ui/bulk-action-toolbar";
import {
  RecommendationsList,
  useScanForTasks,
} from "@/components/recommendations/recommendations-list";
import { TaskPanel } from "@/components/tasks/task-panel";
import { useAskAbout } from "@/hooks/use-ask-about";
import { SaveTaskAsNoteDialog } from "@/components/tasks/save-task-as-note-dialog";
import { TaskCalendarView } from "@/components/tasks/task-calendar-view";
import { TaskKanbanView } from "@/components/tasks/task-kanban-view";
import { AgentReviewFocusPanel } from "@/components/agents/agent-review-focus-panel";

import { useBulkSelect } from "@/hooks/use-bulk-select";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkState, type WorkView } from "@/hooks/use-work-state";
import { useReviewCount } from "@/hooks/use-review-count";
import { WorkCommandBar } from "./work-command-bar";
import { WorkTaskList } from "./work-task-list";
import { MobileFilterSheet } from "./mobile-filter-sheet";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

interface Project {
  id: string;
  name: string;
}

export function WorkPage() {
  const state = useWorkState();
  const { askAbout } = useAskAbout();
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Board and Calendar need desktop width; fall back to List on a phone.
  useEffect(() => {
    if (!isDesktop && state.currentView !== "list") {
      state.setCurrentView("list");
    }
  }, [isDesktop]);

  // --- Data fetching ---

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ["tasks", state.statusFilter, state.projectFilter, state.assigneeFilter],
    queryFn: async () => {
      let url = "/api/tasks?";
      if (state.statusFilter === "completed") url += "status=completed&";
      else if (state.statusFilter === "open") url += "includeCompleted=false&";
      else url += "includeCompleted=true&";
      if (state.projectFilter !== "all") url += `projectId=${state.projectFilter}&`;
      if (state.assigneeFilter !== "all") {
        if (state.assigneeFilter === "me") url += "delegatedTo=null&";
        else if (state.assigneeFilter === "ai") url += "hasAgent=true&";
        else url += `delegatedTo=${state.assigneeFilter}&`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch tasks");
      return response.json();
    },
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch projects");
      const data = await response.json();
      return (data.projects ?? []) as Project[];
    },
  });

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      return res.json();
    },
  });

  const aiReviewCount = useReviewCount();
  const scanForTasks = useScanForTasks();

  const tasks = (tasksData?.tasks as Task[]) || [];
  const projects = (projectsData as Project[]) || [];
  const agents = agentsData?.agents || [];

  // --- Computed stats ---

  const { overdueCount, dueTodayCount, inProgressCount, aiTaskCount, myTaskCount, openCount, completedTodayCount } =
    useMemo(() => {
      const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
      let overdue = 0;
      let dueToday = 0;
      let inProgress = 0;
      let ai = 0;
      let my = 0;

      for (const t of openTasks) {
        if (t.status === "in_progress") inProgress++;
        if (t.delegated_to) ai++;
        else my++;
        if (t.due_date) {
          const d = startOfDay(parseISO(t.due_date));
          if (isToday(d)) dueToday++;
          else if (isPast(d)) overdue++;
        }
      }

      const completedToday = tasks.filter(
        (t) => t.status === "completed" && t.completed_at && isToday(parseISO(t.completed_at))
      ).length;

      return {
        overdueCount: overdue,
        dueTodayCount: dueToday,
        inProgressCount: inProgress,
        aiTaskCount: ai,
        myTaskCount: my,
        openCount: openTasks.length,
        completedTodayCount: completedToday,
      };
    }, [tasks]);

  // --- Bulk selection ---

  const selection = useBulkSelect({ items: tasks });

  useEffect(() => {
    selection.clearSelection();
    state.setSelectionMode(false);
  }, [state.statusFilter, state.projectFilter, state.assigneeFilter]);

  useEffect(() => {
    if (!selection.hasSelection && state.selectionMode) {
      state.setSelectionMode(false);
    }
  }, [selection.hasSelection, state.selectionMode]);

  // --- Mutations ---

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/tasks/${id}`, { method: "DELETE" }).then((res) => {
            if (!res.ok) throw new Error(`Failed to delete ${id}`);
            return res.json();
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) throw new Error(`Failed to delete ${failed.length} tasks`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      selection.clearSelection();
      state.setSelectionMode(false);
      toast.success(`Deleted ${selection.selectedCount} tasks`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete some tasks");
    },
  });

  const handleToggleStatus = (id: string, status: string) => {
    updateStatusMutation.mutate({ id, status });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${selection.selectedCount} tasks?`,
      description: "This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (ok) bulkDeleteMutation.mutate(Array.from(selection.selectedIds));
  };

  const handleTaskClick = (task: Task) => {
    state.openTask(task);
  };

  const handleAskAbout = (task: Task) => {
    askAbout({
      id: task.id,
      type: "task",
      title: task.title || task.content,
      content: task.description || task.content,
    });
  };

  const handleReview = (agentTaskId: string) => {
    state.setReviewTaskId(agentTaskId);
  };

  // --- Loading state ---

  if (tasksLoading) {
    return (
      <div className="p-3 lg:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-8 w-full rounded-lg" />
        <div className="space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      </div>
    );
  }

  // --- Render ---

  return (
    <div className="p-3 lg:p-5 space-y-2 lg:space-y-3">
      {/* Header: title + stats + actions — single compact row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-xl font-bold lg:text-2xl shrink-0">Tasks</h1>
          <div className="hidden lg:flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums font-medium text-foreground">{openCount}</span>
            <span>open</span>
            {completedTodayCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="tabular-nums font-medium text-green-600 dark:text-green-400">
                  {completedTodayCount}
                </span>
                <span>done today</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Links to the Review surface rather than opening a parallel panel,
              so there is exactly one place agent output gets reviewed. */}
          {aiReviewCount > 0 && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800"
            >
              <Link href="/review">
                <Bot className="h-3.5 w-3.5" />
                <Badge className="bg-purple-500 text-white text-[10px] h-4 min-w-4 px-1 rounded-full">
                  {aiReviewCount}
                </Badge>
                <span className="hidden sm:inline">to review</span>
              </Link>
            </Button>
          )}

          {/* Mobile filter */}
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden h-8 w-8 relative"
            onClick={() => setMobileFilterOpen(true)}
          >
            <Filter className="h-3.5 w-3.5" />
            {(state.statusFilter !== "open" || state.projectFilter !== "all" || state.assigneeFilter !== "all") && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
            )}
          </Button>

          {/* Find tasks in notes. Lives here so it is reachable even when the
              suggestions band is hidden for having nothing to show. */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => scanForTasks.mutate()}
            disabled={scanForTasks.isPending}
            title="Scan recent notes for tasks you haven't written down"
          >
            <Sparkles className={cn("h-3.5 w-3.5", scanForTasks.isPending && "animate-pulse")} />
            <span className="hidden lg:inline">Find tasks</span>
          </Button>

          {/* New Task */}
          <Button
            onClick={() => state.openTask(null)}
            size="sm"
            className="h-8 text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">New Task</span>
          </Button>
        </div>
      </div>

      {/* Mobile Filter Sheet */}
      <MobileFilterSheet
        open={mobileFilterOpen}
        onOpenChange={setMobileFilterOpen}
        statusFilter={state.statusFilter}
        onStatusFilterChange={state.setStatusFilter}
        projectFilter={state.projectFilter}
        onProjectFilterChange={state.setProjectFilter}
        projects={projects}
      />

      {/* Unified command bar: views + filters + insight chips */}
      <WorkCommandBar
        currentView={state.currentView}
        isDesktop={!!isDesktop}
        statusFilter={state.statusFilter}
        onStatusFilterChange={state.setStatusFilter}
        projectFilter={state.projectFilter}
        onProjectFilterChange={state.setProjectFilter}
        projects={projects}
        assigneeFilter={state.assigneeFilter}
        onAssigneeFilterChange={state.setAssigneeFilter}
        agents={agents}
        summaryFilter={state.summaryFilter}
        onSummaryFilterChange={state.setSummaryFilter}
        overdueCount={overdueCount}
        dueTodayCount={dueTodayCount}
        inProgressCount={inProgressCount}
        aiTaskCount={aiTaskCount}
        onAiChipClick={() => router.push("/review")}
        reviewCount={aiReviewCount}
        selectionMode={state.selectionMode}
        onToggleSelectionMode={() => state.setSelectionMode(!state.selectionMode)}
        allSelected={selection.allSelected}
        onSelectAll={selection.selectAll}
        onClearSelection={selection.clearSelection}
        taskCount={tasks.length}
      />

      {/*
        Tasks the AI found in your notes. Shown on every view and every screen
        size — it was previously desktop-and-list-only, which hid the feature
        from phones entirely. It renders nothing when there is nothing to
        suggest, so it costs no space when it has nothing to offer.
      */}
      {state.statusFilter !== "completed" && <RecommendationsList className="!mt-1" />}

      {/* Main content area — no extra tab chrome, driven by currentView */}
      <Tabs value={state.currentView} onValueChange={(v) => state.setCurrentView(v as WorkView)}>
        {/* List View */}
        <TabsContent value="list" className="mt-0">
          <WorkTaskList
            tasks={tasks}
            statusFilter={state.statusFilter}
            summaryFilter={state.summaryFilter}
            onToggleStatus={handleToggleStatus}
            onTaskClick={handleTaskClick}
            onAskAbout={handleAskAbout}
            onDelete={handleDelete}
            onReview={handleReview}
            onCreateTask={() => state.openTask(null)}
            selectionMode={state.selectionMode}
            isSelected={selection.isSelected}
            onToggleSelect={selection.toggleItem}
          />

          {selection.hasSelection && (
            <BulkActionToolbar
              selectedCount={selection.selectedCount}
              onDelete={handleBulkDelete}
              onCancel={() => {
                selection.clearSelection();
                state.setSelectionMode(false);
              }}
              isDeleting={bulkDeleteMutation.isPending}
            />
          )}
        </TabsContent>

        {/* Board View */}
        <TabsContent value="kanban" className="mt-0">
          <TaskKanbanView projectFilter={state.projectFilter} />
        </TabsContent>

        {/* Calendar View */}
        <TabsContent value="calendar" className="mt-0">
          <TaskCalendarView
            projectFilter={state.projectFilter}
            statusFilter={state.statusFilter}
          />
        </TabsContent>
      </Tabs>

      {/* --- One panel for create, read and edit --- */}

      <TaskPanel
        task={state.panelTask}
        open={state.isPanelOpen}
        onClose={state.closeTask}
        projects={projects}
        onAskAbout={handleAskAbout}
        onReview={(agentTaskId) => {
          state.closeTask();
          state.setReviewTaskId(agentTaskId);
        }}
      />

      {state.savingTask && state.savingTaskOutput && (
        <SaveTaskAsNoteDialog
          task={state.savingTask}
          agentOutput={state.savingTaskOutput}
          open={state.saveAsNoteDialogOpen}
          onClose={() => {
            state.setSaveAsNoteDialogOpen(false);
            state.setSavingTask(null);
            state.setSavingTaskOutput(null);
          }}
        />
      )}

      {/* --- Panels --- */}

      {state.reviewTaskId && (
        <AgentReviewFocusPanel
          taskId={state.reviewTaskId}
          open={!!state.reviewTaskId}
          onClose={() => state.setReviewTaskId(null)}
        />
      )}
    </div>
  );
}
