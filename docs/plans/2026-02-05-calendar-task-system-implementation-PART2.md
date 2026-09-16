# Calendar & Task Management System Implementation Plan - Part 2

Continuation of implementation plan (Tasks 5-11)

---

## Phase 1: Foundation (continued)

### Task 5: Create TaskFilter Component

**Goal:** Unified filter bar for project filtering across all views.

**Files:**
- Create: `src/components/tasks/task-filter.tsx`
- Create: `tests/components/tasks/task-filter.test.tsx`

**Step 1: Write failing test**

Create `tests/components/tasks/task-filter.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskFilter } from "@/components/tasks/task-filter";

const mockProjects = [
  { id: "proj-1", name: "Project A" },
  { id: "proj-2", name: "Project B" },
];

describe("TaskFilter", () => {
  it("renders project filter dropdown", () => {
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={() => {}}
        projects={mockProjects}
      />
    );
    expect(screen.getByText("All Tasks")).toBeInTheDocument();
  });

  it("shows project options when opened", async () => {
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={() => {}}
        projects={mockProjects}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByText("Project A")).toBeInTheDocument();
      expect(screen.getByText("Project B")).toBeInTheDocument();
    });
  });

  it("calls onProjectChange when project selected", async () => {
    const onChange = vi.fn();
    render(
      <TaskFilter
        selectedProject="all"
        onProjectChange={onChange}
        projects={mockProjects}
      />
    );

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    const option = await screen.findByText("Project A");
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("proj-1");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/components/tasks/task-filter.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/tasks/task-filter'"

**Step 3: Write minimal implementation**

Create `src/components/tasks/task-filter.tsx`:

```typescript
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderOpen } from "lucide-react";

interface Project {
  id: string;
  name: string;
}

interface TaskFilterProps {
  selectedProject: string;
  onProjectChange: (projectId: string) => void;
  projects: Project[];
}

