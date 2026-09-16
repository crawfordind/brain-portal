# Calendar & Task Management System Implementation Plan - Part 1

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement calendar view with time-blocking, Kanban board, and estimation learning system for task management.

**Architecture:** Extend existing task schema with scheduling fields, build three shared components (TaskCard, TaskFilter, TaskDetailPanel), create Calendar and Kanban views with React Query state management, add estimation learning system with insights dashboard.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, @dnd-kit/core, shadcn/ui, Tailwind CSS, Turso SQLite

---

## Phase 1: Foundation (Tasks 1-6)

This plan follows strict TDD: Write failing test → Run to confirm failure → Implement minimal code → Run to confirm pass → Commit

---

### Task 1: Database Migration

**Goal:** Add `scheduled_at`, `estimated_completion_date`, and `estimation_accuracy` fields to tasks table.

**Files:**
- Create: `scripts/migrations/006-add-task-scheduling-fields.ts`
- Modify: `src/lib/db/schema.ts:137-152`

**Step 1: Write migration script**

Create `scripts/migrations/006-add-task-scheduling-fields.ts`:

```typescript
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log("Adding scheduling fields to tasks table...");

  try {
    // Add scheduled_at field
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN scheduled_at TEXT;
    `);
    console.log("✓ Added scheduled_at");

    // Add estimated_completion_date field
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN estimated_completion_date TEXT;
    `);
    console.log("✓ Added estimated_completion_date");

    // Add estimation_accuracy field (JSON)
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN estimation_accuracy TEXT;
    `);
    console.log("✓ Added estimation_accuracy");

    // Add index for scheduled tasks
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
    `);
    console.log("✓ Added index on scheduled_at");

    // Add index for estimated completion
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_estimated ON tasks(estimated_completion_date);
    `);
    console.log("✓ Added index on estimated_completion_date");

    console.log("\n✅ Migration complete");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await db.close();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
```

**Step 2: Update schema.ts**

Modify `src/lib/db/schema.ts` around line 137-158, updating the tasks table definition:

```typescript
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date TEXT,
  scheduled_at TEXT,
  estimated_completion_date TEXT,
  completed_at TEXT,
  estimation_accuracy TEXT,
  position INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_estimated ON tasks(estimated_completion_date);
```

**Step 3: Run migration**

```bash
npx tsx scripts/migrations/006-add-task-scheduling-fields.ts
```

Expected output:
```
Adding scheduling fields to tasks table...
✓ Added scheduled_at
✓ Added estimated_completion_date
✓ Added estimation_accuracy
✓ Added index on scheduled_at
✓ Added index on estimated_completion_date

✅ Migration complete
```

**Step 4: Verify migration**

```bash
npx tsx -e "
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN
});
const result = await db.execute('PRAGMA table_info(tasks)');
const newColumns = result.rows.filter(r =>
  ['scheduled_at', 'estimated_completion_date', 'estimation_accuracy'].includes(r.name as string)
);
console.log('New columns:', newColumns);
await db.close();
"
```

Expected: Shows 3 new columns with type TEXT

**Step 5: Commit**

```bash
git add scripts/migrations/006-add-task-scheduling-fields.ts src/lib/db/schema.ts
git commit -m "feat(db): add scheduling fields to tasks table

- Add scheduled_at for time-blocking
- Add estimated_completion_date for learning system
- Add estimation_accuracy JSON field
- Add indexes for performance

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Update Task TypeScript Interface

**Goal:** Create shared Task type with new scheduling fields.

**Files:**
- Create: `src/types/task.ts`
- Modify: `src/app/(dashboard)/tasks/page.tsx:40-57`

**Step 1: Create shared Task type**

Create `src/types/task.ts`:

```typescript
export interface Task {
  id: string;
  user_id: string;
  note_id: string | null;
  project_id: string | null;
  content: string;
  title: string | null;
  description: string | null;
  delegated_to: string | null;
  agent_task_id: string | null;
  linked_note_ids: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string | null;
  scheduled_at: string | null;
  estimated_completion_date: string | null;
  completed_at: string | null;
  estimation_accuracy: string | null;
  position: number;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  project_name: string | null;
  note_title: string | null;
  note_slug: string | null;
}

export interface EstimationAccuracy {
  estimated: string; // ISO date
  actual: string; // ISO date
  variance_days: number;
}

export interface TaskFilters {
  status?: "all" | "open" | "completed";
  project?: string;
  assignee?: "all" | "user" | "ai";
  dateRange?: {
    start: string;
    end: string;
  };
}
```

**Step 2: Update tasks page imports**

Modify `src/app/(dashboard)/tasks/page.tsx`:

Find the Task interface definition (around lines 40-57) and replace with:

```typescript
import { Task } from "@/types/task";

// Remove the local Task interface definition (lines 40-57)
```

**Step 3: Verify TypeScript compilation**

```bash
npm run typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
git add src/types/task.ts src/app/(dashboard)/tasks/page.tsx
git commit -m "feat(types): create shared Task type with scheduling fields

- Centralized Task interface
- EstimationAccuracy type for learning system
- TaskFilters type for query params

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Install Dependencies

**Goal:** Install drag-and-drop library and date utilities.

**Files:**
- Modify: `package.json`, `package-lock.json`

**Step 1: Install @dnd-kit packages**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: Packages installed successfully

**Step 2: Install date-fns-tz**

```bash
npm install date-fns-tz
```

Expected: Package installed successfully

**Step 3: Verify installation**

```bash
npm list @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities date-fns-tz
```

Expected output shows all packages with versions

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): install dnd-kit and date-fns-tz

- @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities for drag-and-drop
- date-fns-tz for timezone handling in calendar

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Create TaskCard Component

**Goal:** Reusable task card component for all views (list, calendar, kanban).

**Files:**
- Create: `src/components/tasks/task-card.tsx`
- Create: `tests/components/tasks/task-card.test.tsx`

**Step 1: Write failing test**

Create `tests/components/tasks/task-card.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCard } from "@/components/tasks/task-card";
import type { Task } from "@/types/task";

