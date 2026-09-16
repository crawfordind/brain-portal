# Compact Task Recommendations Section - Design Document

**Date:** 2026-02-02
**Status:** Approved
**Owner:** Brain Portal Team

## Overview

Redesign the task recommendations section to take up less vertical space while maintaining all functionality. Convert from always-expanded to a collapsible component that starts collapsed by default, allowing users to see their pending tasks sooner.

## Problem Statement

**Current Issues:**
- Task recommendations section takes 400-600px of vertical space (for 2-3 cards)
- Pushes pending tasks below the fold on many screens
- Users must scroll past suggestions to see actual tasks
- Section is always visible even when users don't need it

**User Impact:**
- "I want to see my pending tasks sooner"
- "Suggested tasks should take up less real estate"
- "Don't want to lose functionality but want cleaner layout"

## Requirements

### Core Features (Must Have)
1. **Collapsible section** - Expand/collapse recommendations
2. **Start collapsed by default** - Clean view on page load
3. **Compact header** - Shows icon, title, count badge, and actions
4. **Persistent state** - Remember user's expand/collapse preference
5. **All existing functionality** - Cards, scan, clear all, accept/reject buttons unchanged

### User Experience
- Click header to expand/collapse
- Badge shows count even when collapsed
- Smooth animation when expanding/collapsing
- Scan button accessible in both states
- Pending tasks visible immediately on page load

### Design Constraints
- No loss of functionality
- Maintain professional UI/UX standards
- Keep mobile responsiveness
- Follow existing design patterns

## Architecture

### Visual Design

**Collapsed State (Default):**
```
┌─────────────────────────────────────────────────────────┐
│ ✨ Suggested Tasks [5] [Scan for Tasks] [▼]             │
└─────────────────────────────────────────────────────────┘
Height: ~44-48px (vs current 400-600px)
```

**Expanded State:**
```
┌─────────────────────────────────────────────────────────┐
│ ✨ Suggested Tasks [5] [Clear All] [Scan for Tasks] [▲] │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  [Recommendation Card 1]                                  │
│  • Task text                                              │
│  • Reasoning                                              │
│  • Accept / Not a task buttons                            │
│                                                           │
│  [Recommendation Card 2]                                  │
│  ...                                                      │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Component Structure

**Before:**
```jsx
<RecommendationsList>
  <Header>
    <Title + Badge />
    <Buttons />
  </Header>
  <Cards /> {/* Always visible */}
</RecommendationsList>
```

**After:**
```jsx
<RecommendationsList>
  <Collapsible open={isExpanded}>
    <CollapsibleTrigger asChild>
      <Header clickable> {/* Single row, compact */}
        <Left: Icon + Title + Badge />
        <Right: Scan + ClearAll (if expanded) + Chevron />
      </Header>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <Cards /> {/* Shown only when expanded */}
    </CollapsibleContent>
  </Collapsible>
</RecommendationsList>
```

### State Management

**Local State:**
```typescript
const [isExpanded, setIsExpanded] = useState(() => {
  // Read from localStorage on mount, default to false
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('recommendations-expanded');
    return stored === 'true';
  }
  return false;
});

// Persist to localStorage on change
useEffect(() => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('recommendations-expanded', String(isExpanded));
  }
}, [isExpanded]);
```

**LocalStorage Key:** `recommendations-expanded`
**Default Value:** `false` (collapsed)

### Interaction Patterns

**Toggle Expand/Collapse:**
- Click anywhere on header (except buttons)
- Keyboard: Space or Enter when header focused
- Visual feedback: Chevron rotates 180deg, smooth height transition

**Button Click Handling:**
```typescript
<div onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer">
  <Button onClick={(e) => e.stopPropagation()}>
    {/* stopPropagation prevents expanding when clicking action buttons */}
  </Button>
</div>
```

**Animation:**
- Use Radix UI Collapsible component (already in project)
- Height transition: 200-300ms ease-in-out
- Chevron rotation: 200ms ease-in-out
- No layout shift - content flows smoothly

## Implementation

### Files to Modify

**Primary:**
- `src/components/recommendations/recommendations-list.tsx`
  - Add Collapsible wrapper
  - Add state management
  - Restructure header layout
  - Add chevron icon
  - Make header clickable

**No Changes Needed:**
- `src/components/recommendations/recommendation-card.tsx` - Unchanged
- `src/app/(dashboard)/tasks/page.tsx` - Unchanged (just renders RecommendationsList)
- API routes - Unchanged

### Component Implementation

**Import Collapsible:**
```typescript
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
```

**Header Structure:**
```typescript
<CollapsibleTrigger asChild>
  <div
    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer"
    role="button"
    aria-expanded={isExpanded}
    aria-label={`Suggested Tasks, ${recommendations.length} items`}
  >
    {/* Left side */}
    <div className="flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-purple-500" />
      <h2 className="text-lg font-semibold">Suggested Tasks</h2>
      {hasRecommendations && (
        <Badge variant="default">{recommendations.length}</Badge>
      )}
    </div>

    {/* Right side */}
    <div className="flex items-center gap-2">
      {/* Action buttons with stopPropagation */}
      <Button onClick={(e) => e.stopPropagation()}>...</Button>

      {/* Chevron indicator */}
      <ChevronDown
        className={`h-5 w-5 transition-transform duration-200 ${
          isExpanded ? 'rotate-180' : ''
        }`}
      />
    </div>
  </div>
