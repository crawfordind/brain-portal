"use client";

import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Bot,
  LayoutList,
  Calendar as CalendarIcon,
  Columns3,
  FolderOpen,
  CheckSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WorkViewSwitcher } from "./work-view-switcher";
import type { StatusFilter, WorkView, SummaryFilter } from "@/hooks/use-work-state";

interface Project {
  id: string;
  name: string;
}

interface Agent {
  agent_type: string;
  display_name: string;
  icon: string;
}

interface WorkCommandBarProps {
  // View
  currentView: WorkView;
  isDesktop: boolean;
  // Status
  statusFilter: StatusFilter;
  onStatusFilterChange: (f: StatusFilter) => void;
  // Project
  projectFilter: string;
  onProjectFilterChange: (p: string) => void;
  projects: Project[];
  // Assignee
  assigneeFilter: string;
  onAssigneeFilterChange: (a: string) => void;
  agents: Agent[];
  // Summary chips
  summaryFilter: SummaryFilter;
  onSummaryFilterChange: (f: SummaryFilter) => void;
  overdueCount: number;
  dueTodayCount: number;
  inProgressCount: number;
  aiTaskCount: number;
  onAiChipClick: () => void;
  /** Agent outputs awaiting a decision — badged on the Review view. */
  reviewCount: number;
  // Selection
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  allSelected: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  taskCount: number;
}

export function WorkCommandBar({
  currentView,
  isDesktop,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  projects,
  assigneeFilter,
  onAssigneeFilterChange,
  agents,
  summaryFilter,
  onSummaryFilterChange,
  overdueCount,
  dueTodayCount,
  inProgressCount,
  aiTaskCount,
  onAiChipClick,
  reviewCount,
  selectionMode,
  onToggleSelectionMode,
  allSelected,
  onSelectAll,
  onClearSelection,
  taskCount,
}: WorkCommandBarProps) {
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "completed", label: "Done" },
    { value: "all", label: "All" },
  ];

  const summaryChips = [
    {
      key: "overdue" as SummaryFilter,
      count: overdueCount,
      icon: AlertTriangle,
      label: "Overdue",
      color: "text-red-600 dark:text-red-400",
      activeColor: "bg-red-100 dark:bg-red-950 ring-1 ring-red-500/30",
      hideWhenZero: true,
    },
    {
      key: "due_today" as SummaryFilter,
      count: dueTodayCount,
      icon: CalendarClock,
      label: "Today",
      color: "text-amber-600 dark:text-amber-400",
      activeColor: "bg-amber-100 dark:bg-amber-950 ring-1 ring-amber-500/30",
    },
    {
      key: "in_progress" as SummaryFilter,
      count: inProgressCount,
      icon: Loader2,
      label: "Active",
      color: "text-blue-600 dark:text-blue-400",
      activeColor: "bg-blue-100 dark:bg-blue-950 ring-1 ring-blue-500/30",
    },
  ];

  return (
    <div className="space-y-2">
      {/* Row 1: View switcher + Status + Filters + Selection */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        <WorkViewSwitcher
          current={currentView}
          isDesktop={isDesktop}
          reviewCount={reviewCount}
        />

        {/* Separator */}
        {isDesktop && <div className="w-px h-5 bg-border shrink-0" />}

        {/* Status toggle */}
        <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-lg shrink-0">
          {statusOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onStatusFilterChange(opt.value)}
              className="h-7 text-xs px-3"
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Project dropdown */}
        <Select value={projectFilter} onValueChange={onProjectFilterChange}>
          <SelectTrigger
            className={cn(
              "w-auto min-w-[100px] max-w-[160px] h-7 text-xs shrink-0",
              projectFilter === "all" && "border-dashed"
            )}
          >
            <FolderOpen className="h-3 w-3 mr-1.5 text-muted-foreground shrink-0" />
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Assignee dropdown */}
        <Select value={assigneeFilter} onValueChange={onAssigneeFilterChange}>
          <SelectTrigger
            className={cn(
              "w-auto min-w-[90px] max-w-[150px] h-7 text-xs shrink-0",
              assigneeFilter === "all" && "border-dashed"
            )}
          >
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="me">My Tasks</SelectItem>
            <SelectItem value="ai">AI Tasks</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.agent_type} value={agent.agent_type}>
                {agent.icon} {agent.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Selection controls (list view only, desktop) */}
        {isDesktop && currentView === "list" && taskCount > 0 && (
          <>
            {selectionMode ? (
              <div className="flex items-center gap-2 shrink-0">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    checked ? onSelectAll() : onClearSelection()
                  }
                  className="h-4 w-4"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onClearSelection();
                    onToggleSelectionMode();
                  }}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onToggleSelectionMode}
                    className="h-7 text-xs shrink-0"
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    Select
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Select multiple tasks for bulk actions</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      {/* Row 2: Smart summary chips - compact insight bar */}
      {statusFilter !== "completed" && (
        <div className="flex items-center gap-1.5">
          {summaryChips.map((chip) => {
            if (chip.hideWhenZero && chip.count === 0) return null;
            const Icon = chip.icon;
            const isActive = summaryFilter === chip.key;

            return (
              <button
                key={chip.key}
                type="button"
                onClick={() =>
                  summaryFilter === chip.key
                    ? onSummaryFilterChange(null)
                    : onSummaryFilterChange(chip.key)
                }
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all shrink-0",
                  isActive
                    ? `${chip.activeColor} ${chip.color}`
                    : `hover:bg-muted/60 ${chip.color}`
                )}
              >
                <Icon className="h-3 w-3" />
                <span className="tabular-nums">{chip.count}</span>
                {isActive && <span>{chip.label}</span>}
              </button>
            );
          })}

          {/* AI chip */}
          {aiTaskCount > 0 && (
            <button
              type="button"
              onClick={onAiChipClick}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-muted/60 transition-all shrink-0"
            >
              <Bot className="h-3 w-3" />
              <span className="tabular-nums">{aiTaskCount}</span>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-purple-500" />
              </span>
            </button>
          )}

          {/* Clear filter indicator */}
          {summaryFilter && (
            <button
              type="button"
              onClick={() => onSummaryFilterChange(null)}
              className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