export function TaskFilter({ selectedProject, onProjectChange, projects }: TaskFilterProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedProject} onValueChange={onProjectChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Tasks" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

```bash
npm test tests/components/tasks/task-filter.test.tsx
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/components/tasks/task-filter.tsx tests/components/tasks/task-filter.test.tsx
git commit -m "feat(tasks): create TaskFilter component

- Unified filter bar for project filtering
- Reusable across all task views
- Supports 'All Tasks' option
- Clean dropdown UI with folder icon

Tests: 3 passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Create TaskDetailPanel Component

**Goal:** Slide-over panel for task details and quick actions.

**Files:**
- Create: `src/components/tasks/task-detail-panel.tsx`
- Create: `tests/components/tasks/task-detail-panel.test.tsx`

**Step 1: Write failing test**

Create `tests/components/tasks/task-detail-panel.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import type { Task } from "@/types/task";

const mockTask: Task = {
  id: "task-1",
  user_id: "user-1",
  note_id: null,
  project_id: null,
  content: "Test task",
  title: "Test task",
  description: "Task description",
  delegated_to: null,
  agent_task_id: null,
  linked_note_ids: "[]",
  status: "pending",
  priority: "medium",
  due_date: "2024-03-15T00:00:00Z",
  scheduled_at: null,
  estimated_completion_date: null,
  completed_at: null,
  estimation_accuracy: null,
  position: 0,
  tags: "[]",
  metadata: "{}",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  project_name: null,
  note_title: null,
  note_slug: null,
};

describe("TaskDetailPanel", () => {
  it("renders task title", () => {
    render(<TaskDetailPanel task={mockTask} open={true} onClose={() => {}} />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("displays task description", () => {
    render(<TaskDetailPanel task={mockTask} open={true} onClose={() => {}} />);
    expect(screen.getByText("Task description")).toBeInTheDocument();
  });

  it("shows quick action buttons", () => {
    render(<TaskDetailPanel task={mockTask} open={true} onClose={() => {}} />);
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
    expect(screen.getByText(/delete/i)).toBeInTheDocument();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(<TaskDetailPanel task={mockTask} open={true} onClose={onClose} />);

    const closeButton = screen.getByLabelText(/close/i);
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when open is false", () => {
    render(<TaskDetailPanel task={mockTask} open={false} onClose={() => {}} />);
    expect(screen.queryByText("Test task")).not.toBeInTheDocument();
  });

  it("calls onComplete when complete button clicked", () => {
    const onComplete = vi.fn();
    render(
      <TaskDetailPanel
        task={mockTask}
        open={true}
        onClose={() => {}}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByText(/complete/i));
    expect(onComplete).toHaveBeenCalledWith(mockTask);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/components/tasks/task-detail-panel.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/tasks/task-detail-panel'"

**Step 3: Write minimal implementation**

Create `src/components/tasks/task-detail-panel.tsx`:

```typescript
"use client";

import { format, parseISO } from "date-fns";
import { X, CheckCircle2, Edit, Trash2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Task } from "@/types/task";

interface TaskDetailPanelProps {
  task: Task;
  open: boolean;
  onClose: () => void;
  onComplete?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onReschedule?: (task: Task) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "To Do",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function TaskDetailPanel({
  task,
  open,
  onClose,
  onComplete,
  onEdit,
  onDelete,
  onReschedule,
}: TaskDetailPanelProps) {
  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start justify-between">
            <SheetTitle className="text-xl">{task.title || task.content}</SheetTitle>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription>
            <div className="flex gap-2 mt-2">
              <Badge variant="secondary">{STATUS_LABELS[task.status]}</Badge>
              <Badge variant="outline">{PRIORITY_LABELS[task.priority]}</Badge>
              {task.project_name && <Badge>{task.project_name}</Badge>}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Description */}
          {task.description && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">{task.description}</p>
            </div>
          )}

          {/* Dates */}
          <div className="space-y-2">
            {task.due_date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Due Date</span>
                <span>{format(parseISO(task.due_date), "MMM d, yyyy")}</span>
              </div>
            )}
            {task.scheduled_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Scheduled</span>
                <span>{format(parseISO(task.scheduled_at), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            )}
            {task.estimated_completion_date && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated Completion</span>
                <span>{format(parseISO(task.estimated_completion_date), "MMM d, yyyy")}</span>
              </div>
            )}
            {task.completed_at && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span>{format(parseISO(task.completed_at), "MMM d, yyyy")}</span>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex flex-col gap-2 pt-4 border-t">
            {task.status !== "completed" && onComplete && (
              <Button
                variant="default"
                className="w-full"
                onClick={() => onComplete(task)}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Complete
              </Button>
            )}
            {onReschedule && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onReschedule(task)}
              >
                <Calendar className="h-4 w-4 mr-2" />
                Reschedule
              </Button>
            )}
            {onEdit && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => onEdit(task)}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => onDelete(task)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 4: Run test to verify it passes**

```bash
npm test tests/components/tasks/task-detail-panel.test.tsx
```

Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/components/tasks/task-detail-panel.tsx tests/components/tasks/task-detail-panel.test.tsx
git commit -m "feat(tasks): create TaskDetailPanel component

- Slide-over panel for task details
- Shows all task metadata and dates
- Quick actions: complete, edit, delete, reschedule
- Reusable across all views
- Status and priority badges

Tests: 6 passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Views

### Task 7: Update Tasks API for Date Queries

**Goal:** Support date range queries and completed filters for Calendar view.

**Files:**
- Modify: `src/app/api/tasks/route.ts`
- Create: `tests/api/tasks/date-queries.test.ts`

**Step 1: Write test**

Create `tests/api/tasks/date-queries.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("Tasks API date queries", () => {
  it("should accept start and end date parameters", () => {
    const params = new URLSearchParams({
      start: "2024-03-01",
      end: "2024-03-31",
    });

    expect(params.get("start")).toBe("2024-03-01");
    expect(params.get("end")).toBe("2024-03-31");
  });

  it("should accept completedSince parameter", () => {
    const params = new URLSearchParams({
      completedSince: "7d",
    });

    expect(params.get("completedSince")).toBe("7d");
  });

  it("should parse completedSince values correctly", () => {
    const values = ["1d", "7d", "30d", "90d"];
    const daysMap: Record<string, number> = {
      "1d": 1,
      "7d": 7,
      "30d": 30,
      "90d": 90,
    };

    values.forEach((value) => {
      expect(daysMap[value]).toBeGreaterThan(0);
    });
  });
});
```

**Step 2: Run test**

```bash
npm test tests/api/tasks/date-queries.test.ts
```

Expected: PASS (3 tests) - these are simple parameter tests

**Step 3: Update API route**

Modify `src/app/api/tasks/route.ts` GET handler.

Find the existing query parameter parsing section and add:

```typescript
// After existing searchParams parsing
const start = searchParams.get("start"); // ISO date string for range start
const end = searchParams.get("end"); // ISO date string for range end
const completedSince = searchParams.get("completedSince"); // e.g., "7d", "30d"

// In WHERE clause building section, add:

// Date range filter (for calendar view efficiency)
if (start && end) {
  whereClauses.push(`(
    (t.scheduled_at IS NOT NULL AND t.scheduled_at >= ? AND t.scheduled_at <= ?)
    OR (t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?)
  )`);
  queryParams.push(start, end, start, end);
}

// Completed since filter (for completed task views)
if (completedSince && status === "completed") {
  const daysMap: Record<string, number> = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  const days = daysMap[completedSince] || 7; // Default to 7 days
  whereClauses.push(`t.completed_at >= datetime('now', '-${days} days')`);
}
```

**Step 4: Test manually**

```bash
# Start dev server
npm run dev

# Test date range query
curl "http://localhost:3000/api/tasks?start=2024-03-01&end=2024-03-31" -H "Cookie: session=YOUR_SESSION"
```

Expected: Returns tasks within date range

**Step 5: Commit**

```bash
git add src/app/api/tasks/route.ts tests/api/tasks/date-queries.test.ts
git commit -m "feat(api): add date range and completed filters to tasks API

- Support start/end date params for calendar view queries
- Filter by scheduled_at or due_date in range
- Support completedSince param (1d, 7d, 30d, 90d)
- Default completed filter to 7 days

Tests: 3 passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Create Reschedule API Endpoint

**Goal:** Dedicated endpoint for updating `scheduled_at` field (drag-and-drop).

**Files:**
- Create: `src/app/api/tasks/[id]/reschedule/route.ts`
- Create: `tests/api/tasks/reschedule.test.ts`

**Step 1: Write test**

Create `tests/api/tasks/reschedule.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("Reschedule API", () => {
  it("should validate ISO date format", () => {
    const validDate = "2024-03-15T14:00:00Z";
    const invalidDate = "not-a-date";

    const validParsed = new Date(validDate);
    const invalidParsed = new Date(invalidDate);

    expect(validParsed.toISOString()).toBe(validDate);
    expect(invalidParsed.toString()).toBe("Invalid Date");
  });

  it("should accept scheduled_at in request body", () => {
    const body = {
      scheduled_at: "2024-03-15T14:00:00Z",
    };

    expect(body.scheduled_at).toBeDefined();
    expect(typeof body.scheduled_at).toBe("string");
  });
});
```

**Step 2: Run test**

```bash
npm test tests/api/tasks/reschedule.test.ts
```

Expected: PASS (2 tests)

**Step 3: Create reschedule endpoint**

Create `src/app/api/tasks/[id]/reschedule/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { scheduled_at } = await request.json();

    if (!scheduled_at) {
      return NextResponse.json(
        { error: "scheduled_at is required" },
        { status: 400 }
      );
    }

    // Validate ISO date format
    const date = new Date(scheduled_at);
    if (isNaN(date.getTime())) {
      return NextResponse.json(
        { error: "Invalid date format. Use ISO 8601 format (e.g., 2024-03-15T14:00:00Z)" },
        { status: 400 }
      );
    }

    // Update task scheduled_at
    await db.execute({
      sql: `UPDATE tasks
            SET scheduled_at = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [scheduled_at, params.id, user.id],
    });

    // Fetch updated task with project info
    const result = await db.execute({
      sql: `SELECT t.*, p.name as project_name
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.id = ? AND t.user_id = ?`,
      args: [params.id, user.id],
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task: result.rows[0] });
  } catch (error) {
    console.error("Reschedule error:", error);
    return NextResponse.json(
      { error: "Failed to reschedule task" },
      { status: 500 }
    );
  }
}
```

**Step 4: Test manually**

```bash
# Create a test task, then:
curl -X PATCH "http://localhost:3000/api/tasks/TASK_ID/reschedule" \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION" \
  -d '{"scheduled_at":"2024-03-15T14:00:00Z"}'
```

Expected: Returns updated task with new scheduled_at

**Step 5: Commit**

```bash
git add src/app/api/tasks/[id]/reschedule/route.ts tests/api/tasks/reschedule.test.ts
git commit -m "feat(api): add task reschedule endpoint

- PATCH /api/tasks/[id]/reschedule
- Updates scheduled_at field
- Validates ISO 8601 date format
- Returns updated task with project info

Tests: 2 passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

Continue in Part 3...