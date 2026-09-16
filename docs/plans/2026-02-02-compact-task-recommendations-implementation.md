# Compact Task Recommendations - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Convert task recommendations section to collapsible component that starts collapsed by default, reducing vertical space while maintaining all functionality.

**Architecture:** Wrap existing RecommendationsList component with Radix UI Collapsible, add localStorage state persistence, restructure header to single-row compact layout with clickable area and action buttons.

**Tech Stack:** React, TypeScript, Radix UI Collapsible, localStorage, TanStack Query, Lucide icons

---

## Task 1: Add Collapsible UI Component

Add the Radix UI Collapsible primitive to the project if not already present.

**Files:**
- Check: `package.json` - verify @radix-ui/react-collapsible exists
- Check: `src/components/ui/collapsible.tsx` - verify wrapper component exists

**Step 1: Check if Collapsible is already installed**

Run:
```bash
grep "@radix-ui/react-collapsible" package.json
```

Expected: Should find the package (likely already installed with other Radix components)

**Step 2: Check if UI wrapper exists**

Run:
```bash
ls src/components/ui/collapsible.tsx
```

Expected: File should exist (common pattern in shadcn/ui setups)

**Step 3: If missing, create the UI wrapper component**

Only if file doesn't exist, create `src/components/ui/collapsible.tsx`:

```typescript
"use client"

import * as React from "react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

**Step 4: Verify component exports**

Run:
```bash
cat src/components/ui/collapsible.tsx
```

Expected: Should see the three exported components

**Step 5: Commit (only if file was created)**

```bash
git add src/components/ui/collapsible.tsx
git commit -m "feat(ui): add Collapsible component wrapper

Add Radix UI Collapsible primitive wrapper for shadcn/ui pattern.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add State Management and LocalStorage

Add isExpanded state with localStorage persistence to RecommendationsList component.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx:1-40`

**Step 1: Add useState and useEffect imports**

At the top of `src/components/recommendations/recommendations-list.tsx`, verify imports include:

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react"; // Add useEffect if not present
import { Button } from "@/components/ui/button";
// ... other imports
```

**Step 2: Add isExpanded state with localStorage initialization**

After line 27 (`export function RecommendationsList({ className }: RecommendationsListProps) {`), add:

```typescript
  const queryClient = useQueryClient();

  // Collapsible state - persisted to localStorage
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('recommendations-expanded');
      return stored === 'true';
    }
    return false; // Default: collapsed
  });

  // Persist state changes to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('recommendations-expanded', String(isExpanded));
    }
  }, [isExpanded]);
```

**Step 3: Verify the code compiles**

Run:
```bash
npm run typecheck
```

Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): add collapsible state with localStorage

Add isExpanded state that persists to localStorage. Defaults to false
(collapsed) for clean initial view.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Import Collapsible Components and ChevronDown Icon

Add necessary imports for the collapsible UI.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx:1-10`

**Step 1: Add Collapsible imports**

At the top of the file, add:

```typescript
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Sparkles, RefreshCw, X, ChevronDown } from "lucide-react";
```

Make sure ChevronDown is added to the existing lucide-react import.

**Step 2: Verify imports**

Run:
```bash
npm run typecheck
```

Expected: No import errors

**Step 3: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): import Collapsible and ChevronDown

Add imports for collapsible UI components and chevron icon.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Restructure Header to Single-Row Compact Layout

Convert the header from a two-row layout to a single compact row with clickable area.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx:112-145`

**Step 1: Replace the header section**

