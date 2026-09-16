# Calendar View Redesign - Mobile-First Day Focus

**Date:** 2026-02-06
**Status:** Design Complete
**Type:** UX Redesign

## Problem Statement

Current calendar view issues:
- **Too long**: 7-day grid × 17 time slots = excessive scrolling (especially mobile)
- **Messy layout**: Tasks overflow cells and look cramped
- **Poor task assignment UX**: Large backlog section at bottom is inefficient
- **Mobile unfriendly**: Pinch-to-zoom required, hard to interact with small cells

## Solution: Day Focus + Week Context Hybrid

A mobile-first design combining daily focus with weekly overview through three coordinated components.

---

## Component 1: Week Strip Navigation

**Purpose:** Provide weekly context and quick day switching.

### Visual Design

```
┌─────────────────────────────────────────────────────────┐
│ Mon   Tue   Wed   Thu   Fri   Sat   Sun                │
│  3     5    [2]    0     4     1     0     ← Task count│
│  ●●    ●●    ●     -    ●●●    ●     -     ← Priority  │
└─────────────────────────────────────────────────────────┘
```

### Styling (matches codebase patterns)

```tsx
// Week strip container
className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur"

// Individual day button
className={cn(
  "flex flex-col items-center p-2 lg:p-3 min-w-[50px] lg:min-w-[80px]",
  "rounded-lg transition-all",
  isToday && "bg-primary/10 ring-2 ring-primary",
  isFocused && "bg-accent",
  "hover:bg-muted cursor-pointer"
)}

// Task count
className="text-xs lg:text-sm font-semibold"

// Priority dots container
className="flex gap-0.5 mt-1"

// Priority dot
className={cn(
  "w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full",
  priority === "urgent" && "bg-red-500",
  priority === "high" && "bg-orange-500",
  priority === "medium" && "bg-blue-500"
)}
```

### Behavior

**Mobile (<768px):**
- Horizontal scroll with snap-to-day
- Swipe left/right on day view also navigates
- Focused day auto-centers in strip

**Desktop (≥768px):**
- All 7 days visible simultaneously
- Hover shows tooltip: "3 tasks: 1 urgent, 2 high"
- Keyboard: ←/→ arrows navigate days

### Component Structure

```tsx
interface WeekStripProps {
  focusedDate: Date;
  onDaySelect: (date: Date) => void;
  tasks: Task[];
}

function WeekStrip({ focusedDate, onDaySelect, tasks }: WeekStripProps) {
  const weekDays = getWeekDays(startOfWeek(focusedDate));

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide">
        {weekDays.map(day => (
          <DayButton
            key={day.toISOString()}
            day={day}
            isFocused={isSameDay(day, focusedDate)}
            isToday={isToday(day)}
            tasks={getTasksForDay(tasks, day)}
            onClick={() => onDaySelect(day)}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## Component 2: Day View (Main Focus)

**Purpose:** Show detailed schedule for selected day with drag-and-drop scheduling.

### Visual Design

```
┌─────────────────────────────────────────────────────────┐
│ Wednesday, February 5                                   │
│ 3 tasks • 2 scheduled                                   │
├─────────────────────────────────────────────────────────┤
│ 6 AM  ─────────────────────────────────────────────     │
│       Drop tasks here...                                │
│ 7 AM  ─────────────────────────────────────────────     │
│ 8 AM  ┌────────────────────────────────────────┐        │
│       │ Morning standup                        │        │
│ 9 AM  │ 🔵 Work • 30m                          │        │
│       └────────────────────────────────────────┘        │
│10 AM  ─────────────────────────────────────────────     │
│11 AM  ┌────────────────────────────────────────┐        │
│       │ Client review                          │        │
│12 PM  │ 🟠 High Priority                       │        │
│       └────────────────────────────────────────┘        │
│ 1 PM  ─────────────────────────────────────────────     │
│ ...   (scrollable to 10 PM)                             │
├─────────────────────────────────────────────────────────┤
│ Due Today (Not Scheduled)                               │
│ ┌────────────────────────────────────────┐              │
│ │ Review PR #234 • 🔵 Medium             │              │
│ └────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### Styling (matches codebase patterns)

