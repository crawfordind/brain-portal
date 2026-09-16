# Dashboard Redesign Implementation Plan

**Status:** ✅ Complete
**Completion Date:** 2026-02-06
**Deployed:** No

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform dashboard into "Today's Focus" hub with merged inbox, task sections, and mobile optimization

**Architecture:** Replace current dashboard page with vertical-stack layout. Remove broken GraphSection. Build reusable TaskItem and CollapsibleSection components. Merge inbox functionality inline.

**Tech Stack:** Next.js 16 App Router, React Query, Tailwind CSS, Radix UI, TypeScript

---

## Phase 1: Remove Knowledge Graph & Setup Base

### Task 1: Remove GraphSection Component

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:1-270`

**Step 1: Remove GraphSection import and usage**

Open `src/app/(dashboard)/page.tsx` and remove lines:
- Line 10: `import { GraphSection } from "@/components/dashboard/graph-section";`
- Lines 172-173: The entire `<GraphSection />` component

**Step 2: Update grid layout**

Replace the two-column grid (lines 162-183) with single column for mobile-first:

```tsx
{/* Mobile: Insights first, Desktop: Insights sidebar */}
<div className="space-y-3 lg:space-y-6">
  <div>
    <h2 className="text-base lg:text-lg font-semibold mb-2 lg:mb-3 px-1 lg:px-0">AI Insights</h2>
    <InsightsFeed userId={user.id} />
  </div>
  <WeeklySummary userId={user.id} />
</div>
```

**Step 3: Run dev server and verify**

Run: `npm run dev`
Expected: Dashboard loads without errors, no graph visible

**Step 4: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "refactor(dashboard): remove broken knowledge graph component

Removes GraphSection to resolve errors. Will be restored after fixes.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Create Shared CollapsibleSection Component

**Files:**
- Create: `src/components/dashboard/collapsible-section.tsx`
- Test: Manual testing (no unit test needed for UI component)

**Step 1: Create CollapsibleSection component**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  badge?: string;
  defaultCollapsed?: boolean;
  storageKey?: string; // For localStorage persistence
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  icon,
  count,
  badge,
  defaultCollapsed = false,
  storageKey,
  actions,
  children,
  className,
}: CollapsibleSectionProps) {
  // Load state from localStorage if storageKey provided
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (!storageKey) return defaultCollapsed;
    const stored = localStorage.getItem(`dashboard-section-${storageKey}`);
    return stored !== null ? stored === "true" : defaultCollapsed;
  });

  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    if (storageKey) {
      localStorage.setItem(`dashboard-section-${storageKey}`, String(newState));
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <button
        onClick={toggleCollapsed}
        className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <div className="flex items-center gap-2">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isCollapsed && "-rotate-90"
            )}
          />
          <span className="flex items-center gap-2 font-semibold text-sm">
            {icon}
            {title}
          </span>
          {count !== undefined && count > 0 && (
            <Badge variant="secondary" className="ml-1">
              {count}
            </Badge>
          )}
          {badge && (
            <Badge variant="outline" className="ml-1 text-xs">
              {badge}
            </Badge>
          )}
        </div>
        {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </button>

      {/* Content */}
      {!isCollapsed && <div className="pl-2 space-y-2">{children}</div>}
    </div>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/collapsible-section.tsx
git commit -m "feat(dashboard): add CollapsibleSection component

Reusable collapsible section with localStorage persistence, badges, and actions.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Create Shared TaskItem Component

**Files:**
- Create: `src/components/dashboard/task-item.tsx`

**Step 1: Create TaskItem component**

```tsx
"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { Task } from "@/lib/db/schema";

interface TaskItemProps {
  task: Task;
  onComplete: (id: string) => void;
  onDelete?: (id: string) => void;
  onClick?: (task: Task) => void;
  showScheduledTime?: boolean;
  showProject?: boolean;
}

