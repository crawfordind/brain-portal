# UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform brain-portal into a command-first dashboard by consolidating navigation around UnifiedSearch, cleaning up redundant components, and fixing critical UX issues.

**Architecture:** Remove 5 redundant components (ActionBar, Command Palette, SearchHeader, InsightsCard, CapturesCard), enhance UnifiedSearch as the primary interaction point, redesign dashboard with hero section prioritizing active projects and recent notes, implement centered cursor tracking in editor, and consolidate AI insights into a single unified feed.

**Tech Stack:** Next.js 16 (App Router), React 18, TipTap editor, React Query, TypeScript, Tailwind CSS

**Related Design Doc:** `docs/plans/2026-02-13-ux-improvements-design.md`

---

## Phase 1: Component Cleanup

### Task 1.1: Remove ActionBar Component

**Files:**
- Delete: `src/components/dashboard/action-bar.tsx`
- Modify: `src/app/(dashboard)/page.tsx:7,196`
- Modify: `src/hooks/use-inbox-count.tsx` (check if used elsewhere)

**Step 1: Check ActionBar usage**

```bash
grep -r "ActionBar" src/ --include="*.tsx" --include="*.ts"
```

Expected: Only found in `src/app/(dashboard)/page.tsx`

**Step 2: Remove ActionBar from dashboard**

In `src/app/(dashboard)/page.tsx`:
- Remove line 7: `import { ActionBar } from "@/components/dashboard/action-bar";`
- Remove line 196: `<ActionBar />`
- Remove line 164: `<ActionBar />` (in skeleton)

**Step 3: Delete ActionBar component**

```bash
rm src/components/dashboard/action-bar.tsx
```

**Step 4: Check if use-inbox-count is still needed**

```bash
grep -r "use-inbox-count" src/ --include="*.tsx" --include="*.ts"
```

If only used by ActionBar, we can remove it later. Otherwise, keep for now.

**Step 5: Verify app compiles**

```bash
npm run typecheck
```

Expected: No errors (dashboard might look empty, that's OK)

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove ActionBar component

ActionBar is redundant with UnifiedSearch. All quick actions
will be moved to UnifiedSearch commands.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Remove Command Palette Component

**Files:**
- Delete: `src/components/command-palette/` (entire directory)
- Modify: `src/app/(dashboard)/layout.tsx:3,32`
- Modify: `src/lib/stores/command-store.ts` (check if used elsewhere)
- Modify: `src/lib/hooks/use-command-palette.ts` (keep - used by UnifiedSearch)

**Step 1: Check CommandPalette usage**

```bash
grep -r "CommandPalette\|command-palette" src/ --include="*.tsx" --include="*.ts"
```

Expected: Found in layout.tsx and possibly store/hooks

**Step 2: Remove CommandPalette from layout**

In `src/app/(dashboard)/layout.tsx`:
- Remove line 3: `import { CommandPalette } from "@/components/command-palette";`
- Remove line 32: `<CommandPalette />`

**Step 3: Update layout comments**

In `src/app/(dashboard)/layout.tsx`, update the comment block (lines 15-20):

```tsx
/**
 * Dashboard Layout
 *
 * Wraps all dashboard pages with the responsive layout system.
 * The ResponsiveLayout handles:
 * - Desktop: Full sidebar (256px) visible
 * - Mobile/Tablet: Mobile header + bottom navigation
 *
 * RESPONSIVE: Layout switches at lg breakpoint (1024px)
 *
 * VOICE: VoiceProvider enables global voice capture with FAB,
 * voice commands, and onboarding experience.
 *
 * UNIFIED SEARCH: Global search and command palette accessible via:
 * - Desktop: Always visible in header, Cmd+K to focus
 * - Mobile: Search icon in header
 */
```

**Step 4: Delete command palette directory**

```bash
rm -rf src/components/command-palette/
```

**Step 5: Check command-store usage**

```bash
grep -r "command-store" src/ --include="*.tsx" --include="*.ts"
```

If still used by UnifiedSearch, keep it. Otherwise delete.

**Step 6: Verify app compiles**

```bash
npm run typecheck
```

Expected: No errors

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove Command Palette component

Command Palette (Cmd+K) is replaced by UnifiedSearch which
provides the same functionality with better discoverability.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 1.3: Remove SearchHeader Component

**Files:**
- Delete: `src/components/layout/search-header.tsx`
- Check: No imports needed to remove (not currently used)

**Step 1: Check SearchHeader usage**

```bash
grep -r "SearchHeader\|search-header" src/ --include="*.tsx" --include="*.ts"
```

Expected: Not used anywhere (superseded by UnifiedSearch)

**Step 2: Delete SearchHeader**

```bash
rm src/components/layout/search-header.tsx
```

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove SearchHeader component

SearchHeader is redundant with UnifiedSearch in ResponsiveLayout.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 1.4: Remove Dashboard Quick Action Buttons

**Files:**
- Modify: `src/app/(dashboard)/page.tsx:215-234`

**Step 1: Remove quick action buttons from dashboard**

In `src/app/(dashboard)/page.tsx`, remove lines 215-234:

```tsx
// DELETE THIS BLOCK:
          <div className="flex gap-2">
            <Link href="/notes/new">
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Note</span>
              </Button>
            </Link>
            <Link href="/tasks">
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Task</span>
              </Button>
            </Link>
            <Link href="/projects">
              <Button size="sm" variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Project</span>
              </Button>
            </Link>
          </div>
```

**Step 2: Remove Plus icon import if unused**

Check if Plus is still used elsewhere in the file. If not, remove from imports (line 24).

**Step 3: Verify app compiles**

```bash
npm run typecheck
```

Expected: No errors

**Step 4: Start dev server to check visually**

```bash
npm run dev
```

Visit http://localhost:3000 - buttons should be gone from dashboard hero

**Step 5: Commit**

```bash
git add src/app/\(dashboard\)/page.tsx
git commit -m "refactor: remove quick action buttons from dashboard

Quick actions moved to UnifiedSearch for cleaner dashboard.
Users can create content via search (Cmd+K) instead.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: UnifiedSearch Enhancement

### Task 2.1: Add Creation Commands to UnifiedSearch

**Files:**
- Modify: `src/lib/hooks/use-command-palette.ts` (if it defines commands)
- Modify: `src/components/layout/unified-search.tsx:36,59`

**Step 1: Locate command definitions**

```bash
grep -r "mainNav\|commands" src/lib/hooks/use-command-palette.ts
```

Understand where commands are defined.

**Step 2: Add Quick Capture command**

In `src/lib/hooks/use-command-palette.ts` (or wherever commands are defined), add:

```tsx
import { Zap, Calendar, FileText, CheckSquare, FolderKanban } from 'lucide-react';
import { useRouter } from 'next/navigation';

// Add to commands array
{
  id: 'quick-capture',
  label: 'Quick Capture',
  description: 'Capture a thought, link, or idea',
  icon: Zap,
  category: 'creation',
  handler: () => {
    // TODO: Open quick capture dialog
    // For now, navigate to home (captures page)
    router.push('/');
  }
},
```

**Step 3: Add Daily Note command**

```tsx
{
  id: 'daily-note',
  label: "Today's Daily Note",
  description: "Create or open today's daily note",
  icon: Calendar,
  category: 'creation',
  handler: async () => {
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch(`/api/daily?date=${today}`);

    if (response.ok) {
      const data = await response.json();
      if (data.note) {
        router.push(`/notes/${data.note.slug}`);
        return;
      }
    }

    // Create if doesn't exist
    const createResponse = await fetch('/api/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: today }),
    });

    if (createResponse.ok) {
      const data = await createResponse.json();
      router.push(`/notes/${data.note.slug}`);
    }
  }
},
```

**Step 4: Add New Note, Task, Project commands**

```tsx
{
  id: 'new-note',
  label: 'New Note',
  description: 'Create a new note',
  icon: FileText,
  category: 'creation',
  handler: () => router.push('/notes/new')
},
{
  id: 'new-task',
  label: 'New Task',
  description: 'Add a task to your list',
  icon: CheckSquare,
  category: 'creation',
  handler: () => router.push('/tasks')
},
{
  id: 'new-project',
  label: 'New Project',
  description: 'Start a new project',
  icon: FolderKanban,
  category: 'creation',
  handler: () => {
    // TODO: Open project creation dialog
    router.push('/projects');
  }
},
```

**Step 5: Update UnifiedSearch to show creation commands when empty**

In `src/components/layout/unified-search.tsx`, modify line 59:

```tsx
// OLD:
const filteredCommands = query.length >= 1
  ? searchCommands(query).slice(0, 5)
  : commands.filter(cmd => cmd.category === 'creation').slice(0, 4);

