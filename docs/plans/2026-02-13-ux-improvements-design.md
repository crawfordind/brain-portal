# UX Improvements Design Document

**Date**: 2026-02-13
**Status**: Approved
**Approach**: Command-First Dashboard

## Executive Summary

This design consolidates the brain-portal UI around a single interaction paradigm: **UnifiedSearch as the primary action point**. By removing redundant navigation, cleaning up the dashboard, and fixing critical UX issues, we create a cleaner, faster, and more intuitive experience.

### Key Changes
- **Remove**: ActionBar, Command Palette, dashboard quick action buttons, duplicate insight components
- **Enhance**: UnifiedSearch with creation commands and keyboard shortcuts
- **Redesign**: Dashboard information hierarchy (hero section with active projects + recent notes)
- **Fix**: Editor scroll behavior with centered cursor tracking
- **Implement**: Conditional rendering for all zero-state sections

---

## 1. Architecture & Component Structure

### Components to Remove

| Component | Path | Reason |
|-----------|------|--------|
| ActionBar | `src/components/dashboard/action-bar.tsx` | Redundant with UnifiedSearch |
| Command Palette | `src/components/command-palette/` | Duplicate of UnifiedSearch |
| SearchHeader | `src/components/layout/search-header.tsx` | Replaced by UnifiedSearch |
| Dashboard quick actions | `src/app/(dashboard)/page.tsx:215-234` | Moving to UnifiedSearch |
| InsightsCard | `src/components/dashboard/insights-card.tsx` | Merging into unified feed |

### Components to Enhance

**UnifiedSearch** (`src/components/layout/unified-search.tsx`):
- Add creation commands (Quick Capture, Daily Note, New Note/Task/Project)
- Add keyboard shortcuts (Cmd+Shift+C, Cmd+Shift+D)
- Enhance visual prominence
- Add command categories

**Dashboard** (`src/app/(dashboard)/page.tsx`):
- Remove ActionBar usage
- Restructure layout sections
- Add conditional rendering
- Implement new hero section

**InsightsFeed** (`src/components/dashboard/insights-feed.tsx`):
- Rename to `UnifiedInsightsFeed`
- Add action buttons from InsightsCard
- Handle both new and historical insights

### New Components to Create

**HeroSection** (`src/components/dashboard/hero-section.tsx`):
- Encapsulates greeting + active projects + recent notes
- Responsive grid layout
- Mobile-optimized

**ConditionalSection** (`src/components/dashboard/conditional-section.tsx`):
- Wrapper that hides sections with zero items
- Consistent empty state handling

**QuickCaptureDialog** (`src/components/dashboard/quick-capture-dialog.tsx`):
- Modal for quick capture
- Triggered from UnifiedSearch
- Voice input support (existing)

### Component Relationships

```
ResponsiveLayout
├── UnifiedSearch (enhanced - primary interaction point)
├── Dashboard
│   ├── HeroSection (new)
│   │   ├── Greeting
│   │   ├── ActiveProjects (horizontal cards)
│   │   └── RecentNotes (vertical list)
│   ├── StatsOverview (existing)
│   ├── ConditionalSection (new wrapper)
│   │   └── WhatsNext (tasks)
│   └── ConditionalSection (new wrapper)
│       └── UnifiedInsightsFeed
└── BottomNav (mobile)
```

---

## 2. UnifiedSearch Enhancement

### New Commands

```typescript
// Creation Commands (shown when search is empty)
const creationCommands = [
  {
    id: 'quick-capture',
    label: 'Quick Capture',
    description: 'Capture a thought, link, or idea',
    icon: Zap,
    category: 'creation',
    shortcut: 'Cmd+Shift+C',
    handler: () => openQuickCaptureDialog()
  },
  {
    id: 'daily-note',
    label: "Today's Daily Note",
    description: 'Create or open today\'s daily note',
    icon: Calendar,
    category: 'creation',
    shortcut: 'Cmd+Shift+D',
    handler: () => createOrOpenDailyNote()
  },
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
    handler: () => openProjectDialog()
  }
];
```

### UI Enhancements

**Desktop**:
- Increase search bar height: 40px → 44px
- Add subtle pulsing animation on Cmd+K hint
- Show "Quick Actions" by default when empty
- Display keyboard shortcuts next to commands

**Mobile**:
- Larger search icon: 20px → 24px
- Full-screen overlay with swipe-down to close
- Quick Actions appear immediately
- Touch-optimized targets (56px min height)

