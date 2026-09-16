# Calendar & Task Management System Design

**Date**: 2026-02-05
**Status**: Approved
**Goal**: Build an intuitive calendar view with task management system featuring time-blocking, deadline tracking, Kanban boards, and AI-powered estimation learning.

---

## Requirements

- **Calendar view** with time-blocking and deadline tracking (hybrid approach)
- **Task dates**: Creation date, estimated completion date, scheduled time, due date, actual completion
- **Completed tasks** in separate filterable view
- **Kanban board** with status-based columns
- **Reusable components** that work on main tasks page and embedded in project pages
- **Learning system** to track estimation accuracy and provide insights
- **Beautiful, intuitive UX** for "the most intuitive AI-driven note-taking app on the market"

---

## Part 1: Architecture & Navigation

### Overall Structure

The system consists of three main views accessible via sidebar navigation under the Tasks section: **List View** (current), **Calendar View** (new), and **Kanban View** (new). All three views share the same underlying task data and filtering logic but present it differently.

### Dual-Mode Component Architecture

Each view component accepts an optional `projectId` prop. When `projectId` is null (main tasks page at `/tasks`), the component renders in "full mode" with a unified filter bar at the top showing "All Tasks" with a dropdown to select specific projects. When `projectId` is provided (project page at `/projects/[id]`), the component renders in "embedded mode" - same visualization but filtered to that project with no filter UI shown, creating a cleaner embedded experience.

### Navigation Flow

Users navigate between views via a tab bar or segmented control in the sidebar: "List | Calendar | Kanban". The selected view persists in URL state (`/tasks?view=calendar`), so refreshing maintains context. Project filtering state is also URL-based (`/tasks?view=calendar&project=abc123`), enabling shareable links and browser back/forward navigation.

### Database Schema Additions

Add two new optional fields to the existing tasks table:
- `scheduled_at TEXT` - For time-blocked tasks (hybrid approach)
- `estimated_completion_date TEXT` - For learning system tracking

The existing `due_date` remains for deadline tracking. This keeps the hybrid approach flexible - tasks can have any combination of these dates.

---

## Part 2: Calendar View

### Layout & Display

The Calendar View uses a week-based layout (default) with a month view toggle. Each day column shows a timeline from 6 AM to 10 PM with hourly divisions. Time-blocked tasks (`scheduled_at` populated) appear as colored blocks at their scheduled time. Deadline-only tasks (`due_date` without `scheduled_at`) appear in a "Not Scheduled" section at the top of each day's column, visually distinct from time-blocked tasks.

### Task Representation

Time-blocked tasks show: title, project badge (if assigned), and duration indicator. Color-coding uses project colors when assigned, or status colors (gray for To Do, blue for In Progress) when no project. Overdue tasks have a red accent border. The task's priority is indicated by a subtle left border thickness (thin=low, medium=medium, thick=high/urgent).

### Interactions

- **Click** a task to open a slide-over panel with full details and quick actions (edit, complete, delete, reschedule)
- **Drag-and-drop** tasks between time slots to reschedule (updates `scheduled_at`)
- **Drag** unscheduled tasks from the top section onto the timeline to assign them time blocks
- **Double-click** an empty time slot to create a new task pre-filled with that date/time
- **Mobile**: Use long-press instead of drag-and-drop, with a modal picker for time selection

### Smart Features

- Tasks with both `due_date` and `scheduled_at` show days-until-due in the card
- If a task is scheduled after its due date, show a warning indicator
- The estimated completion date appears as a small badge if set, helping users learn their estimation accuracy over time

---

## Part 3: Kanban View

### Board Structure

The Kanban board displays three columns: **To Do**, **In Progress**, and **Completed**. Each column shows a count badge (e.g., "To Do (12)") and supports vertical scrolling independently. The Completed column is visually distinct with slightly muted styling to emphasize active work in the first two columns.

### Card Design

Each task card shows:
- **Title** (bold)
- **Project badge** (top-right corner if assigned)
- **Priority indicator** (colored left border)
- **Date badges** at the bottom:
  - Due date (red if overdue, orange if within 2 days, gray otherwise)
  - Scheduled time (calendar icon + time if `scheduled_at` exists)
  - Estimated completion (clock icon if set)

Cards have a clean, minimal design with ample padding for touch targets on mobile.

### Drag-and-Drop & Interactions

- **Drag** cards between columns to change status (To Do → In Progress → Completed)
- When dragging to Completed, the system auto-fills `completed_at` with current timestamp
- **Click** a card to open the same slide-over panel as Calendar View for consistency
- **Quick actions** on hover (desktop) or swipe (mobile): Edit, Delete, Schedule (opens calendar picker)

### Filtering & Grouping

- **Full mode** (main tasks page): Unified filter bar allows filtering by project
- **Optional grouping**: Group cards within columns by priority, showing "Urgent", "High", "Medium", "Low" sub-sections with task counts
- **Embedded mode** (project pages): No grouping shown - just the project's tasks in their respective status columns

---

## Part 4: Learning System & Component Architecture

### Estimation Learning System

When a task is marked complete, the system compares `estimated_completion_date` (if set) against `completed_at`. It calculates the variance in days and stores this in a new `estimation_accuracy` JSON field on the task:

```json
{
  "estimated": "2024-03-15",
  "actual": "2024-03-17",
  "variance_days": 2
}
```

Over time, the system builds a user profile showing:
- Average estimation accuracy across all tasks
- Per-project estimation accuracy
- Improvement trends

### Insights Dashboard

A dedicated "Insights" section (accessible from tasks page) displays:
- Average estimation variance
- Most accurate project
- Improvement trend over last 30/90 days
- Gentle suggestions like "You typically underestimate by 2 days - consider adding buffer time"