// NEW:
const filteredCommands = query.length >= 1
  ? searchCommands(query).slice(0, 5)
  : commands.filter(cmd => cmd.category === 'creation').slice(0, 5); // Show 5 creation commands
```

**Step 6: Test in browser**

```bash
npm run dev
```

1. Open app
2. Click search bar (desktop) or search icon (mobile)
3. Should see 5 "Quick Actions": Quick Capture, Daily Note, New Note, New Task, New Project
4. Click "New Note" - should navigate to /notes/new
5. Type "daily" in search - should see "Today's Daily Note" in results

**Step 7: Commit**

```bash
git add src/lib/hooks/use-command-palette.ts src/components/layout/unified-search.tsx
git commit -m "feat: add creation commands to UnifiedSearch

Add Quick Capture, Daily Note, New Note, Task, and Project
commands to UnifiedSearch. Shows as Quick Actions when search
is empty for better discoverability.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2.2: Add Keyboard Shortcuts to Commands

**Files:**
- Modify: `src/components/layout/unified-search.tsx:78-98`
- Modify: `src/lib/hooks/use-command-palette.ts` (add shortcut property)

**Step 1: Add shortcut property to commands**

In `src/lib/hooks/use-command-palette.ts`, update command type and add shortcuts:

```tsx
export interface Command {
  id: string;
  label: string;
  description: string;
  icon: any;
  category: string;
  shortcut?: string; // Add this
  handler: () => void;
}

// Update commands
{
  id: 'quick-capture',
  label: 'Quick Capture',
  description: 'Capture a thought, link, or idea',
  icon: Zap,
  category: 'creation',
  shortcut: '⌘⇧C', // Add this
  handler: () => { ... }
},
{
  id: 'daily-note',
  label: "Today's Daily Note",
  description: "Create or open today's daily note",
  icon: Calendar,
  category: 'creation',
  shortcut: '⌘⇧D', // Add this
  handler: async () => { ... }
},
```

**Step 2: Register global keyboard shortcuts**

In `src/components/layout/unified-search.tsx`, add after the existing keyboard handler (around line 98):

```tsx
// Register global shortcuts for creation commands
useEffect(() => {
  if (!isMounted) return;

  const handleGlobalShortcuts = (e: KeyboardEvent) => {
    // Cmd+Shift+C for Quick Capture
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
      e.preventDefault();
      const captureCmd = commands.find(cmd => cmd.id === 'quick-capture');
      captureCmd?.handler();
    }

    // Cmd+Shift+D for Daily Note
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
      e.preventDefault();
      const dailyCmd = commands.find(cmd => cmd.id === 'daily-note');
      dailyCmd?.handler();
    }
  };

  document.addEventListener('keydown', handleGlobalShortcuts);
  return () => document.removeEventListener('keydown', handleGlobalShortcuts);
}, [isMounted, commands]);
```

**Step 3: Display shortcuts in dropdown**

In `src/components/layout/unified-search.tsx`, find where commands are rendered (around line 364-386 for desktop, 241-263 for mobile).

Update to show shortcuts:

```tsx
// Desktop version (around line 382-384):
{'shortcut' in cmd && cmd.shortcut && (
  <div className="text-xs text-muted-foreground font-mono">{cmd.shortcut}</div>
)}
```

For mobile, we don't show shortcuts (too cluttered).

**Step 4: Test keyboard shortcuts**

```bash
npm run dev
```

1. Press `Cmd+Shift+C` - should open quick capture / navigate to home
2. Press `Cmd+Shift+D` - should create/open daily note
3. Open search with `Cmd+K` - should see shortcuts displayed next to commands

**Step 5: Commit**

```bash
git add src/lib/hooks/use-command-palette.ts src/components/layout/unified-search.tsx
git commit -m "feat: add keyboard shortcuts for creation commands

- Cmd+Shift+C: Quick Capture
- Cmd+Shift+D: Today's Daily Note
- Display shortcuts in UnifiedSearch dropdown

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2.3: Enhance Visual Prominence of UnifiedSearch

**Files:**
- Modify: `src/components/layout/unified-search.tsx:331-342,184-189`
- Modify: `src/components/layout/responsive-layout.tsx:43-44`

**Step 1: Increase search bar height on desktop**

In `src/components/layout/unified-search.tsx`, find the desktop search input (around line 331-342):

```tsx
// OLD:
<Input
  ref={inputRef}
  type="text"
  placeholder="Search or run a command..."
  value={query}
  onChange={handleInputChange}
  onFocus={handleInputFocus}
  className="pl-10 pr-10 w-full"