### Keyboard Shortcuts

```typescript
// Global shortcuts to register
{
  'Cmd+K / Ctrl+K': 'Open UnifiedSearch',
  'Cmd+Shift+C': 'Direct to Quick Capture',
  'Cmd+Shift+D': 'Direct to Daily Note',
  'Escape': 'Close UnifiedSearch'
}
```

### Search Priority

When user types a query, show results in order:
1. **Commands** (matching query)
2. **Recent items** (notes/tasks recently accessed)
3. **Search results** (from API)

### Visual States

**Before opening** (in header):
```
Desktop: [🔍 Search or run a command... ⌘K]
Mobile:  [🔍] icon button (24px)
```

**After opening** (dropdown/overlay):
```
┌─────────────────────────────────────┐
│ 🔍 Search or run a command...       │
├─────────────────────────────────────┤
│ QUICK ACTIONS                       │
│ ⚡ Quick Capture        ⌘⇧C         │
│ 📅 Today's Daily Note   ⌘⇧D         │
│ 📝 New Note                         │
│ ☑️  New Task                         │
│ 📁 New Project                      │
└─────────────────────────────────────┘
```

---

## 3. Dashboard Layout Redesign

### New Layout Structure

```tsx
<Dashboard>
  {/* 1. HERO SECTION - Most prominent */}
  <HeroSection>
    <Greeting /> {/* "Good morning" + date */}
    <ActiveProjectsPreview /> {/* 2-3 horizontal cards */}
    <RecentNotesPreview /> {/* 3-5 vertical list items */}
  </HeroSection>

  {/* 2. STATS OVERVIEW - At-a-glance metrics */}
  <StatsGrid>
    {/* 5 cards: Tasks, Notes, Projects, Captures, Productivity */}
  </StatsGrid>

  {/* 3. WHAT'S NEXT - Conditional (hidden if no tasks) */}
  <ConditionalSection show={hasTasks}>
    <SectionHeader title="What's Next" icon={Clock} />
    <TwoColumnGrid>
      <TodayTasks />
      <ScheduledTasks />
    </TwoColumnGrid>
  </ConditionalSection>

  {/* 4. AI INSIGHTS - Conditional (hidden if no insights) */}
  <ConditionalSection show={hasInsights}>
    <SectionHeader title="AI Insights" icon={Lightbulb} />
    <UnifiedInsightsFeed />
  </ConditionalSection>
</Dashboard>
```

### Hero Section Details