```tsx
// Day header
className="border-b bg-muted/30 p-3 lg:p-4"

// Day title
className="text-lg lg:text-xl font-bold"

// Stats
className="text-xs lg:text-sm text-muted-foreground"

// Time slot grid container
className="divide-y"

// Time slot row (droppable)
className={cn(
  "grid grid-cols-[60px_1fr] lg:grid-cols-[80px_1fr]",
  "min-h-[50px] lg:min-h-[60px]",
  isOver && "bg-primary/5 ring-2 ring-primary ring-inset"
)}

// Time label
className="p-2 text-xs lg:text-sm text-muted-foreground border-r"

// Task card in slot
className={cn(
  "m-1 p-2 rounded-lg border-l-4 bg-card",
  "cursor-pointer hover:shadow-md transition-all",
  priority === "urgent" && "border-l-red-500",
  priority === "high" && "border-l-orange-500",
  priority === "medium" && "border-l-blue-500",
  priority === "low" && "border-l-gray-300"
)}

// Task title in slot
className="text-xs lg:text-sm font-medium line-clamp-2"

// Unscheduled section
className="border-t bg-muted/20 p-3 lg:p-4"
```

### Component Structure

```tsx
interface DayViewProps {
  date: Date;
  tasks: Task[];
  onTaskSchedule: (taskId: string, scheduledAt: string) => void;
  onTaskClick: (task: Task) => void;
}

function DayView({ date, tasks, onTaskSchedule, onTaskClick }: DayViewProps) {
  const timeSlots = getTimeSlots(); // 6 AM - 10 PM
  const scheduledTasks = tasks.filter(t => t.scheduled_at);
  const unscheduledToday = tasks.filter(t =>
    t.due_date && isSameDay(parseISO(t.due_date), date) && !t.scheduled_at
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Day header */}
      <DayHeader date={date} taskCount={tasks.length} />

      {/* Time slot grid */}
      <div className="divide-y">
        {timeSlots.map(timeSlot => (
          <DroppableTimeSlot
            key={timeSlot}
            date={date}
            timeSlot={timeSlot}
            tasks={getTasksInSlot(scheduledTasks, date, timeSlot)}
            onTaskSchedule={onTaskSchedule}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>

      {/* Unscheduled tasks for this day */}
      {unscheduledToday.length > 0 && (
        <UnscheduledTodaySection
          tasks={unscheduledToday}
          onTaskClick={onTaskClick}
        />
      )}
    </div>
  );
}
```

### Mobile Gestures

- **Swipe left/right**: Navigate to previous/next day
- **Long press task (200ms)**: Start drag operation
- **Pull down**: Refresh tasks

---

## Component 3: Backlog Sheet

**Purpose:** Show all unscheduled tasks, accessible but not intrusive.

### Three States

**1. Hidden (Collapsed):**
- Only floating button visible
- Fixed bottom-right corner
- Shows count: "📋 12"

**2. Peek (Default):**
- Bottom sheet shows ~80px header
- "12 unscheduled tasks" with drag handle
- Swipe up to expand, down to hide

**3. Expanded:**
- Sheet slides up to 60% screen height (mobile) or 70% (tablet)
- Search bar + filters
- Scrollable task list

### Visual Design (Expanded State)

```
┌─────────────────────────────────────────────────────────┐
│     ───  (drag handle)                                  │
│  📋 Backlog (12 tasks)                          [×]     │
├─────────────────────────────────────────────────────────┤
│  Search tasks...                    [Filter ▾]          │
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐             │
│  │ Fix login bug                          │             │
│  │ 🔴 Urgent • No due date                │  [Schedule] │
│  └────────────────────────────────────────┘             │
│  ┌────────────────────────────────────────┐             │
│  │ Review PR #234                         │             │
│  │ 🔵 Medium • Due Feb 6                  │  [Schedule] │
│  └────────────────────────────────────────┘             │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### Styling (matches codebase patterns)

```tsx
// Sheet container (using existing Sheet component)
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

// Floating button (hidden state)
className={cn(
  "fixed bottom-20 right-4 z-40",
  "h-12 w-12 lg:h-14 lg:w-14 rounded-full",
  "bg-primary text-primary-foreground shadow-lg",
  "flex items-center justify-center",
  "hover:scale-110 transition-transform"
)}

// Sheet header
className="border-b p-3 lg:p-4"

// Search input
className="h-9 lg:h-10 text-xs lg:text-sm"

// Task card in backlog
className={cn(
  "p-2 lg:p-3 rounded-lg border-l-4 bg-card",
  "hover:bg-muted/50 transition-colors",
  "cursor-grab active:cursor-grabbing"
)}
```

### Component Structure

```tsx
interface BacklogSheetProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onScheduleTask: (taskId: string) => void;
}