/>

// NEW:
<Input
  ref={inputRef}
  type="text"
  placeholder="Search or run a command..."
  value={query}
  onChange={handleInputChange}
  onFocus={handleInputFocus}
  className="pl-10 pr-10 w-full h-11" // Add h-11 (44px)
/>
```

**Step 2: Make search icon larger on mobile**

In `src/components/layout/unified-search.tsx`, mobile button (around line 184-189):

```tsx
// OLD:
<Button
  variant="ghost"
  size="icon"
  onClick={() => setIsMobileOverlayOpen(true)}
  aria-label="Open search"
>
  <Search className="h-5 w-5" />
</Button>

// NEW:
<Button
  variant="ghost"
  size="icon"
  onClick={() => setIsMobileOverlayOpen(true)}
  aria-label="Open search"
  className="h-10 w-10" // Make button larger
>
  <Search className="h-6 w-6" /> {/* Increase from h-5 to h-6 */}
</Button>
```

**Step 3: Update placeholder text in mobile**

In `src/components/layout/unified-search.tsx`, mobile overlay input (around line 203):

```tsx
// OLD:
placeholder="Search or run a command..."

// NEW:
placeholder="Search or create..." // Shorter for mobile
```

**Step 4: Add subtle emphasis to Cmd+K hint**

In `src/components/layout/unified-search.tsx`, desktop search (around line 332):

```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
  <Command className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground opacity-50" /> {/* Add opacity-50 */}
  <Input ... />
</div>
```

**Step 5: Test visual changes**

```bash
npm run dev
```

1. Desktop: Search bar should be slightly taller (44px vs 40px)
2. Mobile: Search icon should be more prominent (24px vs 20px)
3. Both: Text should be clear and inviting

**Step 6: Commit**

```bash
git add src/components/layout/unified-search.tsx
git commit -m "feat: enhance visual prominence of UnifiedSearch

- Increase search bar height on desktop (44px)
- Larger search icon on mobile (24px)
- Clearer placeholder text
- More subtle Cmd+K hint

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Dashboard Redesign

### Task 3.1: Create ConditionalSection Component

**Files:**
- Create: `src/components/dashboard/conditional-section.tsx`
- Create: `tests/components/dashboard/conditional-section.test.tsx`

**Step 1: Write the failing test**

Create `tests/components/dashboard/conditional-section.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionalSection } from '@/components/dashboard/conditional-section';

describe('ConditionalSection', () => {
  it('should render children when show is true', () => {
    render(
      <ConditionalSection show={true}>
        <div>Content</div>
      </ConditionalSection>
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should not render anything when show is false', () => {
    const { container } = render(
      <ConditionalSection show={false}>
        <div>Content</div>
      </ConditionalSection>
    );

    expect(container.firstChild).toBeNull();
  });

  it('should apply custom className when provided', () => {
    render(
      <ConditionalSection show={true} className="custom-class">
        <div>Content</div>
      </ConditionalSection>
    );

    const wrapper = screen.getByText('Content').parentElement;
    expect(wrapper).toHaveClass('custom-class');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- tests/components/dashboard/conditional-section.test.tsx
```

Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `src/components/dashboard/conditional-section.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface ConditionalSectionProps {
  show: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * ConditionalSection - Wrapper that hides sections with zero items
 *
 * Use this to keep the dashboard clean by hiding empty sections.
 * When show=false, returns null (no DOM node).
 *
 * @example
 * <ConditionalSection show={tasks.length > 0}>
 *   <TasksList tasks={tasks} />
 * </ConditionalSection>
 */
export function ConditionalSection({
  show,
  children,
  className,
}: ConditionalSectionProps) {
  if (!show) return null;

  return (
    <div className={cn("space-y-3", className)}>
      {children}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- tests/components/dashboard/conditional-section.test.tsx
```

Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add src/components/dashboard/conditional-section.tsx tests/components/dashboard/conditional-section.test.tsx
git commit -m "feat: add ConditionalSection component

Wrapper component that hides sections when empty.
Keeps dashboard clean by removing zero-state sections.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Create HeroSection Component

**Files:**
- Create: `src/components/dashboard/hero-section.tsx`
- Create: `tests/components/dashboard/hero-section.test.tsx`

**Step 1: Write component implementation**

Create `src/components/dashboard/hero-section.tsx`:

```tsx
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import type { Note, Project } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface HeroSectionProps {
  greeting: string;
  date: string;
  activeProjects: Array<Project & { noteCount?: number; taskCount?: number }>;
  recentNotes: Array<Note & { project_name?: string }>;
}

/**
 * HeroSection - Dashboard hero with greeting, active projects, and recent notes
 *
 * Displays the most important, time-sensitive information at the top of the dashboard.
 *
 * RESPONSIVE: Projects stack vertically on mobile, 3 columns on desktop
 * MOBILE: Shows only 3 recent notes instead of 5
 */
export function HeroSection({
  greeting,
  date,
  activeProjects,
  recentNotes,
}: HeroSectionProps) {
  const router = useRouter();

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">{greeting}</h1>
        <p className="text-sm md:text-base text-muted-foreground mt-1">{date}</p>
      </div>

      {/* Active Projects - Horizontal cards */}
      {activeProjects.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Active Projects</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {activeProjects.slice(0, 3).map((project) => (
              <Card
                key={project.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(`/projects/${project.slug}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: project.color || '#888' }}
                    />
                    <h3 className="font-semibold truncate">{project.name}</h3>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{project.noteCount || 0} notes</span>
                    <span>{project.taskCount || 0} tasks</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recent Notes - Vertical list */}
      {recentNotes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Recent Notes</h2>
          <div className="space-y-2">
            {recentNotes.slice(0, 5).map((note, index) => (
              // Hide last 2 on mobile (show only 3)
              <Link
                key={note.id}
                href={`/notes/${note.slug}`}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors",
                  index >= 3 && "hidden md:flex"
                )}
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{note.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {note.project_name && (
                      <span className="mr-2">📁 {note.project_name}</span>
                    )}
                    {formatDistanceToNow(new Date(note.updated_at))} ago
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Write basic test**

Create `tests/components/dashboard/hero-section.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroSection } from '@/components/dashboard/hero-section';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('HeroSection', () => {
  const mockProjects = [
    {
      id: '1',
      slug: 'project-1',
      name: 'Project 1',
      color: '#FF0000',
      noteCount: 5,
      taskCount: 3,
      user_id: 'user1',
      description: '',
      status: 'active' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const mockNotes = [
    {
      id: '1',
      slug: 'note-1',
      title: 'Note 1',
      content: '',
      project_name: 'Project 1',
      updated_at: new Date().toISOString(),
      user_id: 'user1',
      project_id: null,
      is_archived: false,
      created_at: new Date().toISOString(),
    },
  ];

  it('should render greeting and date', () => {
    render(
      <HeroSection
        greeting="Good morning"
        date="Monday, January 1"
        activeProjects={[]}
        recentNotes={[]}
      />
    );

    expect(screen.getByText('Good morning')).toBeInTheDocument();
    expect(screen.getByText('Monday, January 1')).toBeInTheDocument();
  });

  it('should render active projects', () => {
    render(
      <HeroSection
        greeting="Good morning"
        date="Monday, January 1"
        activeProjects={mockProjects}
        recentNotes={[]}
      />
    );

    expect(screen.getByText('Project 1')).toBeInTheDocument();
    expect(screen.getByText('5 notes')).toBeInTheDocument();
    expect(screen.getByText('3 tasks')).toBeInTheDocument();
  });

  it('should render recent notes', () => {
    render(
      <HeroSection
        greeting="Good morning"
        date="Monday, January 1"
        activeProjects={[]}
        recentNotes={mockNotes}
      />
    );

    expect(screen.getByText('Note 1')).toBeInTheDocument();
  });
});
```

**Step 3: Run test**

```bash
npm test -- tests/components/dashboard/hero-section.test.tsx
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/components/dashboard/hero-section.tsx tests/components/dashboard/hero-section.test.tsx
git commit -m "feat: add HeroSection component

Displays greeting, active projects (cards), and recent notes (list)
at the top of the dashboard for maximum visibility.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3.3: Restructure Dashboard Layout

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Step 1: Import new components**

At the top of `src/app/(dashboard)/page.tsx`, add imports:

```tsx
import { HeroSection } from "@/components/dashboard/hero-section";
import { ConditionalSection } from "@/components/dashboard/conditional-section";
import { format } from "date-fns"; // Should already be imported
```

**Step 2: Remove old imports**

Remove these imports (if present):
- `ActionBar` (already removed)
- `InsightsCard` (will remove later)
- `CapturesCard` (will remove later)

**Step 3: Update DashboardContent component**

Replace the entire return statement (lines 194-467) with the new structure:

```tsx
return (
  <>
    <div className="space-y-4 p-3 lg:space-y-6 lg:p-6">
      {/* Database Error Banner */}
      {data.error && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 lg:px-4 lg:py-3 text-amber-600 dark:text-amber-400 text-sm">
          {data.error}
        </div>
      )}

      {/* HERO SECTION - Most prominent */}
      <HeroSection
        greeting={greeting}
        date={format(new Date(), "EEEE, MMMM d")}
        activeProjects={data.activeProjects}
        recentNotes={data.recentNotesWithProjects}
      />

      {/* STATS OVERVIEW - At-a-glance metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.totalTasks}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.stats.completedToday} done today
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.totalNotes}</div>
            <p className="text-xs text-muted-foreground mt-1">total notes</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.activeProjects}</div>
            <p className="text-xs text-muted-foreground mt-1">active</p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Captures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.stats.weeklyCaptures}</div>
            <p className="text-xs text-muted-foreground mt-1">this week</p>
          </CardContent>
        </Card>

        {/* Hide Productivity on mobile */}
        <Card className="hover:shadow-md transition-shadow hidden md:block">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Productivity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.stats.totalTasks > 0
                ? Math.round((data.stats.completedToday / Math.max(data.stats.totalTasks, 1)) * 100)
                : 0}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">today</p>
          </CardContent>
        </Card>
      </div>

      {/* WHAT'S NEXT - Conditional (hidden if no tasks) */}
      <ConditionalSection show={data.todayTasks.length > 0 || data.scheduledTasks.length > 0}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            What's Next
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <TodayTasksSection tasks={data.todayTasks} />
          <ScheduledTasksSection tasks={data.scheduledTasks} />
        </div>
      </ConditionalSection>

      {/* AI INSIGHTS - Conditional (will be updated in next phase) */}
      <ConditionalSection show={true}>
        <CollapsibleSection
          title="AI Insights & Patterns"
          icon={<TrendingUp className="h-4 w-4" />}
          defaultCollapsed={false}
          storageKey="ai-insights"
        >
          <div className="space-y-6">
            <InsightsFeed userId={user.id} />
            <WeeklySummary userId={user.id} />
          </div>
        </CollapsibleSection>
      </ConditionalSection>
    </div>
  </>
);
```

**Step 4: Verify app compiles**

```bash
npm run typecheck
```

Expected: No errors

**Step 5: Test in browser**

```bash
npm run dev
```

Check:
1. Hero section appears at top with greeting, projects, and notes
2. Stats cards display correctly
3. "What's Next" appears if you have tasks
4. Layout is responsive on mobile

**Step 6: Commit**

```bash
git add src/app/\(dashboard\)/page.tsx
git commit -m "refactor: restructure dashboard with new layout

Implement hero section with active projects + recent notes,
conditional sections for tasks and insights, cleaner hierarchy.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Editor Scroll Fix

### Task 4.1: Create CenteredCursor TipTap Extension

**Files:**
- Create: `src/components/editor/extensions/centered-cursor.ts`
- Create: `tests/components/editor/centered-cursor.test.ts`

**Step 1: Write the extension**

Create `src/components/editor/extensions/centered-cursor.ts`:

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * CenteredCursor Extension
 *
 * Keeps the active cursor line centered in the viewport while typing.
 * Similar to VS Code's "centered cursor" mode.
 *
 * PERFORMANCE: Uses requestAnimationFrame and debouncing
 * MOBILE: Falls back to scrollIntoView for better compatibility
 */
export const CenteredCursor = Extension.create({
  name: 'centeredCursor',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('centeredCursor'),

        view() {
          let rafId: number | null = null;
          let lastCursorPos: number | null = null;

          // Detect mobile
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

          return {
            update: (view) => {
              const { from } = view.state.selection;

              // Skip if cursor hasn't moved
              if (from === lastCursorPos) return;
              lastCursorPos = from;

              // Cancel pending scroll
              if (rafId) {
                cancelAnimationFrame(rafId);
              }

              // Schedule scroll update
              rafId = requestAnimationFrame(() => {
                try {
                  const pos = view.coordsAtPos(from);
                  if (!pos) return;

                  // Get editor container
                  const editorEl = view.dom;
                  const container = editorEl.closest('.prose') as HTMLElement;
                  if (!container) return;

                  // Mobile: Use scrollIntoView
                  if (isMobile) {
                    const cursorElement = view.domAtPos(from).node;
                    if (cursorElement instanceof HTMLElement) {
                      cursorElement.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      });
                    }
                    return;
                  }

                  // Desktop: Custom centering logic
                  const containerRect = container.getBoundingClientRect();
                  const viewportCenter = containerRect.height / 2;

                  // Calculate cursor position relative to container
                  const cursorTop = pos.top - containerRect.top;

                  // Get current scroll position
                  const currentScroll = container.scrollTop;
                  const targetScroll = currentScroll + cursorTop - viewportCenter;

                  // Don't scroll if difference is small (< 50px)
                  if (Math.abs(targetScroll - currentScroll) < 50) return;

                  // Smooth scroll to center (don't scroll above top)
                  container.scrollTo({
                    top: Math.max(0, targetScroll),
                    behavior: 'smooth',
                  });
                } catch (error) {
                  // Silently fail - cursor tracking is non-critical
                  console.debug('CenteredCursor scroll error:', error);
                }
              });
            },

            destroy: () => {
              if (rafId) {
                cancelAnimationFrame(rafId);
              }
            },
          };
        },
      }),
    ];
  },
});
```

**Step 2: Write basic test**

Create `tests/components/editor/centered-cursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CenteredCursor } from '@/components/editor/extensions/centered-cursor';

