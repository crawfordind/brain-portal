# Mobile Calendar Strip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Welltory-style mobile calendar to the dashboard: a compact sticky week-strip attached to the header (collapsed state) that expands to a full-screen month calendar + task list.

**Architecture:** A new `MobileCalendarStrip` client component renders as a sticky sub-header (`top-16 z-30 lg:hidden`) immediately below the existing 64px header. Tapping any day or the expand button opens a full-screen `Sheet` with a month grid and selected-day task list. The existing `DashboardCalendarWidget`'s week strip is hidden on mobile since the new strip replaces it.

**Tech Stack:** Next.js 15 App Router, React Query (`@tanstack/react-query`), date-fns, shadcn/ui `Sheet` component, Tailwind CSS, Vitest.

---

### Task 1: Add `getMonthRange` utility and test

**Files:**
- Modify: `src/lib/tasks/calendar-utils.ts`
- Test: `tests/lib/tasks/calendar-utils.test.ts`

**Step 1: Write the failing test**

Open `tests/lib/tasks/calendar-utils.test.ts` and append this describe block after the existing tests:

```typescript
describe("getMonthRange", () => {
  it("returns a range covering the full calendar grid for the month", () => {
    // March 2024: starts on Friday, so grid starts Mon Feb 26
    const march2024 = new Date("2024-03-15T00:00:00Z");
    const range = getMonthRange(march2024);

    const start = new Date(range.start);
    const end = new Date(range.end);

    // Grid start must be a Monday on or before March 1
    expect(start.getDay()).toBe(1); // Monday
    // Grid end must be a Sunday on or after March 31
    expect(end.getDay()).toBe(0); // Sunday
    // End must be after start
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it("returns ISO formatted strings", () => {
    const date = new Date("2024-06-01T00:00:00Z");
    const range = getMonthRange(date);
    expect(() => new Date(range.start)).not.toThrow();
    expect(() => new Date(range.end)).not.toThrow();
  });
});
```

Also add `getMonthRange` to the import at the top of the test file:

```typescript
import {
  getWeekDays,
  getTimeSlots,
  isTaskInTimeSlot,
  getWeekRange,
  getUnscheduledTasksForDay,
  getMonthRange,          // ← add this
} from "@/lib/tasks/calendar-utils";
```

**Step 2: Run test to verify it fails**

```bash
cd /home/daniel/PROJECTS/brain-portal && npx vitest run tests/lib/tasks/calendar-utils.test.ts
```

Expected: FAIL — `getMonthRange` is not exported.

**Step 3: Implement `getMonthRange` in calendar-utils.ts**

Open `src/lib/tasks/calendar-utils.ts` and add the following imports at the top (merge with existing imports):

```typescript
import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  parseISO,
  startOfDay,
  endOfDay,
  startOfMonth,   // ← add
  endOfMonth,     // ← add
} from "date-fns";
```

Then append this function at the end of the file:

```typescript
/**
 * Get the date range for a calendar month grid view.
 * Extends to full weeks (Mon–Sun) so the grid has no gaps.
 */
export function getMonthRange(date: Date): { start: string; end: string } {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return {
    start: startOfDay(calendarStart).toISOString(),
    end: endOfDay(calendarEnd).toISOString(),
  };
}
```

**Step 4: Run test to verify it passes**

```bash
cd /home/daniel/PROJECTS/brain-portal && npx vitest run tests/lib/tasks/calendar-utils.test.ts
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
cd /home/daniel/PROJECTS/brain-portal && git add src/lib/tasks/calendar-utils.ts tests/lib/tasks/calendar-utils.test.ts && git commit -m "feat: add getMonthRange utility for mobile calendar"
```

---

### Task 2: Create `MobileCalendarStrip` component

**Files:**
- Create: `src/components/layout/mobile-calendar-strip.tsx`

**Step 1: Create the file**

Create `src/components/layout/mobile-calendar-strip.tsx` with this exact content:

```tsx
"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  isToday,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, X, CalendarDays } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { getWeekDays, getWeekRange, getMonthRange } from "@/lib/tasks/calendar-utils";
import type { Task } from "@/types/task";

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-gray-400",
};

function getMonthGrid(date: Date): Date[][] {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }
  return weeks;
}

function getTasksForDay(tasks: Task[], day: Date): Task[] {
  return tasks.filter((task) => {
    const dateStr = task.scheduled_at || task.due_date;
    if (!dateStr) return false;
    return isSameDay(parseISO(dateStr), day);
  });
}

export function MobileCalendarStrip() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [displayMonth, setDisplayMonth] = useState(() => new Date());

  useEffect(() => setMounted(true), []);

  const today = useMemo(() => new Date(), []);
  const weekDays = useMemo(() => getWeekDays(today), [today]);
  const weekRange = useMemo(() => getWeekRange(today), [today]);
  const monthRange = useMemo(() => getMonthRange(displayMonth), [displayMonth]);
  const monthGrid = useMemo(() => getMonthGrid(displayMonth), [displayMonth]);

  const { data: weekData } = useQuery({
    queryKey: ["tasks", "cal-strip-week", weekRange.start, weekRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: weekRange.start,
        end: weekRange.end,
        includeCompleted: "false",
      });
      const res = await fetch(`/api/tasks?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: monthData } = useQuery({
    queryKey: ["tasks", "cal-strip-month", monthRange.start, monthRange.end],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: monthRange.start,
        end: monthRange.end,
        includeCompleted: "false",
      });
      const res = await fetch(`/api/tasks?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isOpen,
  });

  const weekTasks: Task[] = weekData?.tasks || [];
  const monthTasks: Task[] = monthData?.tasks || [];

  const selectedDayTasks = useMemo(
    () =>
      getTasksForDay(monthTasks, selectedDate).sort((a, b) => {
        if (a.scheduled_at && b.scheduled_at)
          return a.scheduled_at.localeCompare(b.scheduled_at);
        if (a.scheduled_at) return -1;
        if (b.scheduled_at) return 1;
        return 0;
      }),
    [monthTasks, selectedDate]
  );

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error("Failed to complete task");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (!mounted) return null;

  return (
    <>
      {/* ── Collapsed strip (sticky below 64px header) ── */}
      <div className="sticky top-16 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
        <div className="flex items-center gap-1 px-2 py-1.5">
          {/* 7 day buttons */}
          <div className="flex flex-1 gap-0.5">
            {weekDays.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayTasks = getTasksForDay(weekTasks, day);
              const today_ = isToday(day);

              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedDate(day);
                    setDisplayMonth(day);
                    setIsOpen(true);
                  }}
                  className={cn(
                    "flex flex-col items-center flex-1 py-1 rounded-md transition-colors min-w-0",
                    today_ ? "ring-2 ring-primary ring-inset" : "hover:bg-muted/50"
                  )}
                >
                  <span className="text-[9px] font-medium uppercase text-muted-foreground leading-tight">
                    {format(day, "EEE")}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-semibold leading-tight",
                      today_ && "text-primary"
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <div className="h-1.5 flex items-center justify-center">
                    {dayTasks.length > 0 && (
                      <div
                        className={cn(
                          "w-1 h-1 rounded-full",
                          today_ ? "bg-primary" : "bg-muted-foreground/60"
                        )}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Month label + expand button */}
          <button
            onClick={() => {
              setSelectedDate(today);
              setDisplayMonth(today);
              setIsOpen(true);
            }}
            className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-md hover:bg-muted/50 transition-colors"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground font-medium">
              {format(today, "MMM")}
            </span>
          </button>
        </div>
      </div>

      {/* ── Full-screen sheet ── */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="top"
          className="h-[100dvh] p-0 overflow-hidden flex flex-col"
        >
          {/* Sheet header: close + month navigation */}
          <div className="flex items-center px-4 py-3 border-b shrink-0">
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 -ml-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </button>
            <div className="flex-1 flex items-center justify-center gap-3">
              <button
                onClick={() => setDisplayMonth(subMonths(displayMonth, 1))}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous month</span>
              </button>
              <span className="text-base font-semibold min-w-[140px] text-center">
                {format(displayMonth, "MMMM yyyy")}
              </span>
              <button
                onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next month</span>
              </button>
            </div>
            {/* Spacer to balance close button */}
            <div className="w-8" />
          </div>

          {/* Month grid */}
          <div className="px-3 pt-2 pb-1 border-b shrink-0">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} className="flex items-center justify-center">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {d}
                  </span>
                </div>
              ))}
            </div>

            {/* Day cells */}
            {monthGrid.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day, di) => {
                  const dayTasks = getTasksForDay(monthTasks, day);
                  const isSelected = isSameDay(day, selectedDate);
                  const isCurrentMonth = isSameMonth(day, displayMonth);
                  const today_ = isToday(day);

                  return (
                    <button
                      key={di}
                      onClick={() => setSelectedDate(day)}
                      className="flex flex-col items-center py-0.5"
                    >
                      <div
                        className={cn(
                          "w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors",
                          isSelected &&
                            "bg-primary text-primary-foreground",
                          !isSelected &&
                            today_ &&
                            "ring-2 ring-primary text-primary",
                          !isSelected &&
                            !today_ &&
                            isCurrentMonth &&
                            "hover:bg-muted",
                          !isCurrentMonth && "text-muted-foreground/40"
                        )}
                      >
                        {format(day, "d")}
                      </div>
                      <div className="h-1.5 flex items-center justify-center gap-0.5">
                        {dayTasks.slice(0, 3).map((_, ti) => (
                          <div
                            key={ti}
                            className={cn(
                              "w-1 h-1 rounded-full",
                              isSelected
                                ? "bg-primary-foreground"
                                : "bg-primary/60"
                            )}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Selected day task list */}
          <div className="flex-1 overflow-auto">
            <div className="px-4 py-3">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                {isToday(selectedDate) ? "Today · " : ""}
                {format(selectedDate, "EEEE, MMMM d")}
              </h3>

              {selectedDayTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Nothing scheduled
                </p>
              ) : (
                <div className="space-y-0.5">
                  {selectedDayTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors touch-manipulation min-h-[44px]"
                    >
                      <Checkbox
                        checked={false}
                        onCheckedChange={(checked) => {
                          if (checked) completeMutation.mutate(task.id);
                        }}
                        className="flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {task.scheduled_at && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              {format(parseISO(task.scheduled_at), "h:mm a")}
                            </span>
                          )}
                          <span className="text-sm truncate">
                            {task.title || task.content}
                          </span>
                        </div>
                        {task.project_name && (
                          <span className="text-xs text-muted-foreground">
                            {task.project_name}
                          </span>
                        )}
                      </div>
                      {task.priority && task.priority !== "low" && (
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            PRIORITY_DOT[task.priority]
                          )}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Link to full calendar page */}
            <div className="px-4 pb-6">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push("/tasks?view=calendar");
                }}
                className="w-full text-sm text-muted-foreground hover:text-foreground text-center py-2"
              >
                View full calendar →
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
```

**Step 2: Run typecheck**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm run typecheck 2>&1 | head -40
```

Expected: No errors in the new file. Fix any type errors before continuing.

**Step 3: Commit**

```bash
cd /home/daniel/PROJECTS/brain-portal && git add src/components/layout/mobile-calendar-strip.tsx && git commit -m "feat: add MobileCalendarStrip component"
```

---

### Task 3: Wire `MobileCalendarStrip` into `responsive-layout.tsx`

**Files:**
- Modify: `src/components/layout/responsive-layout.tsx`

**Step 1: Add the import**

In `src/components/layout/responsive-layout.tsx`, add this import after the existing imports:

```typescript
import { MobileCalendarStrip } from "./mobile-calendar-strip";
```

**Step 2: Add the strip after the `<header>` element**

In `responsive-layout.tsx`, find the closing `</header>` tag (around line 54). Add the strip immediately after it:

```tsx
        </header>

        {/* MOBILE: Sticky calendar strip — sits just below the 64px header */}
        <div className="lg:hidden">
          <MobileCalendarStrip />
        </div>

        {/* Scrollable content area */}
```

The final structure of the main content div should look like:

```tsx
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        {/* Sticky header */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
          <div className="flex h-16 items-center px-4">
            ...
          </div>
        </header>

        {/* MOBILE: Sticky calendar strip */}
        <div className="lg:hidden">
          <MobileCalendarStrip />
        </div>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-auto">
          ...
        </main>

        {/* Bottom navigation */}
        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
```

**Step 3: Run typecheck**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm run typecheck 2>&1 | head -40
```

Expected: No errors.

**Step 4: Commit**

```bash
cd /home/daniel/PROJECTS/brain-portal && git add src/components/layout/responsive-layout.tsx && git commit -m "feat: add mobile calendar strip to layout"
```

---

### Task 4: Hide week strip in `DashboardCalendarWidget` on mobile

**Files:**
- Modify: `src/components/dashboard/calendar-widget.tsx`

**Step 1: Hide the week strip div on mobile**

In `src/components/dashboard/calendar-widget.tsx`, find the week strip container div (around line 111):

```tsx
      {/* Week Strip */}
      <div className="flex gap-1 overflow-x-auto scrollbar-hide -mx-3 px-3 lg:mx-0 lg:px-0">
```

Replace with:

```tsx
      {/* Week Strip — hidden on mobile (replaced by sticky header strip) */}
      <div className="hidden lg:flex gap-1 overflow-x-auto scrollbar-hide lg:mx-0 lg:px-0">
```

**Step 2: Run typecheck**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm run typecheck 2>&1 | head -40
```

Expected: No errors.

**Step 3: Commit**

```bash
cd /home/daniel/PROJECTS/brain-portal && git add src/components/dashboard/calendar-widget.tsx && git commit -m "fix: hide calendar week strip on mobile (replaced by header strip)"
```

---

### Task 5: Run full test suite and verify

**Step 1: Run all tests**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm test 2>&1 | tail -20
```

Expected: All existing tests pass. The new `getMonthRange` test passes.

**Step 2: Run typecheck**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm run typecheck
```

Expected: No errors.

**Step 3: Start dev server and visually verify on mobile**

```bash
cd /home/daniel/PROJECTS/brain-portal && npm run dev
```

On mobile (or browser DevTools mobile view at 390px width):
- [ ] The week strip appears just below the Brain Portal header
- [ ] Today's date has a ring/accent
- [ ] Days with tasks show a dot
- [ ] Tapping a day opens the full-screen sheet
- [ ] Tapping the CalendarDays icon/month label opens the sheet
- [ ] Month grid shows correct days and dots
- [ ] Selecting a day shows tasks for that day
- [ ] Prev/next month navigation works
- [ ] Task checkboxes complete the task
- [ ] "View full calendar →" navigates to `/tasks?view=calendar`
- [ ] On desktop (lg+): strip is hidden, existing calendar widget unchanged

**Step 4: Final commit (if any cleanup needed)**

```bash
cd /home/daniel/PROJECTS/brain-portal && git add -p && git commit -m "fix: mobile calendar strip visual polish"
```
