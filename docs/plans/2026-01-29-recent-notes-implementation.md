# Recent Notes Section Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a featured Recent Notes section as the primary element on the dashboard with Apple-quality UX.

**Architecture:** Create new React components for the Recent Notes section with enhanced database query. Position as full-width featured section at top of dashboard. Use Framer Motion for smooth animations and maintain accessibility standards.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, TailwindCSS, Framer Motion, date-fns, Turso (SQLite)

---

## Task 1: Create Content Preview Utility

**Files:**
- Create: `src/lib/utils/text.ts`

**Step 1: Create the utility file**

```typescript
/**
 * Text utility functions for content processing
 */

/**
 * Get a preview of note content
 * @param contentPlain - Pre-processed plain text content
 * @param htmlContent - HTML content as fallback
 * @param maxLength - Maximum length of preview
 * @returns Truncated preview with ellipsis if needed
 */
export function getContentPreview(
  contentPlain: string | undefined | null,
  htmlContent: string,
  maxLength = 100
): string {
  // Use content_plain if available
  if (contentPlain && contentPlain.trim()) {
    const trimmed = contentPlain.trim();
    return trimmed.length > maxLength
      ? trimmed.slice(0, maxLength).trim() + '...'
      : trimmed;
  }

  // Fallback: strip HTML tags from content
  const stripped = htmlContent
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > maxLength
    ? stripped.slice(0, maxLength).trim() + '...'
    : stripped;
}
```

**Step 2: Commit**

```bash
git add src/lib/utils/text.ts
git commit -m "feat: add content preview utility function

Add getContentPreview utility to extract and truncate note content
for display in card previews.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Recent Note Card Component

**Files:**
- Create: `src/components/dashboard/recent-note-card.tsx`

**Step 1: Create the card component**

```typescript
'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Note } from '@/lib/db/schema';

interface RecentNoteWithProject extends Note {
  project_name?: string;
  project_color?: string;
}

interface RecentNoteCardProps {
  note: RecentNoteWithProject;
  index: number;
  contentPreview: string;
}