The system never nags, only provides data when users check insights voluntarily. This builds self-awareness without feeling judgmental.

### Completed Tasks Handling

When viewing Completed status (Kanban column or List filter), users can toggle "Show completed from: [Last 7 days ▼]" with options:
- Today
- Last 7 days (default)
- Last 30 days
- All time

Calendar View shows completed tasks with a checkmark overlay and muted opacity, allowing users to see what they accomplished that week without cluttering the view.

### Shared Component Architecture

Three shared components power the system:
- `<TaskCard>` - Renders task in any context (list, calendar, kanban)
- `<TaskFilter>` - Unified filter bar with project dropdown
- `<TaskDetailPanel>` - Slide-over for viewing/editing tasks

Each view component accepts `projectId?: string`:
- `<TaskListView projectId={projectId} />`
- `<TaskCalendarView projectId={projectId} />`
- `<TaskKanbanView projectId={projectId} />`

When `projectId` is provided, views skip rendering `<TaskFilter>` and pass the projectId filter to the underlying query.

---

## Part 5: Data Flow & API

### API Endpoints

**Extend existing `/api/tasks`:**
- `GET /api/tasks?view=calendar&start=2024-03-01&end=2024-03-31` - Date-ranged queries for Calendar View efficiency
- `GET /api/tasks?status=completed&completedSince=7d` - Filtered completed tasks
- `PATCH /api/tasks/[id]/reschedule` - Updates `scheduled_at` and logs the change for drag-and-drop operations

**New endpoints:**
- `GET /api/tasks/insights` - Calculate and return estimation accuracy metrics

### State Management

Use React Query (TanStack Query) for server state management. Each view maintains its own query key:
- `['tasks', 'list', filters]`
- `['tasks', 'calendar', dateRange, filters]`
- `['tasks', 'kanban', filters]`

When a task is updated (status change, reschedule, completion), invalidate all relevant queries to ensure all views stay in sync. Optimistic updates for drag-and-drop provide immediate feedback while the mutation processes in the background.

### Real-Time Sync

Since this is a personal knowledge management app (single user per session), polling isn't necessary. However, use React Query's automatic background refetching on window focus to catch any changes made in other tabs or devices. For collaborative features in the future, add a WebSocket connection or polling mechanism.

### Error Handling

- Wrap all drag-and-drop operations in try-catch with toast notifications
- If a mutation fails, React Query automatically rolls back the optimistic update
- Show user-friendly messages: "Couldn't reschedule task, please try again" rather than raw errors
- Log failed mutations to help diagnose issues
- For date validation, prevent users from scheduling tasks in the past (show warning) unless explicitly overriding

---

## Part 6: Testing, Accessibility & Implementation

### Testing Strategy

**Unit tests** for core logic:
- Date calculations
- Estimation variance computation
- Task filtering by project/status/date range

**Component tests** (Vitest + React Testing Library):
- Verify drag-and-drop updates state correctly
- Filter bar changes query params
- Completed toggle shows correct date ranges

**Integration tests** for critical flows:
- Create task → schedule on calendar → drag to new time → mark complete → verify appears in completed section

Mock date functions to ensure consistent test results.

### Accessibility

**Keyboard Navigation:**
- Tab through tasks
- Space/Enter to select
- Arrow keys to move between days in calendar
- Drag-and-drop alternatives: Focus task → press 'M' for move → arrow keys to select destination → Enter to confirm

**ARIA Labels:**
- `aria-label="Task: Review design, scheduled for 2PM"`
- `role="grid"` for calendar
- `aria-live="polite"` for status changes
- Announce updates: "Task moved to In Progress column"

**Visual:**
- Maintain 4.5:1 color contrast for all text and indicators
- Support screen readers

### Implementation Phases

**Phase 1 - Foundation:**
- Database migration for `scheduled_at` and `estimated_completion_date` fields
- Update task API to handle new fields
- Create shared components (`<TaskCard>`, `<TaskFilter>`, `<TaskDetailPanel>`)

**Phase 2 - Views:**
- Build Calendar View with drag-and-drop
- Implement Kanban View with status columns
- Add completed tasks filtering with date range toggle

**Phase 3 - Intelligence:**
- Implement learning system for estimation accuracy
- Build insights dashboard
- Add smart warnings for scheduling conflicts

**Phase 4 - Polish:**
- Mobile optimizations
- Accessibility audit and fixes
- Performance testing with 1000+ tasks
- User testing feedback integration

---

## Technical Stack

- **Frontend**: Next.js 16 App Router, React 19, TypeScript
- **UI Components**: shadcn/ui (Radix primitives)
- **Calendar Library**: TBD (react-big-calendar or custom)
- **Drag-and-Drop**: @dnd-kit/core
- **State Management**: TanStack Query (React Query)
- **Database**: Turso (SQLite)
- **Styling**: Tailwind CSS

---

## Success Metrics

- **User Experience**: Task creation to scheduling < 5 seconds
- **Performance**: Calendar render < 200ms for 100 tasks
- **Accuracy**: Estimation variance tracking for 90%+ of completed tasks
- **Adoption**: Users actively use all three views (List, Calendar, Kanban)
- **Mobile**: Touch interactions work flawlessly on phones/tablets

---

## Future Enhancements (Not in Initial Scope)

- Smart scheduling AI that suggests optimal time slots
- Recurring tasks
- Task dependencies and Gantt chart view
- Time tracking integration
- Calendar sync with Google Calendar/Outlook
- Collaborative task assignment
- Natural language task creation ("Schedule meeting with John next Tuesday at 2pm")