**Active Projects Preview**:
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
  {activeProjects.slice(0, 3).map(project => (
    <Card
      key={project.id}
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/projects/${project.slug}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: project.color }}
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
```

**Recent Notes Preview**:
```tsx
<div className="space-y-2 mb-6">
  <h3 className="text-sm font-medium text-muted-foreground">Recent Notes</h3>
  {recentNotes.slice(0, 5).map(note => (
    <Link key={note.id} href={`/notes/${note.slug}`}>
      <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{note.title}</p>
          <p className="text-xs text-muted-foreground">
            {note.project_name && (
              <span className="mr-2">📁 {note.project_name}</span>
            )}
            {formatDistanceToNow(note.updated_at)} ago
          </p>
        </div>
      </div>
    </Link>
  ))}
</div>
```

### Conditional Rendering Logic

**ConditionalSection Component**:
```tsx
interface ConditionalSectionProps {
  show: boolean;
  children: React.ReactNode;
  emptyMessage?: string;
}

export function ConditionalSection({
  show,
  children,
  emptyMessage
}: ConditionalSectionProps) {
  if (!show) return null;
  return <div className="space-y-3">{children}</div>;
}
```

**Usage Examples**:
```tsx
// Hide "What's Next" if no tasks
<ConditionalSection show={todayTasks.length > 0 || scheduledTasks.length > 0}>
  <WhatsNextSection />
</ConditionalSection>

// Hide "AI Insights" if no insights
<ConditionalSection show={insights.length > 0}>
  <UnifiedInsightsFeed />
</ConditionalSection>
```

### Visual Hierarchy

**Spacing**:
- Hero section: `space-y-6` (24px)
- Between sections: `space-y-6` (24px)
- Within cards: `space-y-3` (12px)
- Mobile: Reduce to `space-y-4` (16px)

**Typography**:
- Section headers: `text-lg font-semibold`
- Card titles: `font-semibold`
- Descriptions: `text-sm text-muted-foreground`

### Removed Elements

- ❌ ActionBar component
- ❌ Three "+" quick action buttons in dashboard
- ❌ "Quick Wins" section
- ❌ Separate "Your Work" section
- ❌ Collapsible "AI Insights & Patterns"
- ❌ InsightsCard component
- ❌ CapturesCard component (integrated into unified sections)

### Mobile Adaptations

- Hero: Projects stack vertically (single column)
- Stats: 2 columns instead of 5 (hide Productivity on mobile)
- Recent Notes: Show only 3 instead of 5
- Tighter spacing throughout
- Bottom padding increased for BottomNav clearance

---

## 4. Editor Scroll Behavior

### Problem Statement

When typing at the bottom of long documents:
- Text disappears behind UI or below viewport
- User must manually scroll
- Breaks writing flow

### Solution: Centered Cursor Tracking

Keep the active line centered in the viewport, similar to VS Code's centered cursor mode.

### Technical Implementation

**TipTap Extension**:
```tsx
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const CenteredCursor = Extension.create({
  name: 'centeredCursor',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('centeredCursor'),

        view() {
          let rafId: number | null = null;
          let lastCursorPos: number | null = null;

          return {
            update: (view) => {
              const { from } = view.state.selection;

              // Skip if cursor hasn't moved
              if (from === lastCursorPos) return;
              lastCursorPos = from;

              // Cancel pending scroll
              if (rafId) cancelAnimationFrame(rafId);

              // Schedule scroll update
              rafId = requestAnimationFrame(() => {
                const pos = view.coordsAtPos(from);
                if (!pos) return;

                // Get editor container
                const editorEl = view.dom;
                const container = editorEl.closest('.prose') as HTMLElement;
                if (!container) return;

                // Calculate viewport center
                const containerRect = container.getBoundingClientRect();
                const viewportCenter = containerRect.height / 2;

                // Calculate cursor position relative to container
                const cursorTop = pos.top - containerRect.top;

                // Only scroll if cursor is not already centered
                const currentScroll = container.scrollTop;
                const targetScroll = currentScroll + cursorTop - viewportCenter;

                // Don't scroll if difference is small (< 50px)
                if (Math.abs(targetScroll - currentScroll) < 50) return;

                // Smooth scroll to center
                container.scrollTo({
                  top: Math.max(0, targetScroll), // Don't scroll above top
                  behavior: 'smooth'
                });
              });
            },

            destroy: () => {
              if (rafId) cancelAnimationFrame(rafId);
            }
          };
        }
      })
    ];
  }
});
```

**Integration**:
```tsx
// In markdown-editor.tsx
const editor = useEditor({
  extensions: [
    StarterKit,
    Placeholder,
    Link,
    TaskList,
    TaskItem,
    MarkdownPaste,
    Figure,
    CenteredCursor, // Add centered cursor extension
  ],
  // ... rest of config
});
```

### Behavior Details

**When to trigger**:
- ✅ On cursor movement (arrow keys, mouse click)
- ✅ On text input (typing, paste)
- ❌ Not on external scroll events (user manually scrolling)

**Smoothing**:
- Use `requestAnimationFrame` for performance
- Debounce with threshold (don't scroll for small movements < 50px)
- Smooth scroll behavior on desktop
- Instant scroll on mobile (performance)

**Edge Cases**:
1. **Document shorter than viewport** - Don't center, keep at top
2. **Near document start** - Don't scroll above top (`Math.max(0, targetScroll)`)
3. **Near document end** - Browser handles this naturally
4. **Sticky toolbar** - Container scroll handles this automatically

### Mobile Considerations

```tsx
// Account for virtual keyboard
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

if (isMobile) {
  // Use scrollIntoView as fallback for better mobile support
  const cursorElement = view.dom.querySelector('.ProseMirror-selectednode');
  cursorElement?.scrollIntoView({
    block: 'center',
    behavior: 'smooth'
  });
} else {
  // Use custom centering logic for desktop
  container.scrollTo({ ... });
}
```

### Performance Optimizations

- Use `requestAnimationFrame` for scroll updates
- Skip calculations if cursor hasn't moved
- Cancel pending scrolls on new cursor movement
- Threshold check to prevent micro-scrolls
- Disable during rapid typing (optional future enhancement)

---

## 5. Data Flow & AI Insights Consolidation

### Current State

**Two separate systems**:
1. **InsightsCard** - Fetches `/api/insights?status=new`
2. **InsightsFeed** - Fetches `/api/insights?limit=5&status=new`

Both query the same table with similar filters. This is redundant.

### Unified Approach

**Single Component**: `UnifiedInsightsFeed`
- Combines functionality of both components
- Single API call, single data source
- Handles both "new" and "all" insights

### API Structure (No Changes)

**Endpoint**: `/api/insights`

**Query parameters**:
```typescript
GET /api/insights
  ?status=new         // Filter by status (new, actioned, dismissed)
  &limit=10           // Number of results (default: 10)
  &includeActions=true // Include action buttons (default: true)
