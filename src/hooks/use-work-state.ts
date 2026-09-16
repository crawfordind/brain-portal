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
  isCreateOpen: boolean;
  setIsCreateOpen: (v: boolean) => void;
  isDetailOpen: boolean;
  setIsDetailOpen: (v: boolean) => void;
  isEditOpen: boolean;
  setIsEditOpen: (v: boolean) => void;
  viewingTask: Task | null;
  setViewingTask: (t: Task | null) => void;
  editingTask: Task | null;
  setEditingTask: (t: Task | null) => void;
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
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
    isCreateOpen, setIsCreateOpen,
    isDetailOpen, setIsDetailOpen,
    isEditOpen, setIsEditOpen,
    viewingTask, setViewingTask,
    editingTask, setEditingTask,
    saveAsNoteDialogOpen, setSaveAsNoteDialogOpen,
    savingTask, setSavingTask,
    savingTaskOutput, setSavingTaskOutput,
    reviewTaskId, setReviewTaskId,
    selectionMode, setSelectionMode,
  };
}
