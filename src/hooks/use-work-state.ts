"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Task } from "@/types/task";

export type WorkView = "list" | "kanban" | "calendar";
export type StatusFilter = "open" | "completed" | "all";
export type SummaryFilter = "overdue" | "due_today" | "in_progress" | null;

export interface WorkState {
  // View
  currentView: WorkView;
  setCurrentView: (view: WorkView) => void;

  // Filters
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  projectFilter: string;
  setProjectFilter: (p: string) => void;
  assigneeFilter: string;
  setAssigneeFilter: (a: string) => void;
  summaryFilter: SummaryFilter;
  setSummaryFilter: (f: SummaryFilter) => void;

  // Dialogs
  /** The task panel handles create, read and edit on one surface, so one
   *  open flag and one slot replace the previous three dialogs' five. */
  isPanelOpen: boolean;
  setIsPanelOpen: (v: boolean) => void;
  /** Task being viewed/edited, or null when creating a new one. */
  panelTask: Task | null;
  setPanelTask: (t: Task | null) => void;
  /** Open the panel on an existing task, or on a blank one to create. */
  openTask: (t: Task | null) => void;
  closeTask: () => void;
  saveAsNoteDialogOpen: boolean;
  setSaveAsNoteDialogOpen: (v: boolean) => void;
  savingTask: Task | null;
  setSavingTask: (t: Task | null) => void;
  savingTaskOutput: any | null;
  setSavingTaskOutput: (v: any | null) => void;

  // Panels
  reviewTaskId: string | null;
  setReviewTaskId: (id: string | null) => void;

  // Selection
  selectionMode: boolean;
  setSelectionMode: (v: boolean) => void;
}

const WORK_VIEWS: WorkView[] = ["list", "kanban", "calendar"];

function isWorkView(value: string | null): value is WorkView {
  return !!value && (WORK_VIEWS as string[]).includes(value);
}

export function useWorkState(): WorkState {
  const router = useRouter();
  const searchParams = useSearchParams();

  // View state from URL
  const [currentView, setCurrentViewState] = useState<WorkView>("list");
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);

  // Sync from URL after mount.
  useEffect(() => {
    const viewParam = searchParams.get("view");
    if (isWorkView(viewParam)) {
      setCurrentViewState(viewParam);
    }
    const reviewParam = searchParams.get("review");
    if (reviewParam) {
      setReviewTaskId(reviewParam);
    }
  }, [searchParams]);

  const setCurrentView = useCallback((view: WorkView) => {
    setCurrentViewState(view);
    const params = new URLSearchParams(searchParams);
    params.set("view", view);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [projectFilter, setProjectFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>(null);

  // Dialogs
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelTask, setPanelTask] = useState<Task | null>(null);

  // Opening always sets both, so a stale task can never be shown under a
  // "New task" heading — which is what happened when the three dialogs kept
  // their own independent slots.
  const openTask = useCallback((t: Task | null) => {
    setPanelTask(t);
    setIsPanelOpen(true);
  }, []);

  const closeTask = useCallback(() => {
    setIsPanelOpen(false);
    setPanelTask(null);
  }, []);
  const [saveAsNoteDialogOpen, setSaveAsNoteDialogOpen] = useState(false);
  const [savingTask, setSavingTask] = useState<Task | null>(null);
  const [savingTaskOutput, setSavingTaskOutput] = useState<any | null>(null);

  // Panels

  // Selection
  const [selectionMode, setSelectionMode] = useState(false);

  return {
    currentView, setCurrentView,
    statusFilter, setStatusFilter,
    projectFilter, setProjectFilter,
    assigneeFilter, setAssigneeFilter,
    summaryFilter, setSummaryFilter,
    isPanelOpen, setIsPanelOpen,
    panelTask, setPanelTask,
    openTask,
    closeTask,
    saveAsNoteDialogOpen, setSaveAsNoteDialogOpen,
    savingTask, setSavingTask,
    savingTaskOutput, setSavingTaskOutput,
    reviewTaskId, setReviewTaskId,
    selectionMode, setSelectionMode,
  };
}