```

**Response**:
```typescript
{
  insights: Insight[]
}
```

### Component Structure

**UnifiedInsightsFeed** (`src/components/dashboard/unified-insights-feed.tsx`):
```tsx
interface UnifiedInsightsFeedProps {
  userId: string;
  limit?: number;        // Default: 5
  showActions?: boolean; // Default: true
  showRefresh?: boolean; // Default: true
}

export function UnifiedInsightsFeed({
  userId,
  limit = 5,
  showActions = true,
  showRefresh = true
}: UnifiedInsightsFeedProps) {
  const queryClient = useQueryClient();

  // Single query for insights
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

  // Action handlers (merged from both components)
  const handleAction = async (insightId: string, action: 'note' | 'connection') => {
    const insight = insights.find(i => i.id === insightId);
    if (!insight) return;

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

      if (response.ok) {
        const data = await response.json();
        router.push(`/notes/${data.note.slug}`);
      }
    }

    // Mark as actioned
    await fetch("/api/insights", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: insightId, action: "action" }),
    });

    queryClient.invalidateQueries({ queryKey: ["insights"] });
  };

  const handleDismiss = async (insightId: string) => {
    await fetch("/api/insights", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: insightId, action: "dismiss" }),
    });

    queryClient.invalidateQueries({ queryKey: ["insights"] });
  };

  const handleRefresh = async () => {
    await fetch("/api/insights/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        includeCaptures: true,
        daysBack: 7,
        skipCache: true
      }),
    });

    queryClient.invalidateQueries({ queryKey: ["insights"] });
  };

  if (isLoading) {
    return <InsightsSkeleton count={limit} />;
  }

  if (insights.length === 0) {
    return null; // Handled by ConditionalSection
  }

  return (
    <div className="space-y-3">
      {insights.map(insight => (
        <InsightCard
          key={insight.id}
          insight={insight}
          showActions={showActions}
          onAction={handleAction}
          onDismiss={handleDismiss}
        />
      ))}

      {showRefresh && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="w-full"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Insights
        </Button>
      )}
    </div>
  );
}
```

### Migration Plan

**Files to delete**:
- `src/components/dashboard/insights-card.tsx`
- `src/components/dashboard/captures-card.tsx`

**Files to create**:
- `src/components/dashboard/unified-insights-feed.tsx` (enhanced version)
- `src/components/dashboard/hero-section.tsx`
- `src/components/dashboard/conditional-section.tsx`

**Files to modify**:
- `src/app/(dashboard)/page.tsx` - Use new components
- `src/components/dashboard/insights-feed.tsx` - Enhance or replace

### Data Consistency

**Caching strategy**:
```tsx
// React Query configuration
queryKey: ["insights", "unified", userId, limit]
staleTime: 5 * 60 * 1000 // 5 minutes - don't refetch unnecessarily
```

**Optimistic updates**:
```tsx
const dismissMutation = useMutation({
  mutationFn: async (insightId: string) => {
    // API call
  },
  onMutate: async (insightId) => {
    // Optimistically remove from UI
    await queryClient.cancelQueries({ queryKey: ["insights"] });

    const previousInsights = queryClient.getQueryData(["insights", "unified"]);

    queryClient.setQueryData(["insights", "unified"], (old: any) => ({
      insights: old.insights.filter((i: Insight) => i.id !== insightId)
    }));

    return { previousInsights };
  },
  onError: (err, insightId, context) => {
    // Rollback on error
    if (context?.previousInsights) {
      queryClient.setQueryData(["insights", "unified"], context.previousInsights);
    }
  },
  onSettled: () => {
    // Always refetch after mutation
    queryClient.invalidateQueries({ queryKey: ["insights"] });
  }
});
```

---

## 6. Mobile Considerations

### Mobile-First Principles

The app already has good mobile support. These changes enhance rather than break the mobile experience.

### UnifiedSearch on Mobile

**Full-screen overlay**:
```tsx
<div className="fixed inset-0 bg-background z-50 lg:hidden">
  {/* Swipe handle */}
  <div className="flex justify-center pt-2">
    <div className="w-12 h-1 bg-muted-foreground/20 rounded-full" />
  </div>

  {/* Search input - larger for mobile */}
  <div className="p-4">
    <Input
      placeholder="Search or create..."
      className="h-12 text-base" // 48px height, 16px text
      autoFocus
    />
  </div>

  {/* Quick Actions - touch-optimized */}
  <div className="space-y-1">
    {quickActions.map(action => (
      <button
        key={action.id}
        className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] hover:bg-accent"
      >
        <action.icon className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1 text-left">
          <div className="font-medium">{action.label}</div>
          <div className="text-xs text-muted-foreground">
            {action.description}
          </div>
        </div>
      </button>
    ))}
  </div>