describe('CenteredCursor', () => {
  it('should create extension with correct name', () => {
    expect(CenteredCursor.name).toBe('centeredCursor');
  });

  it('should add ProseMirror plugins', () => {
    const plugins = CenteredCursor.config.addProseMirrorPlugins?.();
    expect(plugins).toBeDefined();
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins?.length).toBeGreaterThan(0);
  });
});
```

**Step 3: Run test**

```bash
npm test -- tests/components/editor/centered-cursor.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/components/editor/extensions/centered-cursor.ts tests/components/editor/centered-cursor.test.ts
git commit -m "feat: add CenteredCursor TipTap extension

Keeps cursor centered in viewport while typing, similar to
VS Code's centered cursor mode. Uses RAF for performance,
falls back to scrollIntoView on mobile.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 4.2: Integrate CenteredCursor into MarkdownEditor

**Files:**
- Modify: `src/components/editor/markdown-editor.tsx:9,106-122`

**Step 1: Import CenteredCursor extension**

In `src/components/editor/markdown-editor.tsx`, add import (around line 35):

```tsx
import { Figure } from './extensions/figure';
import { CenteredCursor } from './extensions/centered-cursor'; // Add this
import { ImageFloatingMenu } from './image-floating-menu';
```

**Step 2: Add to extensions array**

In the `useEditor` hook (around line 106-122), add CenteredCursor:

```tsx
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: { keepMarks: true },
      orderedList: { keepMarks: true },
    }),
    Placeholder.configure({ placeholder }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "text-primary underline" },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    MarkdownPaste,
    Figure,
    CenteredCursor, // Add this
  ],
  content: initialContent,
  autofocus: autoFocus,
  // ... rest of config
});
```

**Step 3: Test editor scroll behavior**

```bash
npm run dev
```

