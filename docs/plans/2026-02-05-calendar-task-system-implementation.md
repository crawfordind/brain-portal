# Calendar & Task Management System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement calendar view with time-blocking, Kanban board, and estimation learning system for task management.

**Architecture:** Extend existing task schema with scheduling fields, build three shared components (TaskCard, TaskFilter, TaskDetailPanel), create Calendar and Kanban views with React Query state management, add estimation learning system with insights dashboard.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, @dnd-kit/core, shadcn/ui, Tailwind CSS, Turso SQLite

---

## Full Plan Structure

This implementation plan consists of 22 tasks across 4 phases. Each task follows strict TDD:
1. Write failing test
2. Run to confirm failure
3. Implement minimal code
4. Run to confirm pass
5. Commit with descriptive message

**Detailed task breakdowns** are in separate part files:
- `2026-02-05-calendar-task-system-implementation-PART1.md` (Tasks 1-4)
- `2026-02-05-calendar-task-system-implementation-PART2.md` (Tasks 5-8)
- Tasks 9-22 detailed below

---

## Implementation Summary

### Phase 1: Foundation (Tasks 1-6)

1. ✅ **Database Migration** - Add `scheduled_at`, `estimated_completion_date`, `estimation_accuracy` fields
2. ✅ **TypeScript Types** - Create shared `Task`, `EstimationAccuracy`, `TaskFilters` types
3. ✅ **Dependencies** - Install `@dnd-kit/*` and `date-fns-tz`
4. ✅ **TaskCard Component** - Reusable card with priority borders, date badges, project labels
5. ✅ **TaskFilter Component** - Unified project filter dropdown
6. ✅ **TaskDetailPanel Component** - Slide-over with quick actions

*See PART1.md and PART2.md for detailed steps*

---

### Phase 2: Views (Tasks 7-11)

7. ✅ **API Date Queries** - Add `start/end` and `completedSince` params

*See PART2.md for detailed steps*

8. ✅ **Reschedule Endpoint** - `PATCH /api/tasks/[id]/reschedule`

*See PART2.md for detailed steps*

#### Task 9: Calendar View Component

**Files:**
- Create: `src/components/tasks/task-calendar-view.tsx`
- Create: `src/lib/tasks/calendar-utils.ts`
- Create: `tests/lib/tasks/calendar-utils.test.ts`

**Key Features:**
- Week-based layout (Mon-Sun)
- Time slots 6 AM - 10 PM
- Unscheduled tasks section
- Week navigation (prev/today/next)
- Drag-and-drop rescheduling
- React Query data fetching

**Utility Functions** (`calendar-utils.ts`):
```typescript
export function getWeekDays(startDate: Date): Date[];
export function getTimeSlots(): string[]; // ["06:00", "07:00", ...]
export function isTaskInTimeSlot(task: Task, day: Date, slotTime: string): boolean;
export function getWeekRange(startDate: Date): { start: string; end: string };
export function getUnscheduledTasksForDay(tasks: Task[], day: Date): Task[];
```

**Tests:** Week day generation, time slots, task filtering, date ranges

**Commit:** "feat(tasks): create Calendar View component"

---

#### Task 10: Kanban View Component

**Files:**
- Create: `src/components/tasks/task-kanban-view.tsx`
- Create: `src/hooks/use-task-drag.ts`
- Create: `tests/hooks/use-task-drag.test.ts`

**Key Features:**
- Three columns: To Do, In Progress, Completed
- Drag-and-drop between columns
- Auto-fill `completed_at` when dragged to Completed
- Task count badges
- Muted completed column styling

**Drag Hook** (`use-task-drag.ts`):
```typescript
export function useTaskDrag(onDrop?: (taskId: string, newStatus: string) => void) {
  // Returns sensors and handleDragEnd
  // Uses @dnd-kit/core with PointerSensor and KeyboardSensor
}
```

**Tests:** Drag sensors, drop handling, status change prevention

**Commit:** "feat(tasks): create Kanban View component"

---

#### Task 11: Update Tasks Page with View Navigation

**Files:**
- Modify: `src/app/(dashboard)/tasks/page.tsx`

**Changes:**
- Add Tabs component with List/Calendar/Kanban
- URL state persistence (`?view=calendar`)
- Shared TaskFilter across all views
- Conditional rendering based on selected view

**Commit:** "feat(tasks): add view navigation to tasks page"

---

### Phase 3: Intelligence (Tasks 12-15)

#### Task 12: Estimation Accuracy Calculator

**Files:**
- Create: `src/lib/tasks/estimation.ts`
- Create: `tests/lib/tasks/estimation.test.ts`

**Functions:**
```typescript
export function calculateVarianceDays(estimated: string, actual: string): number;
export function calculateEstimationAccuracy(task: Task): EstimationAccuracy | null;
export function getEstimationInsights(tasks: Task[]): {
  averageVarianceDays: number;
  totalTasksWithEstimates: number;
  suggestion: string;
};
export function getProjectEstimationInsights(tasks: Task[], projectId: string);
```

**Tests:** Variance calculation (early/late/exact), insights generation, suggestions

**Commit:** "feat(tasks): add estimation accuracy calculator"

---