</div>
```

**Touch targets**:
- Minimum 44px height (iOS guidelines)
- Prefer 56px for primary actions
- 16px horizontal padding
- Clear active/pressed states

### Dashboard Hero on Mobile

**Responsive breakpoints**:
```tsx
<HeroSection>
  {/* Greeting */}
  <div className="mb-4">
    <h1 className="text-2xl md:text-3xl font-bold">{greeting}</h1>
    <p className="text-sm text-muted-foreground">{date}</p>
  </div>

  {/* Active Projects - stack on mobile */}
  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
    {activeProjects.slice(0, 3).map(project => (
      <ProjectCard key={project.id} />
    ))}
  </div>

  {/* Recent Notes - show fewer on mobile */}
  <div className="space-y-2">
    {recentNotes.slice(0, isMobile ? 3 : 5).map(note => (
      <NoteItem key={note.id} />
    ))}
  </div>
</HeroSection>
```

### Stats Grid on Mobile

**2-column layout**:
```tsx
<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
  <StatCard title="Tasks" value={stats.totalTasks} />
  <StatCard title="Notes" value={stats.totalNotes} />
  <StatCard title="Projects" value={stats.activeProjects} />
  <StatCard title="Captures" value={stats.weeklyCaptures} />
  {/* Hide Productivity on mobile to keep 2-column grid clean */}
  <StatCard
    title="Productivity"
    value={`${stats.productivity}%`}
    className="hidden md:block"
  />
</div>
```

### Editor on Mobile

**Virtual keyboard handling**:
```tsx
// Detect virtual keyboard
const [keyboardHeight, setKeyboardHeight] = useState(0);