1. Navigate to a note (e.g., create new note at /notes/new)
2. Type a very long document (paste Lorem Ipsum multiple times until it scrolls)
3. Scroll to the middle of the document
4. Click at the end and start typing
5. Verify: The cursor stays centered as you type (text doesn't disappear)

**Step 4: Test on mobile (optional)**

Use browser dev tools to emulate mobile:
1. Open dev tools (F12)
2. Toggle device toolbar (Cmd+Shift+M)
3. Select iPhone or Android device
4. Test typing at bottom of long document
5. Verify: Cursor remains visible (uses scrollIntoView)

**Step 5: Commit**

```bash
git add src/components/editor/markdown-editor.tsx
git commit -m "feat: integrate CenteredCursor into MarkdownEditor

Editor now keeps cursor centered while typing in long documents.
Fixes issue where text would disappear when typing at the bottom.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: AI Insights Consolidation

### Task 5.1: Create UnifiedInsightsFeed Component

**Files:**
- Create: `src/components/dashboard/unified-insights-feed.tsx`
- Copy logic from: `src/components/dashboard/insights-feed.tsx` and `src/components/dashboard/insights-card.tsx`

**Step 1: Create UnifiedInsightsFeed component**

Create `src/components/dashboard/unified-insights-feed.tsx`:

```tsx
"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, X, FileText, Link as LinkIcon, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Insight } from "@/lib/db/schema";

interface UnifiedInsightsFeedProps {
  userId: string;
  limit?: number;
  showActions?: boolean;
  showRefresh?: boolean;
}

/**
 * UnifiedInsightsFeed - Consolidated AI insights component
 *
 * Combines functionality from InsightsCard and InsightsFeed into
 * a single unified component. Shows insights with action buttons.
 *
 * RESPONSIVE: Adjusts sizing on mobile
 */
export function UnifiedInsightsFeed({
  userId,
  limit = 5,
  showActions = true,
  showRefresh = true,
}: UnifiedInsightsFeedProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch insights
  const { data: response, isLoading } = useQuery({
    queryKey: ["insights", "unified", userId, limit],
    queryFn: async () => {
      const res = await fetch(`/api/insights?limit=${limit}&status=new`);
      if (!res.ok) throw new Error("Failed to fetch insights");
      return res.json() as Promise<{ insights: Insight[] }>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const insights = response?.insights || [];

  // Generate insights mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeCaptures: true,
          daysBack: 7,
          skipCache: true,
        }),
      });
      if (!response.ok) throw new Error("Failed to generate insights");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Insights refreshed!");
    },
    onError: () => {
      toast.error("Failed to generate insights");
    },
  });

  // Action handler (create note or connection)
  const actionMutation = useMutation({
    mutationFn: async ({ insightId, action }: { insightId: string; action: 'note' | 'connection' }) => {
      const insight = insights.find((i) => i.id === insightId);
      if (!insight) throw new Error("Insight not found");

      if (action === 'note') {
        // Create note from insight
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: insight.title,
            content: insight.content,
          }),
        });

        if (!response.ok) throw new Error("Failed to create note");
        const data = await response.json();

        // Mark insight as actioned
        await fetch("/api/insights", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: insightId, action: "action" }),
        });

        return data.note.slug;
      }

      // For connections, just mark as actioned
      await fetch("/api/insights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: insightId, action: "action" }),
      });

      return null;
    },
    onSuccess: (slug) => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      if (slug) {
        router.push(`/notes/${slug}`);
      } else {
        toast.success("Insight actioned!");
      }
    },
    onError: () => {
      toast.error("Failed to action insight");
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async (insightId: string) => {
      const response = await fetch("/api/insights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: insightId, action: "dismiss" }),
      });
      if (!response.ok) throw new Error("Failed to dismiss insight");
    },
    onMutate: async (insightId) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["insights", "unified"] });

      const previousInsights = queryClient.getQueryData(["insights", "unified", userId, limit]);

      queryClient.setQueryData(["insights", "unified", userId, limit], (old: any) => ({
        insights: old?.insights?.filter((i: Insight) => i.id !== insightId) || [],
      }));

      return { previousInsights };
    },
    onError: (err, insightId, context) => {
      // Rollback on error
      if (context?.previousInsights) {
        queryClient.setQueryData(["insights", "unified", userId, limit], context.previousInsights);
      }
      toast.error("Failed to dismiss insight");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    },
  });

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-2 lg:space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 lg:h-32 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  // Empty state (handled by ConditionalSection)
  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {insights.map((insight) => (
        <Card key={insight.id} className="relative">
          <CardContent className="p-3 lg:p-4">
            {/* Dismiss button */}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 lg:top-2 lg:right-2 h-6 w-6"
              onClick={() => dismissMutation.mutate(insight.id)}
            >
              <X className="h-3 w-3 lg:h-4 lg:w-4" />
            </Button>

            {/* Insight content */}
            <div className="flex items-start gap-2 lg:gap-3 mb-2 pr-6">
              <Lightbulb className="h-4 w-4 lg:h-5 lg:w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Badge variant="outline" className="mb-1 lg:mb-2 text-xs">
                  {insight.insight_type}
                </Badge>
                <h3 className="font-medium text-sm lg:text-base mb-1 line-clamp-2">
                  {insight.title}
                </h3>
                <p className="text-xs lg:text-sm text-muted-foreground line-clamp-2">
                  {insight.content}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            {showActions && (
              <div className="flex gap-2 mt-2 lg:mt-3 flex-wrap">
                {insight.insight_type === "connection" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => actionMutation.mutate({ insightId: insight.id, action: 'connection' })}
                    className="h-7 lg:h-8 text-xs"
                  >
                    <LinkIcon className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Create Connection</span>
                    <span className="sm:hidden">Connect</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => actionMutation.mutate({ insightId: insight.id, action: 'note' })}
                  className="h-7 lg:h-8 text-xs"
                >
                  <FileText className="h-3 w-3 mr-1" />
                  <span className="hidden sm:inline">Convert to Note</span>
                  <span className="sm:hidden">Note</span>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Refresh button */}
      {showRefresh && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="w-full"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
          Refresh Insights
        </Button>
      )}
    </div>
  );
}
```

**Step 2: Verify compiles**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Commit**

```bash
git add src/components/dashboard/unified-insights-feed.tsx
git commit -m "feat: create UnifiedInsightsFeed component

Consolidates InsightsCard and InsightsFeed into single component.
Handles fetching, actions (create note/connection), dismiss,
and refresh with optimistic updates.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5.2: Update Dashboard to Use UnifiedInsightsFeed

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`
- Delete: `src/components/dashboard/insights-card.tsx`
- Delete: `src/components/dashboard/captures-card.tsx`

**Step 1: Update dashboard imports**

In `src/app/(dashboard)/page.tsx`:

```tsx
// REMOVE:
import { InsightsFeed } from "@/components/dashboard/insights-feed";
import { WeeklySummary } from "@/components/dashboard/weekly-summary";

// ADD:
import { UnifiedInsightsFeed } from "@/components/dashboard/unified-insights-feed";
```

**Step 2: Update AI Insights section**

Replace the AI Insights ConditionalSection (near the end of DashboardContent):

```tsx
{/* AI INSIGHTS - Conditional (hidden if no insights) */}
<ConditionalSection show={true}> {/* TODO: Make conditional based on insights count */}
  <div className="space-y-3">
    <h2 className="text-lg font-semibold flex items-center gap-2">
      <Lightbulb className="h-5 w-5 text-primary" />
      AI Insights
    </h2>
    <UnifiedInsightsFeed userId={user.id} limit={5} />
  </div>
</ConditionalSection>
```

**Step 3: Remove old components**

```bash
rm src/components/dashboard/insights-card.tsx
rm src/components/dashboard/captures-card.tsx
```

**Step 4: Remove CollapsibleSection and WeeklySummary (if not used elsewhere)**

Check usage:

```bash
grep -r "WeeklySummary\|CollapsibleSection" src/ --include="*.tsx" --include="*.ts"
```

If only used in dashboard, consider removing them too. For now, leave them.

**Step 5: Test in browser**

```bash
npm run dev
```

1. Dashboard should show unified AI insights
2. Click "Convert to Note" - should create note and redirect
3. Click X to dismiss - should remove optimistically
4. Click "Refresh Insights" - should refetch

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: replace insights components with UnifiedInsightsFeed

Remove InsightsCard and CapturesCard, use UnifiedInsightsFeed
for all AI insights. Simpler, more consistent.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Mobile Optimization

### Task 6.1: Optimize Touch Targets for Mobile

**Files:**
- Modify: `src/components/layout/unified-search.tsx:252-253`
- Verify: `src/components/dashboard/unified-insights-feed.tsx` (already mobile-optimized)

**Step 1: Increase mobile overlay button height**

In `src/components/layout/unified-search.tsx`, find mobile command buttons (around line 252):

```tsx
// OLD:
<button
  key={cmd.id}
  onClick={() => {
    cmd.handler?.();
    setIsMobileOverlayOpen(false);
    setQuery("");
  }}
  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent"
>

// NEW:
<button
  key={cmd.id}
  onClick={() => {
    cmd.handler?.();
    setIsMobileOverlayOpen(false);
    setQuery("");
  }}
  className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] hover:bg-accent active:bg-accent" // Increase py-3 to py-4, add min-h-[56px]
>
```

**Step 2: Increase mobile search result button height**

Find mobile search results (around line 274-291):

```tsx
// OLD:
<button
  key={result.id}
  onClick={() => {
    handleSelect({ type: 'result', item: result, index: 0 });
    setIsMobileOverlayOpen(false);
  }}
  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-accent"