</CollapsibleTrigger>
```

**Content Wrapper:**
```typescript
<CollapsibleContent className="pt-4">
  {/* Empty state */}
  {!hasRecommendations && !scanMutation.isPending && (
    <div className="text-center py-12 border-2 border-dashed rounded-lg">
      ...
    </div>
  )}

  {/* Recommendation cards */}
  {hasRecommendations && (
    <div className="space-y-3">
      {recommendations.map((rec) => (
        <RecommendationCard key={rec.id} recommendation={rec} />
      ))}
    </div>
  )}
</CollapsibleContent>
```

### Button Visibility Logic

**Scan Button:**
- Always visible (both collapsed and expanded)
- Allows quick scanning without expanding

**Clear All Button:**
- Only visible when expanded
- Conditional rendering: `{isExpanded && hasRecommendations && <Button>Clear All</Button>}`

### Accessibility

**ARIA Attributes:**
- `role="button"` on CollapsibleTrigger
- `aria-expanded={isExpanded}` on header
- `aria-label="Suggested Tasks, N items, collapsed/expanded"`

**Keyboard Support:**
- Focus on header with Tab
- Space/Enter to toggle
- Focus remains on header after toggle

**Screen Reader:**
- Announces state changes
- Reads count and expanded/collapsed status

## Edge Cases

### 1. First Visit (No localStorage)
**Scenario:** User visits tasks page for first time
**Behavior:** Section starts collapsed (default), saves to localStorage on first interaction
**Expected:** Clean view, encourages focus on pending tasks

### 2. Empty Recommendations
**Scenario:** No pending recommendations exist
**Behavior:**
- Collapsed: Shows header with "0" badge or no badge
- Expanded: Shows empty state with "Scan for Tasks" prompt
**Expected:** Section still functional, encourages scanning

### 3. Loading State
**Scenario:** Recommendations are being fetched
**Behavior:** Show skeleton in collapsed state, or keep collapsed during loading
**Expected:** No layout shift, smooth loading experience

### 4. New Recommendations Arrive
**Scenario:** Background polling fetches new recommendations
**Behavior:** Badge count updates, but section stays collapsed (respects user choice)
**Expected:** User sees updated count, expands when ready

### 5. Mobile Small Screens
**Scenario:** Very narrow screens (<400px)
**Behavior:** Header remains single row, buttons may reduce in size or show icons only
**Expected:** All elements remain accessible, no horizontal overflow

### 6. Many Recommendations (10+)
**Scenario:** User has accumulated many pending recommendations
**Behavior:** Collapsed state looks same, expanded shows all cards with scroll
**Expected:** Badge shows accurate count, expanded content scrollable

## Testing Strategy

### Manual Testing

**Functional Tests:**
- [ ] Section starts collapsed on first visit
- [ ] Click header to expand
- [ ] Click header again to collapse
- [ ] Refresh page - state persists
- [ ] Clear localStorage - defaults to collapsed
- [ ] Scan button works when collapsed
- [ ] Scan button works when expanded
- [ ] Clear All button only visible when expanded
- [ ] Accept/reject cards work when expanded
- [ ] Badge count updates when recommendations change

**Visual Tests:**
- [ ] Chevron rotates smoothly
- [ ] Height transition is smooth (no jank)
- [ ] Hover state on header is clear
- [ ] Mobile: all buttons fit or wrap gracefully
- [ ] Dark mode: colors correct in both states

**Accessibility Tests:**
- [ ] Tab to header, focus visible
- [ ] Space/Enter toggles expand/collapse
- [ ] Screen reader announces state
- [ ] aria-expanded updates correctly

### Browser Testing
- Chrome, Firefox, Safari (desktop)
- Chrome, Safari (mobile)
- Test localStorage across browsers

### Regression Testing
- [ ] All existing card functionality works
- [ ] Scan feature works same as before
- [ ] Clear All works same as before
- [ ] Accept/reject feedback still works
- [ ] Query invalidation still works
- [ ] Toast notifications still appear

## Success Metrics

**Quantitative:**
- Vertical space reduced: ~350-550px saved when collapsed
- Time to see pending tasks: Reduced by scroll distance
- User preference: Track localStorage value over time

**Qualitative:**
- Users report seeing tasks sooner
- No complaints about lost functionality
- Positive feedback on cleaner layout

## Future Enhancements

1. **Keyboard shortcuts** - Press 'S' to toggle suggestions section
2. **Badge in collapsed header** - Show "NEW" indicator when fresh recommendations arrive
3. **Expand on hover** - Optional setting to auto-expand on mouse hover
4. **Quick peek** - Show first 1-2 recommendations in collapsed state
5. **Animation options** - User preference for animation speed/style
6. **Remember per-session** - Option to collapse on every page load regardless of localStorage

## Design Rationale

**Why collapsible over other approaches?**
- Preserves all functionality in-place
- Familiar interaction pattern
- No navigation/context switching
- Simple to implement with existing components
- Respects user's choice (persistent state)

**Why start collapsed?**
- User's primary goal: see pending tasks
- Badge in navigation already shows count
- Reduces initial cognitive load
- User can expand when ready to review suggestions

**Why persist state?**
- Respects user preference
- Reduces repeated interactions
- Progressive enhancement (works without localStorage)

**Why single-row header?**
- Maximizes space savings when collapsed
- Keeps actions accessible
- Modern, clean design pattern