export function RecentNoteCard({ note, index, contentPreview }: RecentNoteCardProps) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.05,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      <Link
        href={`/notes/${note.slug}`}
        className={cn(
          // Base card styling
          'group block rounded-xl border bg-card p-4 lg:p-5',
          'shadow-sm hover:shadow-md',

          // Smooth transitions
          'transition-all duration-200 ease-out',
          'hover:scale-[1.02]',
          'hover:border-primary/20',
          'hover:bg-accent/5',

          // Touch optimization
          'min-h-[88px]',
          'active:scale-[0.98]',

          // Focus states
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
        )}
        aria-label={`Note: ${note.title}${note.project_name ? `, in project ${note.project_name}` : ''}, updated ${formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}`}
      >
        <article className="space-y-2.5">
          {/* Title */}
          <h3 className="text-base lg:text-lg font-semibold tracking-tight line-clamp-2">
            {note.title}
          </h3>

          {/* Project Badge + Timestamp */}
          <div className="flex flex-wrap items-center gap-2">
            {note.project_name && (
              <div className="flex items-center gap-1.5" aria-label={`Project: ${note.project_name}`}>
                <div
                  className="w-2 h-2 rounded-full shadow-sm"
                  style={{ backgroundColor: note.project_color || '#6366f1' }}
                  aria-hidden="true"
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {note.project_name}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-muted-foreground/80">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <time dateTime={note.updated_at} suppressHydrationWarning>
                {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
              </time>
            </div>
          </div>

          {/* Content Preview */}
          {contentPreview && (
            <p className="text-sm text-muted-foreground/60 leading-relaxed line-clamp-2">
              {contentPreview}
            </p>
          )}
        </article>
      </Link>
    </motion.li>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/recent-note-card.tsx
git commit -m "feat: add recent note card component

Create individual card component for recent notes with:
- Apple-style animations and hover states
- Project badge with color indicator
- Relative timestamps
- Content preview
- Full accessibility support

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Recent Notes Section Component

**Files:**
- Create: `src/components/dashboard/recent-notes-section.tsx`

**Step 1: Create the section component**

```typescript
'use client';

import Link from 'next/link';
import { ArrowRight, FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecentNoteCard } from './recent-note-card';
import { getContentPreview } from '@/lib/utils/text';
import type { Note } from '@/lib/db/schema';

interface RecentNoteWithProject extends Note {
  project_name?: string;
  project_color?: string;
}

interface RecentNotesSectionProps {
  notes: RecentNoteWithProject[];
}

export function RecentNotesSection({ notes }: RecentNotesSectionProps) {
  return (
    <section aria-labelledby="recent-notes-heading" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2
          id="recent-notes-heading"
          className="text-xl lg:text-2xl font-bold tracking-tight"
        >
          Recent Notes
        </h2>
        <Link
          href="/notes"
          className="text-sm lg:text-base text-primary hover:underline flex items-center gap-1.5 transition-colors"
          aria-label="View all notes"
        >
          See all notes
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Notes Grid or Empty State */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 lg:py-16 border rounded-xl bg-muted/30">
          <FileText className="h-12 w-12 lg:h-16 lg:w-16 text-muted-foreground/40 mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold mb-2">No notes yet</h3>
          <p className="text-sm text-muted-foreground mb-4 text-center px-4">
            Start capturing your thoughts and ideas
          </p>
          <Button asChild>
            <Link href="/notes/new">
              <Plus className="h-4 w-4 mr-2" />
              Create your first note
            </Link>
          </Button>
        </div>
      ) : (
        <nav aria-label="Recent notes">
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
            {notes.map((note, index) => (
              <RecentNoteCard
                key={note.id}
                note={note}
                index={index}
                contentPreview={getContentPreview(note.content_plain, note.content)}
              />
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/recent-notes-section.tsx
git commit -m "feat: add recent notes section component

Create main section component with:
- Header with 'See all notes' link
- Responsive grid layout (1/2/3 columns)
- Empty state with CTA
- Accessibility semantic HTML

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Skeleton Loading Component

**Files:**
- Modify: `src/components/dashboard/recent-notes-section.tsx`

**Step 1: Add skeleton component to the file**

Add this export at the end of `recent-notes-section.tsx`:

```typescript
/**
 * Loading skeleton for Recent Notes section
 */
export function RecentNotesSectionSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-6 w-32 bg-muted animate-pulse rounded" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="rounded-xl border bg-card p-4 lg:p-5 space-y-3"
          >
            <div className="h-6 bg-muted animate-pulse rounded w-3/4" />
            <div className="flex gap-2">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-muted animate-pulse rounded" />
              <div className="h-4 bg-muted animate-pulse rounded w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/recent-notes-section.tsx
git commit -m "feat: add skeleton loading state for recent notes

Add loading skeleton that matches the final layout with 7 cards.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update Dashboard Data Query

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:25-101`

**Step 1: Update the getDashboardData function**

Replace the `recentNotes` query (lines 37-43) with:

```typescript
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
```

**Step 2: Update the return statement**

Change line 78 from:
```typescript
recentNotes,
```

To:
```typescript
recentNotesWithProjects,
```

**Step 3: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat: enhance dashboard query for recent notes with projects

Update getDashboardData to fetch recent notes with project information
using LEFT JOIN. Increase limit from 5 to 7 notes.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Update Dashboard Layout - Add Import

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:1-23`

**Step 1: Add import for new components**

Add to the imports section (after line 10):

```typescript
import { RecentNotesSection, RecentNotesSectionSkeleton } from "@/components/dashboard/recent-notes-section";
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat: import recent notes components

Add imports for RecentNotesSection and skeleton.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update Dashboard Skeleton

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:103-126`

**Step 1: Update DashboardSkeleton function**

Replace the entire `DashboardSkeleton` function (lines 103-126) with:

```typescript
function DashboardSkeleton() {
  return (
    <>
      <ActionBar />
      <div className="p-3 lg:p-6 space-y-3 lg:space-y-6">
        {/* Recent Notes skeleton - FIRST */}
        <RecentNotesSectionSkeleton />

        {/* Mobile: Insights first */}
        <div className="lg:hidden space-y-3">
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
        </div>

        {/* Graph skeleton */}
        <div className="h-12 lg:h-96 bg-muted animate-pulse rounded-lg" />

        {/* Quick access skeleton - 2 columns now */}
        <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
          <div className="h-48 bg-muted animate-pulse rounded-lg" />
          <div className="h-48 bg-muted animate-pulse rounded-lg" />
        </div>
      </div>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat: update dashboard skeleton with recent notes

Add RecentNotesSectionSkeleton as first element and reduce Quick Access
grid from 3 to 2 columns.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update Dashboard Content Layout

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:128-278`

**Step 1: Add Recent Notes section at the top**

After the error banner (around line 144), add:

```typescript
        {/* 🌟 FEATURED: Recent Notes Section - FIRST/PRIMARY */}
        <RecentNotesSection notes={data.recentNotesWithProjects} />
```

**Step 2: Remove old Recent Notes card**

Delete the entire "Recent Notes" Card section (lines 172-202), keeping only:
- Active Projects card
- Pending Tasks card

**Step 3: Update Quick Access grid**

Change line 171 from:
```typescript
<div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6">
```

To:
```typescript
<div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
```

**Step 4: Verify the final structure**

The layout should now be:
```typescript
<div className="space-y-3 p-3 lg:space-y-6 lg:p-6">
  {/* Error Banner */}

  {/* Recent Notes Section - NEW */}
  <RecentNotesSection notes={data.recentNotesWithProjects} />

  {/* Graph + Insights */}
  <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 lg:gap-6">
    ...
  </div>

  {/* Quick Access - Projects + Tasks only (2 columns) */}
  <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-6">
    <Card>Active Projects</Card>
    <Card>Pending Tasks</Card>
  </div>
</div>
```

**Step 5: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat: integrate recent notes section into dashboard layout

- Add RecentNotesSection as first element after error banner
- Remove old Recent Notes card from Quick Access
- Change Quick Access grid from 3 to 2 columns (Projects + Tasks only)
- Recent Notes is now the primary/featured dashboard element

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Test the Implementation

**Files:**
- No file changes

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Manual testing checklist**

Navigate to `http://localhost:3000` and verify:

- [ ] Recent Notes section appears first (before graph)
- [ ] Shows up to 7 notes
- [ ] Project badges display with correct colors
- [ ] Timestamps show relative format ("2 hours ago")
- [ ] Content previews are truncated appropriately
- [ ] Empty state shows when no notes exist
- [ ] "See all notes" link navigates to `/notes`
- [ ] Cards are clickable and navigate to `/notes/{slug}`
- [ ] Hover animations are smooth (scale, shadow)
- [ ] Mobile layout shows single column
- [ ] Desktop shows 3 columns
- [ ] Tablet shows 2 columns
- [ ] Keyboard navigation works (Tab through cards)
- [ ] Focus rings are visible
- [ ] No console errors
- [ ] No hydration warnings

**Step 3: Test accessibility**

```bash
# Install axe DevTools browser extension if not already installed
# Run automated accessibility scan on dashboard
```

Verify:
- [ ] No accessibility violations
- [ ] Screen reader announces cards correctly
- [ ] Time elements have datetime attribute
- [ ] Semantic HTML (section, nav, ul, li, article)

**Step 4: Test edge cases**

Create test scenarios:
- [ ] User with 0 notes (empty state)
- [ ] User with 1 note
- [ ] User with 7+ notes (only 7 shown)
- [ ] Notes without projects assigned
- [ ] Notes with very long titles
- [ ] Notes without content_plain (HTML fallback)

**Step 5: Performance check**

Open DevTools Network tab:
- [ ] Dashboard loads without additional API calls
- [ ] Query time is reasonable (<100ms)
- [ ] Page fully interactive quickly

---

## Task 10: Final Verification and Documentation

**Files:**
- Modify: `docs/plans/2026-01-29-recent-notes-section-design.md`

**Step 1: Update design doc with implementation status**

Add to the end of the design document:

```markdown
## Implementation Complete

**Date Completed:** 2026-01-29

**Deployed Components:**
- ✅ `src/lib/utils/text.ts` - Content preview utility
- ✅ `src/components/dashboard/recent-note-card.tsx` - Individual card
- ✅ `src/components/dashboard/recent-notes-section.tsx` - Section container + skeleton
- ✅ `src/app/(dashboard)/page.tsx` - Dashboard layout integration

**Testing Results:**
- All manual tests passed
- Accessibility scan: No violations
- Performance: Query time <100ms
- Responsive layouts verified on mobile/tablet/desktop

**Known Issues:** None

**Future Improvements:**
- Consider adding note thumbnails for image-heavy notes
- Explore pinning favorite notes to top
```

**Step 2: Commit**

```bash
git add docs/plans/2026-01-29-recent-notes-section-design.md
git commit -m "docs: mark recent notes implementation as complete

Update design document with implementation status and testing results.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 3: Create summary commit**

```bash
git log --oneline -10 > /tmp/recent-notes-commits.txt
# Review the commits to ensure they tell a clear story
```

**Step 4: Push to remote (if ready)**

```bash
# Only run if you want to push immediately
# git push origin main
```

---

## Success Criteria

✅ Recent Notes section is the first element on dashboard
✅ Shows 7 most recently edited notes
✅ Displays title, project (with color), timestamp, content preview
✅ All cards are clickable and navigate correctly
✅ Empty state with CTA when no notes exist
✅ Smooth Apple-style animations and interactions
✅ Fully accessible (WCAG AAA)
✅ Responsive across mobile/tablet/desktop
✅ No performance degradation
✅ No console errors or warnings

## Rollback Plan

If issues arise:

```bash
# Revert all commits from this feature
git log --oneline --grep="recent notes" -10
git revert <commit-hash-range>

# Or reset to before feature (destructive)
git reset --hard <commit-before-feature>
```

---

**Total Tasks:** 10
**Estimated Time:** 45-60 minutes
**Complexity:** Medium