#### Task 13: Update Task Completion to Store Accuracy

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts`

**Changes:**
- In PATCH handler, detect completion with estimated date
- Call `calculateEstimationAccuracy()`
- Store result in `estimation_accuracy` JSON field

**Commit:** "feat(api): auto-calculate estimation accuracy on completion"

---

#### Task 14: Task Insights API

**Files:**
- Create: `src/app/api/tasks/insights/route.ts`
- Create: `tests/api/tasks/insights.test.ts`

**Endpoint:** `GET /api/tasks/insights?project=<id>`

**Response:**
```typescript
{
  insights: {
    averageVarianceDays: number;
    totalTasksWithEstimates: number;
    suggestion: string;
  },
  projectBreakdown: Record<string, InsightsData> | null,
  recentTasks: Task[]; // Last 10
}
```

**Commit:** "feat(api): add task insights endpoint"

---

#### Task 15: Insights Dashboard Component

**Files:**
- Create: `src/components/tasks/task-insights.tsx`
- Modify: `src/app/(dashboard)/tasks/page.tsx`

**Features:**
- Average variance with trend indicator
- Helpful suggestions
- Per-project accuracy breakdown
- Side panel on tasks page

**Commit:** "feat(tasks): add estimation insights dashboard"

---

### Phase 4: Polish (Tasks 16-22)

#### Task 16: Completed Tasks Filter

**Files:**
- Create: `src/components/tasks/completed-filter.tsx`
- Modify: `src/components/tasks/task-calendar-view.tsx`
- Modify: `src/components/tasks/task-kanban-view.tsx`

**Options:** Today, Last 7 days, Last 30 days, All time (default: 7d)

**Commit:** "feat(tasks): add completed tasks filter"

---

#### Task 17: Keyboard Navigation

**Files:**
- Create: `src/hooks/use-keyboard-nav.ts`
- Create: `tests/hooks/use-keyboard-nav.test.ts`
- Modify: Calendar/Kanban views

**Keys:**
- Arrow keys: Navigate weeks/days
- Enter/Space: Select task
- Escape: Close panels
- Disabled when typing in inputs

**Commit:** "feat(tasks): add keyboard navigation"

---

#### Task 18: ARIA Labels and Screen Reader Support

**Files:**
- Modify: `src/components/tasks/task-card.tsx`
- Modify: `src/components/tasks/task-calendar-view.tsx`
- Modify: `src/components/tasks/task-kanban-view.tsx`

**Additions:**
- `aria-label` on TaskCard with full task context
- `role="grid"` on Calendar
- `role="region"` on Kanban columns
- `aria-live="polite"` for status changes

**Commit:** "feat(a11y): add ARIA labels and screen reader support"

---

#### Task 19: Mobile Optimizations

**Files:**
- Create: `src/hooks/use-media-query.ts`
- Modify: Calendar and Kanban views

**Changes:**
- `useMediaQuery("(max-width: 768px)")`
- Calendar shows 2 days on mobile
- Kanban stacks columns vertically
- Touch-friendly interactions

**Commit:** "feat(mobile): optimize calendar and kanban for mobile"

---

#### Task 20: Performance Testing

**Files:**
- Create: `tests/performance/task-rendering.test.ts`
- Modify: `src/components/tasks/task-card.tsx` (add `React.memo`)

**Target:** Render 100 tasks in <200ms

**Optimizations:**
- Memoize TaskCard
- Consider virtualization for 1000+ tasks

**Commit:** "feat(perf): add performance testing and optimizations"

---

#### Task 21: Documentation

**Files:**
- Create: `docs/features/task-management.md`
- Modify: `README.md`

**Content:**
- Feature overview
- API endpoints reference
- Database schema
- Usage examples
- Keyboard shortcuts

**Commit:** "docs: add task management documentation"

---

#### Task 22: Final Integration Test

**Files:**
- Create: `scripts/test-task-system.ts`

**Test Flow:**
1. Create task with scheduling fields
2. Verify scheduled_at, estimated_completion_date
3. Complete task
4. Check estimation_accuracy calculated
5. Cleanup

**Run:**
```bash
npx tsx scripts/test-task-system.ts
npm test
npm run typecheck
npm run lint
```

**Commit:** "test: add task system integration test"

---

## Execution Options

**Option 1: Subagent-Driven (current session)**
- Use: `superpowers:subagent-driven-development`
- I dispatch fresh subagent per task
- Review between tasks
- Fast iteration

**Option 2: Parallel Session (new session)**
- Use: `superpowers:executing-plans`
- Open new session in worktree
- Batch execution with checkpoints
- Work continues independently

---

## Success Criteria

- ✅ All 22 tasks completed with passing tests
- ✅ Calendar view renders week with time slots
- ✅ Kanban drag-and-drop works smoothly
- ✅ Estimation accuracy tracks and displays insights
- ✅ Mobile responsive (768px breakpoint)
- ✅ Keyboard accessible
- ✅ Performance: 100 tasks render <200ms
- ✅ All tests passing
- ✅ Documentation complete

---

**Total Estimated Time:** 10-15 hours for full implementation
**Commits:** 22 (one per task)
**Tests:** ~50 new tests
**Code:** ~3000 lines

Ready to execute!