Find the current header (lines ~112-145):
```typescript
<div className="flex items-center justify-between mb-4">
  <div className="flex items-center gap-2">
    <Sparkles className="h-5 w-5 text-purple-500" />
    <h2 className="text-lg font-semibold">Suggested Tasks</h2>
    {hasRecommendations && (
      <span className="text-sm text-muted-foreground">
        ({recommendations.length})
      </span>
    )}
  </div>

  <div className="flex gap-2">
    {hasRecommendations && (
      <Button
        size="sm"
        variant="outline"
        onClick={() => clearAllMutation.mutate()}
        disabled={clearAllMutation.isPending}
      >
        <X className="h-4 w-4 mr-2" />
        Clear All
      </Button>
    )}
    <Button
      size="sm"
      variant="outline"
      onClick={() => scanMutation.mutate()}
      disabled={scanMutation.isPending}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
      Scan for Tasks
    </Button>
  </div>
</div>
```

Replace with this single-row clickable header:

```typescript
<div
  onClick={() => setIsExpanded(!isExpanded)}
  className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer mb-4"
  role="button"
  tabIndex={0}
  aria-expanded={isExpanded}
  aria-label={`Suggested Tasks, ${recommendations.length} items, ${isExpanded ? 'expanded' : 'collapsed'}`}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsExpanded(!isExpanded);
    }
  }}
>
  {/* Left side: Icon + Title + Badge */}
  <div className="flex items-center gap-2">
    <Sparkles className="h-5 w-5 text-purple-500" />
    <h2 className="text-lg font-semibold">Suggested Tasks</h2>
    {hasRecommendations && (
      <Badge variant="default">{recommendations.length}</Badge>
    )}
  </div>

  {/* Right side: Action buttons + Chevron */}
  <div className="flex items-center gap-2">
    {/* Clear All - only shown when expanded */}
    {isExpanded && hasRecommendations && (
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          clearAllMutation.mutate();
        }}
        disabled={clearAllMutation.isPending}
      >
        <X className="h-4 w-4 mr-2" />
        Clear All
      </Button>
    )}

    {/* Scan button - always visible */}
    <Button
      size="sm"
      variant="outline"
      onClick={(e) => {
        e.stopPropagation();
        scanMutation.mutate();
      }}
      disabled={scanMutation.isPending}
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
      Scan for Tasks
    </Button>

    {/* Chevron indicator */}
    <ChevronDown
      className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
        isExpanded ? 'rotate-180' : ''
      }`}
    />
  </div>
</div>
```

**Step 2: Verify the code compiles**

Run:
```bash
npm run typecheck
```

Expected: No TypeScript errors

**Step 3: Test in browser**

Run:
```bash
npm run dev
```

Navigate to `/tasks` and verify:
- Header is a single row
- Header has hover effect
- Clicking header doesn't trigger yet (collapsible not wired up)
- Scan button works
- Clear All button shows only when... wait, we need to test expanded state

**Step 4: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): restructure header to compact single row

Convert header from two-row to single-row layout with:
- Left: Icon + Title + Badge
- Right: Clear All (conditional) + Scan + Chevron
- Full-width clickable area with hover effect
- Keyboard support (Enter/Space)
- stopPropagation on action buttons

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Wrap Content in Collapsible Components

Wrap the cards and empty state in CollapsibleContent to enable collapse/expand.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx:110-167`

**Step 1: Add Collapsible wrapper around entire section**

Wrap the return statement content with `<Collapsible open={isExpanded} onOpenChange={setIsExpanded}>`:

Before (approximate lines 110-167):
```typescript
return (
  <div className={className}>
    {/* Header */}
    <div onClick={...}>...</div>

    {/* Empty state */}
    {!hasRecommendations && !scanMutation.isPending && (
      <div className="text-center py-12 border-2 border-dashed rounded-lg">
        ...
      </div>
    )}

    {/* Cards */}
    {hasRecommendations && (
      <div className="space-y-3">
        ...
      </div>
    )}
  </div>
);
```