function BacklogSheet({ tasks, onTaskClick, onScheduleTask }: BacklogSheetProps) {
  const [sheetState, setSheetState] = useState<'hidden' | 'peek' | 'expanded'>('peek');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (task.scheduled_at) return false; // Only unscheduled
      if (searchQuery && !task.content.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (priorityFilter.length > 0 && !priorityFilter.includes(task.priority)) {
        return false;
      }
      return true;
    });
  }, [tasks, searchQuery, priorityFilter]);

  // Desktop: Show as sidebar instead of sheet
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  if (isDesktop) {
    return <BacklogSidebar tasks={filteredTasks} {...props} />;
  }

  return (
    <>
      {/* Floating button when hidden */}
      {sheetState === 'hidden' && (
        <Button
          className="fixed bottom-20 right-4 z-40"
          onClick={() => setSheetState('peek')}
        >
          📋 {filteredTasks.length}
        </Button>
      )}

      {/* Bottom sheet */}
      <Sheet open={sheetState !== 'hidden'} onOpenChange={(open) => setSheetState(open ? 'peek' : 'hidden')}>
        <SheetContent side="bottom" className="h-[60vh]">
          <SheetHeader>
            <SheetTitle>📋 Backlog ({filteredTasks.length} tasks)</SheetTitle>
          </SheetHeader>

          {/* Search and filters */}
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <FilterButton
              priorityFilter={priorityFilter}
              onFilterChange={setPriorityFilter}
            />
          </div>

          {/* Task list */}
          <div className="overflow-y-auto space-y-2">
            {filteredTasks.map(task => (
              <DraggableTaskCard
                key={task.id}
                task={task}
                onClick={onTaskClick}
                variant="calendar"
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### Desktop Sidebar

On desktop (≥1024px), backlog shows as persistent right sidebar:

```tsx
function BacklogSidebar({ tasks, ...props }: BacklogSheetProps) {
  return (
    <aside className="w-80 border-l bg-muted/30 p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-3">
        📋 Task Backlog ({tasks.length})
      </h2>

      {/* Same search/filter/list as sheet */}
      <BacklogContent tasks={tasks} {...props} />
    </aside>
  );
}
```

---

## Interactions & Gestures

### Drag & Drop

**Mobile:**
1. Long press task (200ms haptic)
2. Task lifts with drop shadow
3. Drag over time slot → Slot highlights with ring
4. Release → Schedules + animates into place
5. Invalid drop → Bounces back

**Desktop:**
1. Hover shows grab cursor
2. Click + drag → Follows cursor
3. Drop zones highlight on hover
4. ESC cancels drag

### Quick Actions (Mobile Swipe)

**On backlog tasks:**
- Swipe right → "Schedule Tomorrow"
- Swipe left → "Mark Complete"

**On calendar tasks:**
- Swipe right → "Move to Tomorrow"
- Swipe left → "Unschedule"

### Keyboard Shortcuts (Desktop)

```
←/→       Navigate days
T         Jump to today
N         New task
/         Focus backlog search
?         Show shortcuts
ESC       Close dialogs/cancel drag
```

---

## Empty States

### Empty Day

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <div className="text-6xl mb-4">✨</div>
  <h3 className="text-lg font-semibold mb-2">Free Day!</h3>
  <p className="text-sm text-muted-foreground mb-4">
    Drag tasks from the backlog to schedule them
  </p>
</div>
```

### Empty Backlog

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <div className="text-6xl mb-4">✅</div>
  <h3 className="text-lg font-semibold mb-2">All Tasks Scheduled!</h3>
  <p className="text-sm text-muted-foreground mb-4">
    You're all set. Time to execute!
  </p>
  <Button onClick={onCreateTask}>
    <Plus className="h-4 w-4 mr-2" />
    Create New Task
  </Button>
</div>
```

### New User Onboarding

Show on first visit if no tasks exist:

```tsx
<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
  <div className="text-6xl mb-4">📅</div>
  <h3 className="text-xl font-bold mb-2">Welcome to Calendar View!</h3>
  <p className="text-sm text-muted-foreground mb-4 max-w-md">
    Schedule your day by dragging tasks from the backlog onto time slots.
  </p>
  <ul className="text-sm text-muted-foreground text-left space-y-2 mb-6">
    <li>• Tap the week strip to switch days</li>
    <li>• Swipe left/right to navigate</li>
    <li>• Long-press tasks to schedule them</li>
  </ul>
  <Button size="lg" onClick={onCreateFirstTask}>
    <Plus className="h-4 w-4 mr-2" />
    Create Your First Task
  </Button>
</div>
```

---

## Responsive Behavior

### Breakpoints

| Size | Width | Week Strip | Day View | Backlog |
|------|-------|------------|----------|---------|
| Mobile | <768px | Scroll + snap | Full width | Bottom sheet |
| Tablet | 768-1024px | All visible | Centered 600px | Bottom sheet |
| Desktop | ≥1024px | All visible | Left 60% | Right sidebar 40% |

### Layout Adjustments

**Mobile (<768px):**
- Time slots: 50px height
- Text: `text-xs` (no lg variant)
- Icons: `h-3 w-3`
- Padding: `p-2`
- Task cards: Minimal info

**Tablet (768-1024px):**
- Time slots: 60px height
- Text: `text-xs lg:text-sm`
- Icons: `h-3 w-3 lg:h-4 lg:w-4`
- Padding: `p-2 lg:p-3`

**Desktop (≥1024px):**
- Time slots: 70px height
- Full responsive classes active
- Icons: `h-4 w-4`
- Padding: `p-3 lg:p-4`
- Show more task details

---

## Performance Optimizations

### Virtual Scrolling

Time slots use virtual scrolling (only render visible):

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

function TimeSlotGrid({ timeSlots, tasks }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: timeSlots.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60, // Estimated slot height
    overscan: 3, // Render 3 extra slots above/below
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <TimeSlot
            key={virtualItem.key}
            slot={timeSlots[virtualItem.index]}
            style={{
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### Optimistic Updates

Drag & drop updates immediately (no waiting for API):

```tsx
const rescheduleMutation = useMutation({
  mutationFn: async ({ taskId, scheduledAt }) => {
    // Optimistic update
    queryClient.setQueryData(['tasks'], (old) =>
      updateTaskInCache(old, taskId, { scheduled_at: scheduledAt })
    );

    // API call
    return await fetch(`/api/tasks/${taskId}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduled_at: scheduledAt }),
    });
  },
  onError: (error, variables, context) => {
    // Revert on error
    queryClient.setQueryData(['tasks'], context.previousTasks);
    toast.error('Failed to reschedule task');
  },
});
```

### Debounced Autosave

Don't spam API on every drag:

```tsx
const debouncedReschedule = useDebouncedCallback(
  (taskId: string, scheduledAt: string) => {
    rescheduleMutation.mutate({ taskId, scheduledAt });
  },
  500 // Wait 500ms after drag ends
);
```

---

## Data Requirements

### API Changes

None required! Current `/api/tasks` endpoint supports all needed queries:

```typescript
// Fetch tasks for current week
GET /api/tasks?start=2026-02-03T00:00:00Z&end=2026-02-09T23:59:59Z&includeCompleted=false