useEffect(() => {
  if (isMobile) {
    const handleResize = () => {
      const visualViewport = window.visualViewport;
      if (visualViewport) {
        const keyboardHeight = window.innerHeight - visualViewport.height;
        setKeyboardHeight(keyboardHeight);
      }
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }
}, [isMobile]);

// Adjust scroll calculation
const getViewportHeight = () => {
  if (isMobile && keyboardHeight > 0) {
    return window.innerHeight - keyboardHeight;
  }
  return window.innerHeight;
};
```

**Toolbar behavior**:
```tsx
<div className="sticky top-0 z-10 border-b bg-muted/30
  overflow-x-auto md:overflow-visible
  scrollbar-hide
  pt-[env(safe-area-inset-top)]">
  {/* Horizontally scrollable toolbar on mobile */}
  <div className="flex items-center gap-1 p-2 min-w-max md:flex-wrap md:min-w-0">
    {toolbarButtons}
  </div>
</div>
```

### BottomNav Clearance

**Content padding**:
```tsx
// In ResponsiveLayout
<main className="flex-1 overflow-auto">
  <div className="container max-w-6xl
    py-4 px-4 md:py-6 md:px-6 lg:px-8
    pb-24 lg:pb-6"> {/* 96px bottom padding on mobile for BottomNav */}
    {children}
  </div>
</main>
```

**Safe area insets**:
```tsx
// In BottomNav
<nav className="fixed bottom-0 left-0 right-0
  bg-background border-t z-50
  pb-[env(safe-area-inset-bottom)]">
  <div className="grid grid-cols-5 h-16">
    {navItems}
  </div>
</nav>
```

### Performance Optimizations

**Lazy loading**:
```tsx
// Lazy load below-the-fold sections
const UnifiedInsightsFeed = lazy(() => import('./unified-insights-feed'));

<Suspense fallback={<InsightsSkeleton />}>
  <UnifiedInsightsFeed userId={user.id} />
</Suspense>
```

**Reduced animations**:
```tsx
// Disable smooth scroll on mobile for performance
const scrollBehavior = isMobile ? 'auto' : 'smooth';

container.scrollTo({
  top: targetScroll,
  behavior: scrollBehavior
});
```

### Testing Checklist

- [ ] iPhone SE (375px - smallest modern iPhone)
- [ ] iPhone 14 Pro (393px - notch + Dynamic Island)
- [ ] iPhone 14 Pro Max (430px - largest iPhone)
- [ ] iPad Mini (768px - tablet breakpoint)
- [ ] Android phone (various sizes)
- [ ] Landscape orientation
- [ ] Virtual keyboard appearance
- [ ] Safe area insets (notch, home indicator)
- [ ] Dark mode
- [ ] Slow 3G connection

---

## Implementation Plan

### Phase 1: Component Cleanup (Day 1)
1. Remove ActionBar component and usage
2. Remove Command Palette component
3. Remove SearchHeader component
4. Remove dashboard quick action buttons
5. Remove InsightsCard component

### Phase 2: UnifiedSearch Enhancement (Day 1-2)
1. Add creation commands
2. Implement keyboard shortcuts
3. Enhance visual prominence
4. Test desktop + mobile

### Phase 3: Dashboard Redesign (Day 2-3)
1. Create HeroSection component
2. Create ConditionalSection component
3. Restructure dashboard layout
4. Implement conditional rendering
5. Test responsive breakpoints

### Phase 4: Editor Scroll Fix (Day 3)
1. Create CenteredCursor TipTap extension
2. Integrate into MarkdownEditor
3. Handle edge cases
4. Test on long documents

### Phase 5: AI Insights Consolidation (Day 3-4)
1. Create UnifiedInsightsFeed component
2. Merge functionality from both components
3. Update dashboard usage
4. Delete old components

### Phase 6: Mobile Optimization (Day 4-5)
1. Test all changes on mobile devices
2. Fix touch target sizes
3. Adjust spacing and typography
4. Test virtual keyboard handling
5. Verify safe area insets

### Phase 7: Testing & Polish (Day 5)
1. Full regression testing
2. Performance profiling
3. Accessibility audit
4. User acceptance testing

---

## Success Metrics

### User Experience
- **Discoverability**: 80%+ of users find UnifiedSearch within first session
- **Task completion**: <2 clicks to create note/task/project (was 2-3)
- **Dashboard load**: <1s to interactive (no regression)

### Code Quality
- **Components removed**: 5 (ActionBar, Command Palette, SearchHeader, InsightsCard, CapturesCard)
- **Lines of code**: -500 (estimated)
- **Bundle size**: -20KB (estimated)

### Maintenance
- **Duplicated logic**: 0 (was 2 insight systems)
- **Conditional rendering**: Consistent across all sections
- **Mobile support**: Parity with desktop

---

## Trade-offs & Risks

### Trade-offs
- **Discoverability vs. Cleanliness**: New users must learn UnifiedSearch exists (mitigated by prominent placement)
- **Clicks to action**: +1 click on mobile for quick actions (acceptable for cleaner UI)
- **Customization**: Harder to add dashboard quick actions (good - forces intentional design)

### Risks
- **User confusion**: Remove familiar ActionBar (mitigated by gradual rollout + help tooltip)
- **Mobile keyboard**: Virtual keyboard might obscure UnifiedSearch overlay (tested on multiple devices)
- **Performance**: Centered cursor tracking might impact editor performance (mitigated by debouncing + RAF)

### Mitigation Strategies
1. **Onboarding**: Show tooltip pointing to UnifiedSearch on first visit
2. **Help**: Add "?" icon next to UnifiedSearch with quick tutorial
3. **Gradual rollout**: A/B test with 10% of users first
4. **Monitoring**: Track UnifiedSearch usage, task completion times, bounce rates

---

## Conclusion

This design transforms the brain-portal UI from a cluttered, multi-pathway interface into a clean, focused, command-first experience. By consolidating around UnifiedSearch, we reduce cognitive load, improve discoverability, and create a more maintainable codebase.

The key insight: **Users don't need multiple ways to do the same thing**. One excellent search/command interface beats scattered buttons and redundant navigation every time.

### Next Steps
1. Get design approval ✅
2. Create implementation plan with tasks
3. Begin Phase 1: Component Cleanup
4. Iterate based on user feedback

---

**Design Status**: ✅ Approved
**Ready for Implementation**: Yes
**Estimated Timeline**: 5 days
**Risk Level**: Medium (UI changes, but well-scoped)