After:
```typescript
return (
  <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={className}>
    {/* Header wrapped in CollapsibleTrigger */}
    <CollapsibleTrigger asChild>
      <div
        className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer mb-4"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`Suggested Tasks, ${recommendations.length} items, ${isExpanded ? 'expanded' : 'collapsed'}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {/* Left side: Icon + Title + Badge */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-500" />
          <h2 className="text-lg font-semibold">Suggested Tasks</h2>
          {hasRecommendations && (
            <Badge variant="default">{recommendations.length}</Badge>
          )}
        </div>

        {/* Right side: Action buttons + Chevron */}
        <div className="flex items-center gap-2">
          {/* Clear All - only shown when expanded */}
          {isExpanded && hasRecommendations && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                clearAllMutation.mutate();
              }}
              disabled={clearAllMutation.isPending}
            >
              <X className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          )}

          {/* Scan button - always visible */}
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              scanMutation.mutate();
            }}
            disabled={scanMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${scanMutation.isPending ? "animate-spin" : ""}`} />
            Scan for Tasks
          </Button>

          {/* Chevron indicator */}
          <ChevronDown
            className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>
    </CollapsibleTrigger>

    {/* Content wrapped in CollapsibleContent */}
    <CollapsibleContent>
      {/* Empty state */}
      {!hasRecommendations && !scanMutation.isPending && (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground mb-2">
            No task recommendations yet
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            Click "Scan for Tasks" to analyze your recent notes
          </p>
        </div>
      )}

      {/* Cards */}
      {hasRecommendations && (
        <div className="space-y-3">
          {recommendations.map((rec: TaskRecommendation) => (
            <RecommendationCard key={rec.id} recommendation={rec} />
          ))}
        </div>
      )}
    </CollapsibleContent>
  </Collapsible>
);
```

**Step 2: Remove the outer className div**

Note: The `className` prop is now on `<Collapsible>` directly, so we don't need a wrapping div.

**Step 3: Verify the code compiles**

Run:
```bash
npm run typecheck
```

Expected: No TypeScript errors

**Step 4: Test in browser**

Run:
```bash
npm run dev
```

Navigate to `/tasks` and test:
- [ ] Section starts collapsed (no cards visible)
- [ ] Click header to expand - cards appear with smooth animation
- [ ] Click header again to collapse - cards disappear
- [ ] Chevron rotates 180deg when expanding
- [ ] Scan button works in both states
- [ ] Clear All button only appears when expanded
- [ ] Refresh page - state persists (stays collapsed or expanded)
- [ ] Clear localStorage (`localStorage.removeItem('recommendations-expanded')`) - defaults to collapsed

**Step 5: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): wrap content in Collapsible components

Wrap header in CollapsibleTrigger and cards/empty state in
CollapsibleContent. Enables smooth collapse/expand animation.

State controlled by isExpanded, persisted to localStorage.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Handle Loading State When Collapsed