// Fetch all unscheduled tasks
GET /api/tasks?includeCompleted=false
// Then filter client-side: tasks.filter(t => !t.scheduled_at)

// Reschedule task
PATCH /api/tasks/{id}/reschedule
Body: { scheduled_at: "2026-02-05T14:00:00Z" }
```

### State Management

```typescript
interface CalendarViewState {
  // Navigation
  focusedDate: Date;           // Currently viewed day
  weekStart: Date;             // Start of displayed week

  // UI State
  sheetState: 'hidden' | 'peek' | 'expanded';
  expandedTimeSlot?: string;   // For 3+ tasks in one slot

  // Drag & Drop
  draggedTask?: Task;
  dragOverSlot?: string;

  // Filters
  backlogSearch: string;
  backlogPriorityFilter: string[];
}
```

---

## Implementation Plan

### Phase 1: Week Strip (2 hours)
- Create `WeekStrip` component
- Implement day navigation
- Add task count indicators
- Mobile scroll/snap behavior

### Phase 2: Day View (4 hours)
- Create `DayView` component
- Build time slot grid with virtual scrolling
- Implement drop zones
- Add unscheduled-today section

### Phase 3: Backlog Sheet (3 hours)
- Create `BacklogSheet` component with 3 states
- Implement search and filters
- Desktop sidebar variant
- Floating button

### Phase 4: Drag & Drop (3 hours)
- Integrate @dnd-kit
- Mobile long-press support
- Optimistic updates
- Animation polish

### Phase 5: Gestures & Polish (2 hours)
- Swipe navigation
- Quick actions (swipe left/right)
- Keyboard shortcuts
- Empty states

### Phase 6: Testing & Refinement (2 hours)
- Mobile testing (various screen sizes)
- Performance profiling
- Accessibility audit
- Bug fixes

**Total:** ~16 hours

---

## Success Metrics

- ✅ Page height reduced by >70% (no vertical scroll for single day)
- ✅ Task assignment takes <3 taps (open backlog → long-press → drop)
- ✅ Mobile-first: All features work with touch only
- ✅ Performance: Virtual scrolling keeps render time <16ms
- ✅ Accessibility: Full keyboard navigation + screen reader support

---

## Future Enhancements (Out of Scope)

- **Multi-day drag**: Drag task across multiple days in week strip
- **Duration estimation**: AI suggests task duration based on content
- **Color coding**: Project-based color schemes for tasks
- **Time blocking templates**: "Morning routine", "Deep work" presets
- **Calendar sync**: Import from Google/Outlook calendars
- **Recurring tasks**: Schedule repeating tasks