>

// NEW:
<button
  key={result.id}
  onClick={() => {
    handleSelect({ type: 'result', item: result, index: 0 });
    setIsMobileOverlayOpen(false);
  }}
  className="w-full flex items-start gap-3 px-4 py-4 min-h-[56px] hover:bg-accent active:bg-accent" // Increase py-3 to py-4, add min-h-[56px]
>
```

**Step 3: Test on mobile**

```bash
npm run dev
```

Use browser dev tools:
1. Toggle device toolbar (Cmd+Shift+M)
2. Select iPhone 14 Pro
3. Open UnifiedSearch
4. Tap Quick Actions - should be easy to tap (56px height)
5. Type and tap results - should be easy to tap

**Step 4: Commit**

```bash
git add src/components/layout/unified-search.tsx
git commit -m "feat: optimize touch targets for mobile UnifiedSearch

Increase button height to 56px (iOS guideline) for easier
tapping on mobile. Add active states for better feedback.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 6.2: Adjust Mobile Spacing and Typography

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`
- Modify: `src/components/dashboard/hero-section.tsx`

**Step 1: Add responsive spacing to dashboard**

In `src/app/(dashboard)/page.tsx`, update the outer container:

```tsx
// FIND:
<div className="space-y-4 p-3 lg:space-y-6 lg:p-6">

// Should already be correct, but verify spacing is responsive
```

**Step 2: Verify HeroSection mobile spacing**

In `src/components/dashboard/hero-section.tsx`, verify responsive spacing (should already be done):

```tsx
<div className="space-y-4 md:space-y-6">
  {/* Content */}
</div>
```

**Step 3: Hide 5th stat card on mobile**

Already done in Task 3.3. Verify in `src/app/(dashboard)/page.tsx`:

```tsx
<Card className="hover:shadow-md transition-shadow hidden md:block">
  {/* Productivity card */}
</Card>
```

**Step 4: Test responsive spacing**

```bash
npm run dev
```

Check different viewport sizes:
- Mobile (375px): Tighter spacing, 2-column stats
- Tablet (768px): Medium spacing
- Desktop (1024px+): Full spacing, 5-column stats

**Step 5: Commit**

```bash
git add src/app/\(dashboard\)/page.tsx src/components/dashboard/hero-section.tsx
git commit -m "feat: optimize mobile spacing and typography

Responsive spacing (space-y-4 on mobile, space-y-6 on desktop),
hide 5th stat card on mobile for cleaner 2-column layout.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 7: Testing & Polish

### Task 7.1: Add Tests for New Components

**Files:**
- Create: `tests/integration/dashboard-layout.test.tsx`
- Create: `tests/integration/unified-search-commands.test.tsx`

**Step 1: Write dashboard layout integration test**

Create `tests/integration/dashboard-layout.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DashboardPage from '@/app/(dashboard)/page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({
    id: 'user1',
    email: 'test@example.com',
  }),
}));

// Mock database
vi.mock('@/lib/db/client', () => ({
  query: async () => [],
}));

describe('Dashboard Layout', () => {
  it('should render hero section with greeting', async () => {
    render(await DashboardPage());

    await waitFor(() => {
      expect(screen.getByText(/Good morning|Good afternoon|Good evening/)).toBeInTheDocument();
    });
  });

  it('should conditionally render sections based on data', async () => {
    render(await DashboardPage());

    // Since we mocked empty data, sections with zero items should not render
    // This tests our ConditionalSection logic
    await waitFor(() => {
      // Stats should always render
      expect(screen.getByText('Tasks')).toBeInTheDocument();
    });
  });
});
```

**Step 2: Write UnifiedSearch commands test**

Create `tests/integration/unified-search-commands.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnifiedSearch } from '@/components/layout/unified-search';

// Mock dependencies
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/',
}));

vi.mock('@/lib/hooks/use-command-palette', () => ({
  useCommandPalette: () => ({
    commands: [
      {
        id: 'quick-capture',
        label: 'Quick Capture',
        description: 'Capture a thought',
        icon: () => null,
        category: 'creation',
        handler: vi.fn(),
      },
    ],
    searchCommands: vi.fn(() => []),
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useMobile: () => false,
}));

describe('UnifiedSearch Commands', () => {
  it('should show creation commands when search is empty', () => {
    render(<UnifiedSearch variant="desktop" />);

    const input = screen.getByPlaceholderText(/Search or run a command/);
    fireEvent.focus(input);

    expect(screen.getByText('Quick Capture')).toBeInTheDocument();
  });

  it('should handle command execution', () => {
    render(<UnifiedSearch variant="desktop" />);

    const input = screen.getByPlaceholderText(/Search or run a command/);
    fireEvent.focus(input);

    const captureButton = screen.getByText('Quick Capture');
    fireEvent.click(captureButton);

    // Handler should have been called (mocked)
    // In real test, we'd verify navigation or dialog opening
  });
});
```

**Step 3: Run tests**

```bash
npm test -- tests/integration/
```

Expected: Tests may need adjustment based on actual implementation

**Step 4: Fix any failing tests**

Adjust mocks and assertions as needed.

**Step 5: Commit**

```bash
git add tests/integration/
git commit -m "test: add integration tests for dashboard and UnifiedSearch

Test dashboard layout, conditional rendering, and UnifiedSearch
command execution.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7.2: Manual Testing Checklist

**Step 1: Create testing checklist document**

Create `docs/testing/ux-improvements-checklist.md`:

```markdown
# UX Improvements Testing Checklist

## Desktop Testing

### UnifiedSearch
- [ ] Click search bar to open dropdown
- [ ] Press Cmd+K to open/close search
- [ ] Press Cmd+Shift+C for Quick Capture
- [ ] Press Cmd+Shift+D for Daily Note
- [ ] Type query - see commands and results
- [ ] Arrow keys navigate results
- [ ] Enter selects result
- [ ] Escape closes dropdown

### Dashboard Layout
- [ ] Hero section appears first with greeting
- [ ] Active projects show (if any)
- [ ] Recent notes show (if any)
- [ ] Stats cards display correctly
- [ ] "What's Next" hidden if no tasks
- [ ] AI Insights section works
- [ ] No ActionBar visible
- [ ] No quick action buttons visible

### Editor
- [ ] Type in long document (200+ lines)
- [ ] Cursor stays centered while typing
- [ ] No text disappearing at bottom
- [ ] Smooth scroll behavior

### AI Insights
- [ ] Insights display correctly
- [ ] Click "Convert to Note" creates note
- [ ] Click X dismisses insight (optimistic)
- [ ] Refresh button regenerates insights