const mockTask: Task = {
  id: "task-1",
  user_id: "user-1",
  note_id: null,
  project_id: null,
  content: "Test task",
  title: "Test task",
  description: null,
  delegated_to: null,
  agent_task_id: null,
  linked_note_ids: "[]",
  status: "pending",
  priority: "medium",
  due_date: null,
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

describe("TaskCard", () => {
  it("renders task title", () => {
    render(<TaskCard task={mockTask} onClick={() => {}} />);
    expect(screen.getByText("Test task")).toBeInTheDocument();
  });

  it("shows priority indicator via border color", () => {
    render(<TaskCard task={mockTask} onClick={() => {}} />);
    const card = screen.getByRole("article");
    expect(card).toHaveClass("border-l-4");
  });

  it("displays due date when present", () => {
    const taskWithDue = { ...mockTask, due_date: "2024-03-15T00:00:00Z" };
    render(<TaskCard task={taskWithDue} onClick={() => {}} />);
    expect(screen.getByText(/mar/i)).toBeInTheDocument();
  });

  it("displays scheduled time when present", () => {
    const taskWithSchedule = { ...mockTask, scheduled_at: "2024-03-15T14:00:00Z" };
    render(<TaskCard task={taskWithSchedule} onClick={() => {}} />);
    expect(screen.getByText(/2:00 pm/i)).toBeInTheDocument();
  });

  it("shows project badge when assigned", () => {
    const taskWithProject = { ...mockTask, project_id: "proj-1", project_name: "My Project" };
    render(<TaskCard task={taskWithProject} onClick={() => {}} />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<TaskCard task={mockTask} onClick={onClick} />);
    fireEvent.click(screen.getByRole("article"));
    expect(onClick).toHaveBeenCalledWith(mockTask);
  });

  it("highlights overdue tasks", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const overdueTask = {
      ...mockTask,
      due_date: pastDate.toISOString(),
      completed_at: null,
    };
    render(<TaskCard task={overdueTask} onClick={() => {}} />);
    const card = screen.getByRole("article");
    expect(card).toHaveClass("ring-2", "ring-red-500");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/components/tasks/task-card.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/tasks/task-card'"

**Step 3: Write minimal implementation**

Create `src/components/tasks/task-card.tsx`:

```typescript
"use client";

import { format, parseISO, isPast, differenceInDays } from "date-fns";
import { Calendar, Clock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
  variant?: "list" | "calendar" | "kanban";
  className?: string;
}

const PRIORITY_BORDER_COLORS: Record<string, string> = {
  low: "border-l-gray-300",
  medium: "border-l-blue-500",
  high: "border-l-orange-500",
  urgent: "border-l-red-500",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 dark:bg-gray-800",
  in_progress: "bg-blue-50 dark:bg-blue-950",
  completed: "bg-green-50 dark:bg-green-950",
  cancelled: "bg-gray-50 dark:bg-gray-900",
};

export function TaskCard({ task, onClick, variant = "list", className }: TaskCardProps) {
  const isOverdue = task.due_date && !task.completed_at && isPast(parseISO(task.due_date));
  const daysUntilDue = task.due_date && task.scheduled_at
    ? differenceInDays(parseISO(task.due_date), parseISO(task.scheduled_at))
    : null;

  const handleClick = () => {
    if (onClick) onClick(task);
  };

  return (
    <article
      role="article"
      onClick={handleClick}
      tabIndex={0}
      className={cn(
        "border-l-4 rounded-lg p-3 cursor-pointer transition-all hover:shadow-md",
        PRIORITY_BORDER_COLORS[task.priority],
        STATUS_COLORS[task.status],
        isOverdue && "ring-2 ring-red-500",
        task.status === "completed" && "opacity-60",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Title */}
      <h3 className="font-semibold text-sm mb-2">{task.title || task.content}</h3>

      {/* Project Badge */}
      {task.project_name && (
        <Badge variant="secondary" className="mb-2">
          {task.project_name}
        </Badge>
      )}

      {/* Date Badges */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {/* Due Date */}
        {task.due_date && (
          <div className={cn("flex items-center gap-1", isOverdue && "text-red-600")}>
            <Calendar className="h-3 w-3" />
            <span>{format(parseISO(task.due_date), "MMM d")}</span>
            {isOverdue && <AlertCircle className="h-3 w-3" />}
          </div>
        )}

        {/* Scheduled Time */}
        {task.scheduled_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{format(parseISO(task.scheduled_at), "h:mm a")}</span>
          </div>
        )}

        {/* Days Until Due */}
        {daysUntilDue !== null && daysUntilDue > 0 && (
          <Badge variant="outline" className="text-xs">
            {daysUntilDue}d until due
          </Badge>
        )}

        {/* Estimated Completion */}
        {task.estimated_completion_date && (
          <div className="flex items-center gap-1 text-blue-600">
            <Clock className="h-3 w-3" />
            <span>Est: {format(parseISO(task.estimated_completion_date), "MMM d")}</span>
          </div>
        )}
      </div>
    </article>
  );
}
```

**Step 4: Run test to verify it passes**

```bash
npm test tests/components/tasks/task-card.test.tsx
```

Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/components/tasks/task-card.tsx tests/components/tasks/task-card.test.tsx
git commit -m "feat(tasks): create TaskCard component

- Reusable across list, calendar, kanban views
- Priority indicator via left border color
- Displays due date, scheduled time, estimated completion
- Highlights overdue tasks with red ring
- Shows project badge if assigned
- Keyboard accessible (Enter/Space)

Tests: 7 passing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

Continue in Part 2...