const PRIORITY_COLORS = {
  urgent: "bg-red-500/10 text-red-600 dark:text-red-400",
  high: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  medium: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  low: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

export function TaskItem({
  task,
  onComplete,
  onDelete,
  onClick,
  showScheduledTime = false,
  showProject = false,
}: TaskItemProps) {
  const [isCompleting, setIsCompleting] = useState(false);

  const handleCheckboxChange = async (checked: boolean) => {
    if (checked && !isCompleting) {
      setIsCompleting(true);
      try {
        await onComplete(task.id);
      } finally {
        setIsCompleting(false);
      }
    }
  };

  const handleClick = () => {
    if (onClick) onClick(task);
  };

  // Determine AI status badge
  const getAIStatusBadge = () => {
    if (!task.delegated_to) return null;

    if (task.status === "in_progress") {
      return <Badge variant="secondary" className="text-xs">🤖 In Progress</Badge>;
    }
    // You can add more states here based on agent_task status
    return null;
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group",
        "touch-manipulation", // Better touch response on mobile
        task.status === "completed" && "opacity-60"
      )}
    >
      {/* Checkbox */}
      <Checkbox
        checked={task.status === "completed"}
        onCheckedChange={handleCheckboxChange}
        disabled={isCompleting}
        className="flex-shrink-0"
      />

      {/* Task Content */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={handleClick}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {/* Title */}
          <span
            className={cn(
              "text-sm",
              task.status === "completed" && "line-through text-muted-foreground"
            )}
          >
            {task.title || task.content}
          </span>

          {/* Badges */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Priority */}
            {task.priority && task.priority !== "low" && (
              <Badge
                variant="secondary"
                className={cn("text-xs", PRIORITY_COLORS[task.priority])}
              >
                {task.priority}
              </Badge>
            )}

            {/* AI Status */}
            {getAIStatusBadge()}

            {/* Project Dot */}
            {showProject && task.project_id && (
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: "#3b82f6" }} // Default blue, can be dynamic
                title="Project task"
              />
            )}
          </div>
        </div>

        {/* Scheduled Time */}
        {showScheduledTime && task.scheduled_for && (
          <div className="text-xs text-muted-foreground mt-1">
            {format(new Date(task.scheduled_for), "h:mm a")}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/task-item.tsx
git commit -m "feat(dashboard): add TaskItem component

Reusable task item with checkbox, badges, and AI status display.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Build Task Sections

### Task 4: Create TodayTasksSection Component

**Files:**
- Create: `src/components/dashboard/today-tasks-section.tsx`

**Step 1: Create TodayTasksSection component**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Plus } from "lucide-react";
import { TaskItem } from "./task-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Task } from "@/lib/db/schema";
import { toast } from "sonner";

interface TodayTasksSectionProps {
  tasks: Task[];
}

export function TodayTasksSection({ tasks }: TodayTasksSectionProps) {
  const queryClient = useQueryClient();
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");

  // Complete task mutation
  const completeMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!response.ok) throw new Error("Failed to complete task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task completed!");
    },
    onError: () => {
      toast.error("Failed to complete task");
    },
  });

  // Create task mutation
  const createMutation = useMutation({
    mutationFn: async (data: { title: string; priority: string }) => {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.title,
          status: "pending",
          priority: data.priority,
        }),
      });
      if (!response.ok) throw new Error("Failed to create task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setNewTaskTitle("");
      setShowQuickAdd(false);
      toast.success("Task created!");
    },
    onError: () => {
      toast.error("Failed to create task");
    },
  });

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    createMutation.mutate({ title: newTaskTitle, priority });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base lg:text-lg font-semibold flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-primary" />
          Today's Tasks
          {tasks.length > 0 && (
            <span className="text-sm text-muted-foreground">({tasks.length})</span>
          )}
        </h2>
        {!showQuickAdd && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowQuickAdd(true)}
            className="h-8 px-2"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Quick Add Form */}
      {showQuickAdd && (
        <form onSubmit={handleQuickAdd} className="flex gap-2 p-3 bg-muted/50 rounded-lg">
          <Input
            placeholder="Add a task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="flex-1"
            autoFocus
            onBlur={() => {
              if (!newTaskTitle.trim()) setShowQuickAdd(false);
            }}
          />
          <Select value={priority} onValueChange={(v: any) => setPriority(v)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={createMutation.isPending}>
            Add
          </Button>
        </form>
      )}

      {/* Task List */}
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No tasks for today. Add one above!
          </div>
        ) : (
          tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onComplete={(id) => completeMutation.mutate(id)}
              showProject
            />
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/today-tasks-section.tsx
git commit -m "feat(dashboard): add TodayTasksSection component

Displays today's tasks with quick-add functionality and completion handling.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Create ScheduledTasksSection Component

**Files:**
- Create: `src/components/dashboard/scheduled-tasks-section.tsx`

**Step 1: Create ScheduledTasksSection component**

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import { TaskItem } from "./task-item";
import { format, isToday, isTomorrow, isThisWeek } from "date-fns";
import type { Task } from "@/lib/db/schema";
import { toast } from "sonner";

interface ScheduledTasksSectionProps {
  tasks: Task[];
}

export function ScheduledTasksSection({ tasks }: ScheduledTasksSectionProps) {
  const queryClient = useQueryClient();

  // Complete task mutation
  const completeMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!response.ok) throw new Error("Failed to complete task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task completed!");
    },
    onError: () => {
      toast.error("Failed to complete task");
    },
  });

  // Group tasks by time
  const groupedTasks = tasks.reduce((acc, task) => {
    if (!task.scheduled_for) return acc;

    const date = new Date(task.scheduled_for);
    let group: string;

    if (isToday(date)) {
      group = "Today";
    } else if (isTomorrow(date)) {
      group = "Tomorrow";
    } else if (isThisWeek(date)) {
      group = "This Week";
    } else {
      group = "Later";
    }

    if (!acc[group]) acc[group] = [];
    acc[group].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  const groupOrder = ["Today", "Tomorrow", "This Week", "Later"];
  const sortedGroups = groupOrder.filter((g) => groupedTasks[g]?.length > 0);

  if (tasks.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <h2 className="text-base lg:text-lg font-semibold flex items-center gap-2">
        <Calendar className="h-5 w-5 text-primary" />
        Scheduled
        <span className="text-sm text-muted-foreground">({tasks.length})</span>
      </h2>

      {/* Grouped Tasks */}
      <div className="space-y-4">
        {sortedGroups.map((group) => (
          <div key={group}>
            <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1">
              {group}
            </h3>
            <div className="space-y-2">
              {groupedTasks[group].map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onComplete={(id) => completeMutation.mutate(id)}
                  showScheduledTime={group === "Today"}
                  showProject
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/scheduled-tasks-section.tsx
git commit -m "feat(dashboard): add ScheduledTasksSection component

Displays scheduled tasks grouped by time (Today, Tomorrow, This Week, Later).

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Integrate Inbox Components

### Task 6: Move and Update Capture Components

**Files:**
- Move: `src/components/inbox/capture-card.tsx` → `src/components/dashboard/capture-card.tsx`
- Move: `src/components/inbox/link-capture-card.tsx` → `src/components/dashboard/link-capture-card.tsx`
- Move: `src/components/inbox/insight-card.tsx` → `src/components/dashboard/insight-card.tsx`

**Step 1: Move capture card files**

Run:
```bash
cp src/components/inbox/capture-card.tsx src/components/dashboard/capture-card.tsx
cp src/components/inbox/link-capture-card.tsx src/components/dashboard/link-capture-card.tsx
cp src/components/inbox/insight-card.tsx src/components/dashboard/insight-card.tsx
```

**Step 2: Verify components build**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/capture-card.tsx src/components/dashboard/link-capture-card.tsx src/components/dashboard/insight-card.tsx
git commit -m "refactor(dashboard): move inbox components to dashboard

Copies capture and insight cards for dashboard integration.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Create CapturesCard Component

**Files:**
- Create: `src/components/dashboard/captures-card.tsx`

**Step 1: Create CapturesCard component**

```tsx
"use client";

import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";
import { CaptureCard } from "./capture-card";
import { LinkCaptureCard } from "./link-capture-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Capture } from "@/lib/db/schema";
import { isLinkCapture } from "@/lib/db/schema";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function CapturesCard() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch unprocessed captures
  const { data: captures, isLoading } = useQuery({
    queryKey: ["captures", "unprocessed"],
    queryFn: async () => {
      const response = await fetch("/api/captures?processed=false");
      if (!response.ok) throw new Error("Failed to fetch captures");
      const data = await response.json();
      return data.captures as Capture[];
    },
  });

  // Convert capture mutation
  const convertMutation = useMutation({
    mutationFn: async ({ captureId, type }: { captureId: string; type: "note" | "task" }) => {
      if (type === "note") {
        const capture = captures?.find((c) => c.id === captureId);
        if (!capture) throw new Error("Capture not found");

        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Captured Note",
            content: capture.content,
          }),
        });
        if (!response.ok) throw new Error("Failed to create note");
        const data = await response.json();

        // Mark as processed
        await fetch(`/api/captures/${captureId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isProcessed: true }),
        });

        router.push(`/notes/${data.note.slug}`);
      } else {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: captures?.find((c) => c.id === captureId)?.content || "",
            status: "pending",
          }),
        });
        if (!response.ok) throw new Error("Failed to create task");

        // Mark as processed
        await fetch(`/api/captures/${captureId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isProcessed: true }),
        });

        toast.success("Task created!");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures"] });
    },
  });

  // Delete capture mutation
  const deleteMutation = useMutation({
    mutationFn: async (captureId: string) => {
      const response = await fetch(`/api/captures/${captureId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete capture");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["captures"] });
      toast.success("Capture deleted");
    },
  });

  const lastCaptureTime = captures?.[0]?.captured_at
    ? new Date(captures[0].captured_at).toLocaleString()
    : null;

  return (
    <CollapsibleSection
      title="Unprocessed Captures"
      icon={<Inbox className="h-4 w-4" />}
      count={captures?.length || 0}
      badge={lastCaptureTime ? `Last: ${lastCaptureTime}` : undefined}
      defaultCollapsed={true}
      storageKey="captures"
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !captures || captures.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No unprocessed captures. You're all caught up!
        </div>
      ) : (
        <div className="space-y-3">
          {captures.map((capture) =>
            isLinkCapture(capture) ? (
              <LinkCaptureCard
                key={capture.id}
                capture={capture}
                onConvert={(id, type) => convertMutation.mutate({ captureId: id, type })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ) : (
              <CaptureCard
                key={capture.id}
                capture={capture}
                onConvert={(id, type) => convertMutation.mutate({ captureId: id, type })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            )
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/captures-card.tsx
git commit -m "feat(dashboard): add CapturesCard component

Collapsible card for unprocessed captures with convert/delete actions.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Create InsightsCard Component

**Files:**
- Create: `src/components/dashboard/insights-card.tsx`

**Step 1: Create InsightsCard component**

```tsx
"use client";

import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Lightbulb, RefreshCw } from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";
import { InsightCard } from "./insight-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Insight } from "@/lib/db/schema";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InsightsCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch new insights
  const { data: insights, isLoading } = useQuery({
    queryKey: ["insights", "new"],
    queryFn: async () => {
      const response = await fetch("/api/insights?status=new");
      if (!response.ok) throw new Error("Failed to fetch insights");
      const data = await response.json();
      return data.insights as Insight[];
    },
  });

  // Generate insights mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeCaptures: true, daysBack: 7, skipCache: true }),
      });
      if (!response.ok) throw new Error("Failed to generate insights");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Insights refreshed!");
      setIsRefreshing(false);
    },
    onError: () => {
      toast.error("Failed to generate insights");
      setIsRefreshing(false);
    },
  });

  // Create note from insight
  const createNoteMutation = useMutation({
    mutationFn: async (insightId: string) => {
      const insight = insights?.find((i) => i.id === insightId);
      if (!insight) throw new Error("Insight not found");

      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: insight.title,
          content: insight.content,
        }),
      });
      if (!response.ok) throw new Error("Failed to create note");
      const data = await response.json();

      // Mark insight as actioned
      await fetch("/api/insights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: insightId, action: "action" }),
      });

      router.push(`/notes/${data.note.slug}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
  });

  // Dismiss insight mutation
  const dismissMutation = useMutation({
    mutationFn: async (insightId: string) => {
      const response = await fetch("/api/insights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: insightId, action: "dismiss" }),
      });
      if (!response.ok) throw new Error("Failed to dismiss insight");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Insight dismissed");
    },
  });

  const handleRefresh = () => {
    setIsRefreshing(true);
    generateMutation.mutate();
  };

  return (
    <CollapsibleSection
      title="AI Insights"
      icon={<Lightbulb className="h-4 w-4" />}
      count={insights?.length || 0}
      badge="Auto-updated daily"
      defaultCollapsed={true}
      storageKey="insights"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-8 px-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : !insights || insights.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No insights available yet.
        </div>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onAction={(id, action) => {
                if (action === "note") {
                  createNoteMutation.mutate(id);
                }
              }}
              onDismiss={(id) => dismissMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
```

**Step 2: Verify component builds**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/dashboard/insights-card.tsx
git commit -m "feat(dashboard): add InsightsCard component

Collapsible card for AI insights with auto-refresh and manual refresh button.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Update Dashboard Page

### Task 9: Restructure Dashboard Data Fetching

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:26-111`

**Step 1: Update getDashboardData function**

Replace the existing function with optimized version:

```typescript
async function getDashboardData(userId: string) {
  try {
    const today = format(new Date(), "yyyy-MM-dd");

    // Get today's tasks (unscheduled or scheduled for today)
    const todayTasks = await query<Task>(
      `SELECT * FROM tasks
       WHERE user_id = ?
         AND status IN ('pending', 'in_progress')
         AND (
           scheduled_for IS NULL
           OR DATE(scheduled_for) = DATE('now')
         )
       ORDER BY
         CASE priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           ELSE 4
         END,
         created_at DESC`,
      [userId]
    );

    // Get scheduled tasks (upcoming)
    const scheduledTasks = await query<Task>(
      `SELECT * FROM tasks
       WHERE user_id = ?
         AND status IN ('pending', 'in_progress')
         AND scheduled_for IS NOT NULL
       ORDER BY scheduled_for ASC
       LIMIT 10`,
      [userId]
    );

    // Get today's daily note
    const [todayNote] = await query<Note>(
      `SELECT n.* FROM notes n
       JOIN daily_notes dn ON n.id = dn.note_id
       WHERE dn.user_id = ? AND dn.date = ?`,
      [userId, today]
    );

    // Get recent notes with project information (last 7)
    const recentNotesWithProjects = await query<Note & {
      project_name?: string;
      project_color?: string;
    }>(
      `SELECT
        n.*,
        p.name as project_name,
        p.color as project_color
       FROM notes n
       LEFT JOIN projects p ON n.project_id = p.id
       WHERE n.user_id = ? AND n.is_archived = FALSE
       ORDER BY n.updated_at DESC
       LIMIT 7`,
      [userId]
    );

    // Get active projects
    const activeProjects = await query<Project>(
      `SELECT * FROM projects
       WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 5`,
      [userId]
    );

    return {
      todayTasks,
      scheduledTasks,
      todayNote,
      recentNotesWithProjects,
      activeProjects,
      error: null,
    };
  } catch (error) {
    console.error("Dashboard data fetch failed:", error);
    return {
      todayTasks: [],
      scheduledTasks: [],
      todayNote: undefined,
      recentNotesWithProjects: [],
      activeProjects: [],
      error: "Database temporarily unavailable",
    };
  }
}
```

**Step 2: Verify TypeScript**

Run: `npm run typecheck`
Expected: No type errors (may need to add Task import)

**Step 3: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "refactor(dashboard): update data fetching for new layout

Splits tasks into today and scheduled queries for dashboard sections.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Update Dashboard Layout

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:140-261`

**Step 1: Import new components**

Add imports at the top of the file:

```typescript
import { TodayTasksSection } from "@/components/dashboard/today-tasks-section";
import { ScheduledTasksSection } from "@/components/dashboard/scheduled-tasks-section";
import { CapturesCard } from "@/components/dashboard/captures-card";
import { InsightsCard } from "@/components/dashboard/insights-card";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { FileText, FolderKanban } from "lucide-react";
```

**Step 2: Update DashboardContent component**

Replace the entire content section (lines 150-258) with:

```tsx
<div className="space-y-3 p-3 lg:space-y-6 lg:p-6">
  {/* Database Error Banner */}
  {data.error && (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 lg:px-4 lg:py-3 text-amber-600 dark:text-amber-400 text-sm">
      Database temporarily unavailable. Some features may not work.
    </div>
  )}

  {/* ALWAYS VISIBLE: Critical Zone */}
  <TodayTasksSection tasks={data.todayTasks} />
  <ScheduledTasksSection tasks={data.scheduledTasks} />
  <CapturesCard />
  <InsightsCard />

  {/* COLLAPSIBLE: Contextual Zone */}
  {data.todayNote && (
    <CollapsibleSection
      title="Today's Note"
      icon={<FileText className="h-4 w-4" />}
      badge={`${data.todayNote.content?.length || 0} chars`}
      defaultCollapsed={true}
      storageKey="daily-note"
    >
      <div className="p-4 rounded-lg border bg-card">
        <p className="text-sm text-muted-foreground line-clamp-3">
          {data.todayNote.content?.substring(0, 300) || "Start writing..."}
        </p>
        <Link href={`/notes/${data.todayNote.slug}`}>
          <Button variant="outline" size="sm" className="mt-3">
            Open to Edit
          </Button>
        </Link>
      </div>
    </CollapsibleSection>
  )}

  <CollapsibleSection
    title="Active Projects"
    icon={<FolderKanban className="h-4 w-4" />}
    count={data.activeProjects.length}
    defaultCollapsed={true}
    storageKey="projects"
  >
    {data.activeProjects.length === 0 ? (
      <p className="text-muted-foreground text-sm text-center py-4">No active projects.</p>
    ) : (
      <div className="space-y-2">
        {data.activeProjects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.slug}`}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="font-medium text-sm truncate">{project.name}</span>
            </div>
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {project.status}
            </Badge>
          </Link>
        ))}
      </div>
    )}
  </CollapsibleSection>

  <RecentNotesSection notes={data.recentNotesWithProjects} />

  {/* AI Insights Section (Desktop) */}
  <div className="space-y-6">
    <div>
      <h2 className="text-lg font-semibold mb-3">AI Insights</h2>
      <InsightsFeed userId={user.id} />
    </div>
    <WeeklySummary userId={user.id} />
  </div>
</div>
```

**Step 3: Run dev server and verify**

Run: `npm run dev`
Expected: Dashboard loads with new layout, no console errors

**Step 4: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat(dashboard): implement new Today's Focus layout

Integrates task sections, captures, insights, and collapsible contextual sections.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Delete Old Inbox Page

### Task 11: Remove Inbox Page

**Files:**
- Delete: `src/app/(dashboard)/inbox/page.tsx`
- Modify: Navigation links (if any)

**Step 1: Delete inbox page**

Run:
```bash
rm src/app/(dashboard)/inbox/page.tsx
```

**Step 2: Check for broken links**

Search for references to `/inbox`:
```bash
grep -r "\/inbox" src/components --include="*.tsx" --include="*.ts"
```

Update any navigation links to point to `/` (dashboard) instead.

**Step 3: Verify app builds**

Run: `npm run build`
Expected: Successful build with no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(dashboard): remove separate inbox page

Inbox functionality now integrated into dashboard.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Mobile Optimizations

### Task 12: Add Mobile Touch Styles

**Files:**
- Modify: `src/components/dashboard/task-item.tsx`
- Modify: `src/components/dashboard/collapsible-section.tsx`

**Step 1: Add touch styles to TaskItem**

In `task-item.tsx`, update the main div className:

```tsx
className={cn(
  "flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group",
  "touch-manipulation min-h-[44px]", // Mobile touch optimization
  task.status === "completed" && "opacity-60"
)}
```

**Step 2: Add touch styles to CollapsibleSection button**

In `collapsible-section.tsx`, update button className:

```tsx
className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring touch-manipulation min-h-[44px]"
```

**Step 3: Test on mobile/responsive mode**

Run: `npm run dev`
Open: http://localhost:3000 in browser
Test: Resize to mobile viewport, verify 44px touch targets

**Step 4: Commit**

```bash
git add src/components/dashboard/task-item.tsx src/components/dashboard/collapsible-section.tsx
git commit -m "style(dashboard): add mobile touch optimizations

Ensures 44px minimum touch targets and touch-manipulation CSS.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 13: Add Responsive Spacing

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Step 1: Update spacing classes**

Update the main content div spacing (currently line 150):

```tsx
<div className="space-y-3 p-3 lg:space-y-6 lg:p-6">
```

Ensure all section components use responsive spacing:
- Mobile: `space-y-3`, `p-3`, `gap-2`
- Desktop: `lg:space-y-6`, `lg:p-6`, `lg:gap-3`

**Step 2: Verify responsive layout**

Run: `npm run dev`
Test: Resize browser from 320px to 1920px, verify smooth transitions

**Step 3: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "style(dashboard): improve responsive spacing

Mobile-first spacing with larger gaps on desktop.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 7: Testing & Polish

### Task 14: Test Complete Workflow

**Files:**
- None (manual testing)

**Step 1: Test task workflow**

1. Open dashboard
2. Click "Add task" in Today's Tasks
3. Enter task title, select priority
4. Submit and verify task appears
5. Click checkbox to complete task
6. Verify task marked as completed

**Step 2: Test captures workflow**

1. Expand Unprocessed Captures
2. Click "→ Note" on a capture
3. Verify redirected to new note
4. Verify capture removed from list

**Step 3: Test insights workflow**

1. Expand AI Insights
2. Click refresh button
3. Verify loading state
4. Click "→ Create Note" on insight
5. Verify redirected to new note

**Step 4: Test collapsible sections**

1. Expand/collapse each section
2. Refresh page
3. Verify states persist via localStorage

**Step 5: Test mobile responsive**

1. Resize to 375px width
2. Verify all elements visible and usable
3. Test touch interactions
4. Verify no horizontal scroll

**Step 6: Document any issues**

Note any bugs or improvements needed in a comment for follow-up.

---

### Task 15: Final Commit & Documentation

**Files:**
- Modify: `docs/plans/2026-02-06-dashboard-redesign-implementation.md`

**Step 1: Update implementation doc status**

Add to top of implementation doc:

```markdown
**Status:** ✅ Complete
**Completion Date:** [current date]
**Deployed:** [Yes/No]
```

**Step 2: Final commit**

```bash
git add docs/plans/2026-02-06-dashboard-redesign-implementation.md
git commit -m "docs: mark dashboard redesign implementation complete

All phases implemented: knowledge graph removed, tasks sections added,
inbox integrated, mobile optimized.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 3: Push to remote (if ready)**

Run: `git push origin main`

---

## Summary

**Total Tasks:** 15
**Estimated Time:** 2-3 hours
**Key Deliverables:**
- ✅ Removed broken knowledge graph
- ✅ Added Today's Tasks and Scheduled Tasks sections
- ✅ Integrated inbox (captures + insights) into dashboard
- ✅ Mobile-optimized with touch targets and responsive spacing
- ✅ Reusable components (TaskItem, CollapsibleSection)
- ✅ localStorage persistence for section states
- ✅ Deleted old inbox page

**Testing Checklist:**
- [ ] Dashboard loads without errors
- [ ] Tasks can be added, completed, deleted
- [ ] Captures can be converted to notes/tasks
- [ ] Insights can be refreshed and converted to notes
- [ ] Sections expand/collapse and persist state
- [ ] Mobile responsive (320px - 1920px)
- [ ] Touch targets meet 44px minimum
- [ ] No horizontal scroll on mobile

**Follow-up Work:**
- Add swipe gestures for task actions
- Implement pull-to-refresh for insights
- Add keyboard shortcuts
- Restore knowledge graph after fixing errors
- Add unit tests for components