## Mobile Testing (iPhone)

### UnifiedSearch
- [ ] Search icon visible in header (24px)
- [ ] Tap opens full-screen overlay
- [ ] Quick Actions appear immediately
- [ ] Touch targets easy to tap (56px)
- [ ] Swipe down closes overlay
- [ ] Virtual keyboard doesn't obscure content

### Dashboard Layout
- [ ] Hero section stacks vertically
- [ ] Projects in single column
- [ ] Recent notes show only 3
- [ ] Stats in 2 columns (hide 5th)
- [ ] Tight spacing (space-y-4)
- [ ] BottomNav doesn't overlap content

### Editor
- [ ] Toolbar horizontally scrollable
- [ ] Type at bottom of long document
- [ ] Cursor stays visible (scrollIntoView)
- [ ] Virtual keyboard handled correctly

## Responsive Testing

### Breakpoints
- [ ] Mobile (< 640px): Single column, tight spacing
- [ ] Tablet (640-1024px): Two columns where applicable
- [ ] Desktop (1024px+): Full layout with sidebar

### Dark Mode
- [ ] All components render correctly in dark mode
- [ ] Contrast is sufficient
- [ ] Icons and text legible

## Performance

### Load Times
- [ ] Dashboard loads < 1s to interactive
- [ ] No layout shift on load
- [ ] Images/icons load progressively

### Smooth Animations
- [ ] UnifiedSearch dropdown smooth
- [ ] Editor scroll smooth (not janky)
- [ ] Hover states responsive

## Accessibility

### Keyboard Navigation
- [ ] Tab through all interactive elements
- [ ] Focus indicators visible
- [ ] Keyboard shortcuts work

### Screen Readers
- [ ] ARIA labels present
- [ ] Headings structured correctly
- [ ] Button text descriptive

## Edge Cases

### Empty States
- [ ] No tasks: "What's Next" hidden
- [ ] No insights: AI section hidden
- [ ] No projects: Hero shows message
- [ ] No notes: Hero shows message

### Error Handling
- [ ] API errors show toast
- [ ] Failed mutations rollback optimistically
- [ ] Network issues handled gracefully

## Regression Testing

### Existing Features
- [ ] Note creation still works
- [ ] Task management unchanged
- [ ] Project management unchanged
- [ ] Search functionality intact
- [ ] Voice commands still work
- [ ] Offline mode unaffected
```

**Step 2: Perform manual testing**

Go through the checklist systematically, checking off items as you test.

**Step 3: Fix any issues found**

Create new tasks/commits for any bugs discovered.

**Step 4: Commit checklist**

```bash
git add docs/testing/ux-improvements-checklist.md
git commit -m "docs: add UX improvements testing checklist

Comprehensive checklist for manual testing across desktop,
mobile, responsive breakpoints, and edge cases.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7.3: Update Documentation

**Files:**
- Modify: `README.md` (if it documents UI)
- Modify: `CLAUDE.md:19-35` (update commands section)

**Step 1: Update CLAUDE.md with new commands**

In `CLAUDE.md`, update or add a "Key Features" section:

```markdown
## Key Features

### Command-First Interface
- **UnifiedSearch** (Cmd+K): Primary interaction point for all actions
  - Search notes, tasks, projects, captures
  - Run commands (create, navigate, actions)
  - Keyboard shortcuts: Cmd+Shift+C (Capture), Cmd+Shift+D (Daily)
- Quick Actions: Shown by default when search is empty

### Dashboard
- Hero section with active projects and recent notes
- Conditional sections (hidden when empty)
- Unified AI insights feed
- Mobile-optimized layout

### Editor
- Centered cursor tracking (keeps cursor visible while typing)
- Markdown support with TipTap
- Sticky toolbar on mobile
```

**Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new UX features

Document command-first interface, UnifiedSearch shortcuts,
and dashboard improvements.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7.4: Final Verification and Cleanup

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run type checking**

```bash
npm run typecheck
```

Expected: No errors

**Step 3: Run linting**

```bash
npm run lint
```

Expected: No errors (or only minor warnings)

**Step 4: Check for unused files**

```bash
# Find components that might not be imported
find src/components -name "*.tsx" -type f | while read file; do
  filename=$(basename "$file" .tsx)
  count=$(grep -r "from.*${filename}" src/ --include="*.tsx" --include="*.ts" | wc -l)
  if [ "$count" -eq "0" ]; then
    echo "Potentially unused: $file"
  fi
done
```

Review and delete any truly unused files.

**Step 5: Build for production**

```bash
npm run build
```

Expected: Build succeeds with no errors

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification

- All tests passing
- Type checking clean
- Linting clean
- Production build successful

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

### What We Built

1. **Removed 5 redundant components**: ActionBar, Command Palette, SearchHeader, InsightsCard, CapturesCard
2. **Enhanced UnifiedSearch**: Added creation commands, keyboard shortcuts, visual prominence
3. **Redesigned Dashboard**: Hero section with active projects + recent notes, conditional rendering
4. **Fixed Editor**: Centered cursor tracking keeps text visible while typing
5. **Consolidated AI Insights**: Single UnifiedInsightsFeed replaces duplicate systems
6. **Optimized Mobile**: Touch targets, spacing, typography, safe areas

### Key Metrics

- **Components removed**: 5
- **LOC reduced**: ~500 (estimated)
- **Keyboard shortcuts added**: 3 (Cmd+K, Cmd+Shift+C, Cmd+Shift+D)
- **Conditional sections**: 2 (tasks, insights)
- **Tests added**: 10+ (unit + integration)

### Next Steps

1. Deploy to staging
2. Monitor analytics (UnifiedSearch usage, task completion times)
3. Gather user feedback
4. Iterate based on data

---

## Troubleshooting

### Editor scroll doesn't work
- Check browser console for errors
- Verify CenteredCursor extension is loaded
- Test on different browsers (Chrome, Safari, Firefox)

### UnifiedSearch commands not showing
- Check use-command-palette.ts exports commands
- Verify commands array includes creation commands
- Check category filter logic

### Dashboard layout broken on mobile
- Check responsive classes (md:, lg: prefixes)
- Verify ConditionalSection logic
- Test on real device (not just emulator)

### Tests failing
- Update mocks to match new component structure
- Check for missing dependencies
- Verify test setup in vitest.config.ts

---

**Implementation Status**: Ready to execute
**Estimated Time**: 2-3 days
**Risk Level**: Medium (UI changes, well-scoped)