Update loading skeleton to respect collapsed state.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx:99-108`

**Step 1: Update loading skeleton**

Find the loading state (lines ~99-108):

```typescript
if (isLoading) {
  return (
    <div className={className}>
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
```

Replace with a collapsed skeleton:

```typescript
if (isLoading) {
  return (
    <div className={className}>
      {/* Show collapsed header skeleton while loading */}
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}
```

**Step 2: Verify the code compiles**

Run:
```bash
npm run typecheck
```

Expected: No errors

**Step 3: Test loading state**

To test, you can temporarily add a delay in the query:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ["recommendations"],
  queryFn: async () => {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Add this line
    const response = await fetch("/api/tasks/recommendations?status=pending&limit=10");
    ...
  },
});
```

Navigate to `/tasks` and verify:
- Loading shows a single compact skeleton bar
- After loading, shows collapsed header (not expanded)

Remove the timeout after testing.

**Step 4: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): update loading skeleton for collapsed state

Show compact single-row skeleton during loading instead of full
card skeletons, consistent with collapsed default state.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Mobile Responsive Adjustments

Ensure the compact header works well on mobile screens.

**Files:**
- Modify: `src/components/recommendations/recommendations-list.tsx` (header section)

**Step 1: Add responsive classes to header**

Update the header div to add mobile-friendly sizing:

```typescript
<CollapsibleTrigger asChild>
  <div
    className="flex items-center justify-between p-3 lg:p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer mb-4 gap-2"
    role="button"
    tabIndex={0}
    aria-expanded={isExpanded}
    aria-label={`Suggested Tasks, ${recommendations.length} items, ${isExpanded ? 'expanded' : 'collapsed'}`}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsExpanded(!isExpanded);
      }
    }}
  >
    {/* Left side: Icon + Title + Badge */}
    <div className="flex items-center gap-2 min-w-0">
      <Sparkles className="h-4 w-4 lg:h-5 lg:w-5 text-purple-500 shrink-0" />
      <h2 className="text-base lg:text-lg font-semibold truncate">Suggested Tasks</h2>
      {hasRecommendations && (
        <Badge variant="default" className="shrink-0">{recommendations.length}</Badge>
      )}
    </div>

    {/* Right side: Action buttons + Chevron */}
    <div className="flex items-center gap-1 lg:gap-2 shrink-0">
      {/* Clear All - only shown when expanded */}
      {isExpanded && hasRecommendations && (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            clearAllMutation.mutate();
          }}
          disabled={clearAllMutation.isPending}
          className="hidden sm:flex"
        >
          <X className="h-4 w-4 mr-2" />
          Clear All
        </Button>
      )}

      {/* Scan button - always visible, icon-only on very small screens */}
      <Button
        size="sm"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation();
          scanMutation.mutate();
        }}
        disabled={scanMutation.isPending}
      >
        <RefreshCw className={`h-4 w-4 ${scanMutation.isPending ? "animate-spin" : ""}`} />
        <span className="ml-2 hidden sm:inline">Scan</span>
      </Button>

      {/* Chevron indicator */}
      <ChevronDown
        className={`h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground transition-transform duration-200 ${
          isExpanded ? 'rotate-180' : ''
        }`}
      />
    </div>
  </div>
</CollapsibleTrigger>
```

Changes:
- Padding: `p-3 lg:p-4`
- Icon sizes: `h-4 w-4 lg:h-5 lg:w-5`
- Title size: `text-base lg:text-lg`
- Clear All: `hidden sm:flex` (hide on very small screens)
- Scan button text: `hidden sm:inline` (icon-only on mobile)
- Gap adjustments: `gap-1 lg:gap-2`
- Truncate title: `truncate` to prevent overflow
- Shrink prevention: `shrink-0` on key elements

**Step 2: Verify the code compiles**

Run:
```bash
npm run typecheck
```

Expected: No errors

**Step 3: Test on mobile viewport**

In browser dev tools:
1. Open responsive design mode
2. Test at 375px width (iPhone SE)
3. Test at 768px width (iPad)
4. Verify:
   - [ ] Header fits without wrapping
   - [ ] Text doesn't overflow
   - [ ] Buttons remain tappable (min 44px height)
   - [ ] Scan button shows icon only on small screens
   - [ ] Clear All hidden on very small screens

**Step 4: Commit**

```bash
git add src/components/recommendations/recommendations-list.tsx
git commit -m "feat(recommendations): add mobile responsive adjustments

Optimize header for mobile screens:
- Reduce padding and icon sizes on mobile
- Hide 'Clear All' button on very small screens
- Show icon-only 'Scan' button on mobile
- Prevent text overflow with truncate
- Maintain comfortable tap targets

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Manual Testing and Edge Cases

Comprehensive testing of all functionality and edge cases.

**Files:**
- None (testing only)

**Step 1: Test basic functionality**

In browser at `/tasks`:

- [ ] Section starts collapsed on first visit
- [ ] Click header to expand
- [ ] Click header to collapse
- [ ] Chevron rotates smoothly
- [ ] Animation is smooth (no jank)
- [ ] Hover state is clear

**Step 2: Test state persistence**

- [ ] Expand section
- [ ] Refresh page - stays expanded
- [ ] Collapse section
- [ ] Refresh page - stays collapsed
- [ ] Open dev tools console: `localStorage.removeItem('recommendations-expanded')`
- [ ] Refresh - defaults to collapsed

**Step 3: Test button interactions**

- [ ] Click Scan while collapsed - doesn't expand section
- [ ] Click Scan while expanded - doesn't collapse section
- [ ] Scan completes and shows toast
- [ ] Click Clear All while expanded - doesn't collapse
- [ ] Clear All works correctly

**Step 4: Test keyboard navigation**

- [ ] Tab to header - focus visible
- [ ] Press Space - toggles expand/collapse
- [ ] Press Enter - toggles expand/collapse
- [ ] Tab to Scan button - works independently

**Step 5: Test with no recommendations**

- [ ] Clear all recommendations
- [ ] Section shows collapsed with "0" badge or no badge
- [ ] Expand to see empty state
- [ ] Click Scan - works correctly

**Step 6: Test with many recommendations**

Generate 10+ recommendations (use note cleanup feature multiple times):
- [ ] Badge shows accurate count
- [ ] Collapsed state looks same
- [ ] Expanded state shows all cards
- [ ] Scroll works if needed

**Step 7: Test mobile responsiveness**

Use browser dev tools responsive mode:

At 375px width:
- [ ] Header fits on one line
- [ ] Scan button shows icon only
- [ ] Clear All hidden
- [ ] All elements tappable

At 768px width:
- [ ] Scan button shows full text
- [ ] Clear All visible when expanded
- [ ] Layout looks balanced

**Step 8: Test dark mode**

Switch to dark mode:
- [ ] Colors correct in both states
- [ ] Hover effect visible
- [ ] Text readable

**Step 9: Document any issues**

If any issues found, create follow-up tasks.

---

## Task 9: Update Documentation

Add user-facing documentation for the new collapsible feature.

**Files:**
- Modify: `docs/features/task-recommendations.md` (or create if doesn't exist)

**Step 1: Create or update feature documentation**

Create/update `docs/features/task-recommendations.md`:

```markdown
# Task Recommendations

AI-powered task suggestions extracted from your notes and other content.

## Overview

The task recommendations system analyzes your content to identify potential tasks and action items. Recommendations appear on the Tasks page and can be accepted, edited, or dismissed.

## Using Task Recommendations

### Viewing Recommendations

On the Tasks page, task recommendations appear in a collapsible section at the top:

- **Collapsed** (default): Shows compact header with suggestion count
- **Expanded**: Click header to see all recommendations cards
- Your preference (collapsed/expanded) is remembered

### Scanning for Tasks

Click the **Scan for Tasks** button to analyze recent notes for new action items. The AI will:
1. Review your recent notes (last 7 days)
2. Identify potential tasks
3. Present them as recommendations with confidence scores

### Reviewing Recommendations

Each recommendation shows:
- **Task text**: What the AI suggests adding as a task
- **Confidence score**: How confident the AI is (0-100%)
- **Priority**: Suggested priority level (low/medium/high/urgent)
- **Reasoning**: Why this was identified as a task
- **Source**: Where the task was found (note, capture, etc.)

### Taking Action

For each recommendation:

- **Accept**: Creates a new task with the suggested text
  - You can edit the task text before accepting
- **Not a task**: Provide feedback that this shouldn't be a task
  - Helps improve future recommendations
- **Dismiss**: Remove without feedback

## Features

- Collapsible section to reduce clutter
- Badge in navigation shows pending count
- Edit task text before accepting
- Batch actions: Clear all recommendations
- Automatic scanning available
- Keyboard shortcuts supported

## Tips

- Accept high-confidence recommendations (>85%) first
- Edit task text to add context or deadlines
- Use "Not a task" feedback to train the AI
- Scan regularly to stay on top of action items
