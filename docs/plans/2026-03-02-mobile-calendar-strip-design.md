# Mobile Calendar Strip — Design Document
Date: 2026-03-02

## Overview

A Welltory-style mobile calendar for the dashboard: a compact week-strip attached to the header (collapsed), expanding to a full-screen month calendar + task list.

## User Stories

- As a mobile user, I can see the current week at a glance without scrolling
- As a mobile user, I can see which days have tasks (dot indicators)
- As a mobile user, I can tap any day or the expand button to see the full month calendar
- As a mobile user, I can see tasks for any selected day in the expanded view
- As a mobile user, I can check off tasks from the expanded calendar view

## UI States

### Collapsed (always visible on mobile)

Sticky bar immediately below the main header (`top-14 z-39 lg:hidden`):

```
┌─────────────────────────────────────┐
│  M    T   [W]   T    F    S    S   │  ← today = [W] with accent ring
│   1    2    3    4    5    6    7   │
│   •              •                 │  ← dot = has tasks
│                           ⊞  Mar  │  ← expand button + month label
└─────────────────────────────────────┘
```

Height: 56px. Backdrop blur matching main header. Border-bottom.

### Full-Screen Expanded (Sheet)

Full-viewport Sheet (from top, slides down):

```
┌─────────────────────────────────────┐
│  ✕ March 2026               < >   │  ← close + month nav
├─────────────────────────────────────┤
│  M   T   W   T   F   S   S        │  ← weekday headers
│  24  25  26  27  28   1   2       │
│   3   4   5   6   7   8   9       │
│  10  11  12  13  14  15  16       │  ← today has ring
│  17  18  19  20  21  22  23       │
│  24  25  26  27  28  29  30       │
│  31                               │
│   •              •        •       │  ← dots under days with tasks
├─────────────────────────────────────┤
│  Wednesday, March 3                │  ← selected day
│  ○  10:00  Team standup            │
│  ○  15:00  Review PR               │
│  ○          Buy groceries          │
└─────────────────────────────────────┘
```

## Architecture

### New Component

**`src/components/layout/mobile-calendar-strip.tsx`**

Client component. Responsibilities:
1. Render the sticky week strip (7 day buttons, today highlighted, task dots)
2. Manage `selectedDate` and `isOpen` state
3. Fetch tasks for current week (dots in strip)
4. When `isOpen`, render the `MobileCalendarSheet` inside a Sheet

### Modified Components

**`src/components/layout/responsive-layout.tsx`**
- Add `<MobileCalendarStrip />` immediately after the main `<header>` element
- Wrapped in `<div className="lg:hidden">` so desktop is unaffected
- The `<main>` content area gets `pt-0` — the strip's sticky positioning handles spacing

**`src/components/dashboard/calendar-widget.tsx`**
- Add `hidden lg:block` to the week-strip div — it's replaced by the header strip on mobile
- Keep the "Today's Agenda" section visible on all screen sizes

### Subcomponents (within mobile-calendar-strip.tsx)

1. **`WeekDayButton`** — single day cell (abbrev day, date number, dot)
2. **`MobileCalendarSheet`** — the full-screen expanded view containing:
   - `MonthGrid` — 7-col month calendar grid
   - `DayTaskList` — task list for selected day

### Data Fetching

- **Strip**: `useQuery` fetching `/api/tasks?start=<weekStart>&end=<weekEnd>&includeCompleted=false`
- **Sheet month grid**: `useQuery` fetching `/api/tasks?start=<monthStart>&end=<monthEnd>&includeCompleted=false` when sheet opens
- **Selected day tasks**: derived from month data (no extra fetch needed)

## Styling Notes

- Strip sticky: `sticky top-14 z-39` (sits right below 56px header)
- Strip height: `h-14` (56px) with border-bottom and `bg-background/95 backdrop-blur`
- Today ring: `ring-2 ring-primary ring-offset-1 rounded-full`
- Task dot: `w-1.5 h-1.5 rounded-full bg-primary`
- Month grid day: `w-9 h-9 flex items-center justify-center rounded-full text-sm`
- Selected day in grid: `bg-primary text-primary-foreground`
- Sheet: full viewport height, scroll on task list

## Files Touched

1. `src/components/layout/mobile-calendar-strip.tsx` — **new**
2. `src/components/layout/responsive-layout.tsx` — add strip below header
3. `src/components/dashboard/calendar-widget.tsx` — hide week strip on mobile

## Out of Scope

- Desktop calendar changes (desktop uses existing widget unchanged)
- Editing/creating tasks from calendar (link to `/tasks?view=calendar` instead)
- Recurring events or multi-day spans
- Swipe gestures for month navigation (tap buttons only)
