# Dashboard Redesign: Today's Focus

**Date:** 2026-02-06
**Status:** Design Complete - Ready for Implementation
**Goal:** Transform dashboard into a mobile-friendly, action-focused hub that merges inbox functionality and removes broken knowledge graph

---

## Overview

The redesigned dashboard follows a **"Today's Focus"** principle - surface time-sensitive, actionable items first, with contextual information accessible but not overwhelming. This single-page hub replaces both the current dashboard and separate inbox page.

### Key Changes

1. ✅ **Remove Knowledge Graph** - Component causing errors, will be fixed separately
2. ✅ **Integrate Inbox** - Merge captures and insights into dashboard
3. ✅ **Prioritize Tasks** - Today + Scheduled sections always visible
4. ✅ **Mobile-First** - Touch-optimized with swipe gestures and compact spacing
5. ✅ **Smart Visibility** - Critical items always visible, contextual items collapsible

---

## Architecture

### Layout Structure (Vertical Stack)

**Always Visible (Critical Zone):**
- ✅ Today's Tasks
- 📅 Scheduled Tasks
- 📥 Unprocessed Captures (count badge, expand inline)
- 💡 AI Insights (count badge, expand inline)

**Collapsible (Contextual Zone):**
- 📝 Daily Note Preview
- 📁 Active Projects
- 📄 Recent Notes

**Removed:**
- 🗑️ Knowledge Graph component (`<GraphSection />`)

### Responsive Behavior

**Mobile (<1024px):**
- Single column layout
- Compact spacing (2-3px gaps)
- Touch targets minimum 44px
- Swipe gestures enabled
- Count badges prominent

**Desktop (≥1024px):**
- Wider spacing (4-6px gaps)
- Side-by-side layouts where appropriate (e.g., Projects + Notes)
- Hover states
- Keyboard shortcuts

---

## Detailed Component Specs

### 1. Today's Tasks Section (Always Visible)

**Purpose:** Primary action zone for immediate work

**Layout:**
```
✅ Today's Tasks (3)
  [+ Add a task...]  ← Quick-add input

  □ High priority task                    [urgent]
  □ Delegated to AI task         [🤖 In Progress]
  □ Regular task                         [medium]
```

**Task Item Components:**
- Checkbox (left) - tap to complete
- Title (center, truncate if long)
- Badges (right):
  - Priority: urgent (red), high (orange)
  - AI status: "🤖 In Progress", "⏳ Awaiting Review"
  - Project: colored dot

**Interactions:**
- Tap checkbox → mark complete (optimistic UI)
- Tap task → open detail/edit modal
- Long-press → quick actions menu (Edit | Schedule | Delegate | Delete)
- Swipe right → complete
- Swipe left → delete

**Quick-Add Input:**
- Placeholder: "Add a task..."
- Tap to expand: shows priority selector (Low | Medium | High | Urgent)
- Enter to submit, Esc to cancel
- Creates task with status: pending, priority: selected

**Empty State:**
- "No tasks for today. Add one above!"

**Data Loading:**
```sql
SELECT * FROM tasks
WHERE user_id = ?
  AND status IN ('pending', 'in_progress')
  AND (
    scheduled_for IS NULL
    OR DATE(scheduled_for) = DATE('now')
  )
ORDER BY
  CASE priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    ELSE 4
  END,
  created_at DESC
```

### 2. Scheduled Tasks Section (Always Visible)

**Purpose:** Show upcoming tasks with specific times

**Layout:**
```
📅 Scheduled (2)

  Today 2:00 PM
  □ Meeting prep                         [high]

  Tomorrow
  □ Review code                          [medium]
```

**Grouping:**
- Today (with time): tasks scheduled for today with specific times
- Tomorrow: tasks scheduled for tomorrow
- This Week: tasks scheduled within 7 days
- Later: tasks scheduled beyond 7 days (collapsed by default)

**Interactions:**
- Same as Today's Tasks
- Drag to reschedule (desktop only)

**Visibility:**
- Hidden if no scheduled tasks exist
- Shows next 10 scheduled tasks

**Data Loading:**
```sql
SELECT * FROM tasks
WHERE user_id = ?
  AND status IN ('pending', 'in_progress')
  AND scheduled_for IS NOT NULL
ORDER BY scheduled_for ASC
LIMIT 10
```

### 3. Unprocessed Captures Card (Collapsed by Default)

**Purpose:** Process inbox items without leaving dashboard

**Collapsed State:**
```
📥 Unprocessed Captures (5)         [pulse if > 0]
    Last: 2h ago
    [tap to expand ▼]
```

**Expanded State:**
```
📥 Unprocessed Captures (5)         [✕ collapse]

  [Capture Card 1]
  [Capture Card 2]
  [Capture Card 3]
  ...
```

**Capture Card Components:**

**Text Capture:**
- Content preview (3 lines, truncate with "...")
- Timestamp: "2h ago"
- Actions: "→ Note" | "→ Task" | "🗑️ Delete"

**Link Capture:**
- Favicon + Title (from metadata)
- Description (if available)
- Thumbnail image (if available)
- URL (truncated)
- Scraping status: "✨ Full content fetched" or "⏳ Fetching..."
- Actions: "→ Note" | "→ Task" | "🗑️ Delete"

**Interactions:**
- Swipe right → convert to note
- Swipe left → delete
- Tap card → expand to full view with all actions

**Convert to Note Logic:**
- Text capture: creates note with content as-is
- Link capture: creates formatted note with metadata, scraped content, source link
- Marks capture as processed
- Navigates to new note

**Convert to Task Logic:**
- Creates task with capture content as title
- Marks capture as processed
- Shows success toast, stays on dashboard

**Data Loading:**
```sql
SELECT * FROM captures
WHERE user_id = ?
  AND processed = FALSE
ORDER BY captured_at DESC
LIMIT 50
```

### 4. AI Insights Card (Collapsed by Default)

**Purpose:** Surface AI-generated connections and suggestions

**Collapsed State:**
```
💡 AI Insights (3)                   [⟳ Refresh]
    Auto-updated daily
    [tap to expand ▼]
```

**Expanded State:**
```
💡 AI Insights (3)                   [⟳ Refresh] [✕]

  [Insight Card 1]
  [Insight Card 2]
  [Insight Card 3]
```

**Insight Card Components:**
- Type badge: Connection | Theme | Gap | Question
- Title (bold)
- Content preview (3-4 lines)
- Source notes: "Based on: Note A, Note B" (linked)
- Confidence: subtle indicator (e.g., 3/5 stars)
- Actions: "→ Create Note" | "Dismiss"

**Auto-Refresh Logic:**
```javascript
// On dashboard mount
const lastGenerated = await getLastInsightGenerationTime(userId);
const isStale = Date.now() - lastGenerated > 24 * 60 * 60 * 1000; // 24h

if (isStale) {
  // Background generation
  fetch('/api/insights/generate', {
    method: 'POST',
    body: JSON.stringify({ includeCaptures: true, daysBack: 7 })
  });
}
```

**Manual Refresh:**
- "⟳ Refresh" button triggers: `POST /api/insights/generate?skipCache=true`
- Shows loading spinner in badge
- Updates count when complete

**Create Note from Insight:**
- Creates note with insight title and content
- Links source notes in note content
- Marks insight as actioned
- Navigates to new note

**Data Loading:**
```sql
SELECT * FROM insights
WHERE user_id = ?
  AND is_dismissed = FALSE
  AND is_actioned = FALSE
ORDER BY generated_at DESC
LIMIT 20
```

### 5. Daily Note Preview (Collapsed by Default)

**Purpose:** Quick access to today's journaling

**Collapsed State:**
```
📝 Today's Note
    247 words | Updated 2h ago
    [tap to expand ▼]
```

**Expanded State:**
```
📝 Today's Note                      [Open to Edit →]

  First 3-4 lines of markdown content rendered here...
  (Read-only preview, not editable inline)

  [Open to Edit]
```

**States:**
- Exists: show word count, last update time, content preview
- Empty: "Not started yet" + "Open to Edit" button
- Doesn't exist: "Start today's note" button (creates on click)

**Data Loading:**
```sql
SELECT n.* FROM notes n
JOIN daily_notes dn ON n.id = dn.note_id
WHERE dn.user_id = ?
  AND dn.date = DATE('now')
LIMIT 1
```

### 6. Active Projects Card (Collapsed by Default)

**Purpose:** Quick navigation to ongoing projects

**Collapsed State:**
```
📁 Active Projects (5)
    [tap to expand ▼]
```

**Expanded State:**
```
📁 Active Projects (5)              [View All →]

  ● Project Alpha           [active]  3 tasks
  ● Project Beta            [active]  1 task
  ● Project Gamma           [active]  0 tasks
  ...
```

**Project Item Components:**
- Color dot (project.color)
- Project name
- Status badge
- Task count
- Tap to navigate to `/projects/${slug}`

**Data Loading:**
```sql
SELECT
  p.*,
  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'pending') as task_count
FROM projects p
WHERE p.user_id = ?
  AND p.status = 'active'
ORDER BY p.updated_at DESC
LIMIT 5
```

### 7. Recent Notes (Collapsed by Default)

**Purpose:** Quick access to recently edited notes

**Collapsed State:**
```
📄 Recent Notes
    [tap to expand ▼]
```

**Expanded State:**
```
📄 Recent Notes                     [View All →]

  ● Meeting Notes               Updated 2h ago
    "Discussed project timeline..."

  ● Research Ideas             Updated 1d ago
    "Exploring new approaches to..."
  ...
```

**Note Item Components:**
- Project color dot (if associated)
- Title
- Timestamp (relative)
- Content preview (1 line)
- Note type badge (if not standard)
- Tap to navigate to `/notes/${slug}`

**Data Loading:**
```sql
SELECT
  n.*,
  p.name as project_name,
  p.color as project_color
FROM notes n
LEFT JOIN projects p ON n.project_id = p.id
WHERE n.user_id = ?
  AND n.is_archived = FALSE
ORDER BY n.updated_at DESC
LIMIT 7
```

---

## State Management

### Collapse State Persistence

Store section collapse states in localStorage:

```typescript
interface DashboardState {
  sections: {
    captures: boolean;      // true = expanded
    insights: boolean;
    dailyNote: boolean;
    projects: boolean;
    recentNotes: boolean;
  }
}

// Default state (first-time users)
const DEFAULT_STATE = {
  sections: {
    captures: false,        // collapsed
    insights: false,        // collapsed
    dailyNote: false,       // collapsed
    projects: false,        // collapsed
    recentNotes: false,     // collapsed
  }
}
```

### Real-time Updates

Use React Query for data synchronization:

- `['tasks', 'today']` - Today's tasks
- `['tasks', 'scheduled']` - Scheduled tasks
- `['captures', 'unprocessed']` - Unprocessed captures
- `['insights', 'new']` - New insights
- `['daily-note', date]` - Daily note for date
- `['projects', 'active']` - Active projects
- `['notes', 'recent']` - Recent notes

Invalidate queries on mutations:
- Task completed → invalidate `['tasks', 'today']`
- Capture converted → invalidate `['captures', 'unprocessed']`
- Insight dismissed → invalidate `['insights', 'new']`

---

## Mobile Optimizations

### Touch Interactions

**Swipe Gestures:**
- Implement using `react-swipeable` or native touch events
- Swipe threshold: 50px
- Visual feedback: card slides with finger, shows action icon
- Elastic boundaries: prevent over-swiping

**Touch Targets:**
- Minimum 44px height for all interactive elements
- Adequate spacing between tap targets (8px minimum)
- Larger checkboxes on mobile (24px vs 16px desktop)

### Performance

**Lazy Loading:**
- Load collapsed sections only when expanded
- Use React.lazy for heavy components
- Intersection Observer for below-fold content

**Optimistic UI:**
- Checkbox toggles update immediately (rollback on error)
- Task creation shows in list before server confirms
- Capture actions remove from list immediately

**Data Limits:**
- Today's tasks: all (unlimited)
- Scheduled tasks: 10
- Captures: 50
- Insights: 20
- Projects: 5
- Recent notes: 7

### Responsive Breakpoints

```css
/* Mobile-first approach */
.dashboard {
  padding: 12px;              /* Mobile: 12px */
  gap: 12px;                  /* Mobile: 12px */
}

@media (min-width: 1024px) {
  .dashboard {
    padding: 24px;            /* Desktop: 24px */
    gap: 24px;                /* Desktop: 24px */
  }
}
```

---

## Component Architecture

### File Structure

```
src/
├── app/(dashboard)/
│   └── page.tsx                    # Main dashboard page (new)
├── components/dashboard/
│   ├── action-bar.tsx              # Keep existing
│   ├── today-tasks-section.tsx     # New
│   ├── scheduled-tasks-section.tsx # New
│   ├── captures-card.tsx           # New (replaces inbox page)
│   ├── insights-card.tsx           # New (replaces inbox insights)
│   ├── daily-note-preview.tsx      # New
│   ├── active-projects-card.tsx    # New
│   ├── recent-notes-section.tsx    # Keep, modify
│   ├── task-item.tsx               # New (reusable task component)
│   ├── capture-card.tsx            # Move from inbox/
│   ├── link-capture-card.tsx       # Move from inbox/
│   └── insight-card.tsx            # Move from inbox/
└── app/(dashboard)/inbox/
    └── page.tsx                    # DELETE (functionality merged)
```

### Component Hierarchy

```tsx
<DashboardPage>
  <ActionBar />
  <div className="dashboard-content">
    {/* Always visible */}
    <TodayTasksSection />
    <ScheduledTasksSection />

    {/* Collapsible with badges */}
    <CapturesCard collapsed={state.captures} />
    <InsightsCard collapsed={state.insights} />

    {/* Collapsible */}
    <DailyNotePreview collapsed={state.dailyNote} />
    <ActiveProjectsCard collapsed={state.projects} />
    <RecentNotesSection collapsed={state.recentNotes} />
  </div>
</DashboardPage>
```

### Shared Components

**CollapsibleSection:**
```tsx
interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  badge?: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;  // e.g., Refresh button
  children: React.ReactNode;
}
```

**TaskItem:**
```tsx
interface TaskItemProps {
  task: Task;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (task: Task) => void;
  showProject?: boolean;
  showScheduledTime?: boolean;
}
```

---

## API Changes

### New Endpoints

None required - all existing APIs support this design.

### Modified Queries

**Dashboard Data Fetching:**

Change from separate queries to a single optimized fetch:

```typescript
// src/app/(dashboard)/page.tsx
async function getDashboardData(userId: string) {
  const today = new Date().toISOString().split('T')[0];

  // Parallel queries
  const [
    todayTasks,
    scheduledTasks,
    unprocessedCaptures,
    newInsights,
    dailyNote,
    activeProjects,
    recentNotes,
  ] = await Promise.all([
    queryTodayTasks(userId),
    queryScheduledTasks(userId),
    queryUnprocessedCaptures(userId),
    queryNewInsights(userId),
    queryDailyNote(userId, today),
    queryActiveProjects(userId),
    queryRecentNotes(userId),
  ]);

  return {
    todayTasks,
    scheduledTasks,
    unprocessedCaptures,
    newInsights,
    dailyNote,
    activeProjects,
    recentNotes,
  };
}
```

---

## Migration Strategy

### Phase 1: Remove Knowledge Graph
- Remove `<GraphSection />` from dashboard
- Remove graph-section.tsx component
- Update imports and layout

### Phase 2: Build New Task Sections
- Create TodayTasksSection component
- Create ScheduledTasksSection component
- Create TaskItem shared component
- Add quick-add functionality
- Implement swipe gestures

### Phase 3: Migrate Inbox Components
- Move capture/insight components to dashboard/
- Create CapturesCard wrapper
- Create InsightsCard wrapper
- Implement collapse/expand logic
- Add auto-refresh for insights

### Phase 4: Add Collapsible Sections
- Create DailyNotePreview component
- Update ActiveProjectsCard with collapse
- Update RecentNotesSection with collapse
- Implement localStorage persistence

### Phase 5: Polish & Test
- Mobile touch testing
- Swipe gesture refinement
- Performance optimization
- Accessibility audit
- Delete old inbox page

### Phase 6: Navigation Updates
- Update sidebar links (remove separate Inbox link)
- Update ActionBar
- Update any deep links to /inbox

---

## Testing Strategy

### Unit Tests

**Task Sections:**
- Rendering with empty/populated data
- Quick-add functionality
- Task completion toggling
- Swipe gesture handlers
- Priority sorting

**Capture/Insight Cards:**
- Collapse/expand state
- Convert to note/task
- Delete functionality
- Auto-refresh logic
- Badge count updates

### Integration Tests

**Dashboard Data Flow:**
- Fetch all sections in parallel
- Error handling (database unavailable)
- Real-time updates via React Query
- State persistence

### Mobile Tests

**Touch Interactions:**
- Swipe gestures on various devices
- Touch target sizes (accessibility)
- Scroll performance
- Keyboard behavior (virtual keyboard)

### Accessibility Tests

**WCAG Compliance:**
- Keyboard navigation (tab order)
- Screen reader announcements
- Color contrast ratios
- Focus indicators
- ARIA labels for badges and icons

---

## Success Metrics

### User Experience
- ✅ All dashboard actions possible without navigation
- ✅ Critical items (tasks, captures) visible in < 1 second
- ✅ Mobile scroll performance > 60fps
- ✅ Touch targets meet 44px minimum

### Code Quality
- ✅ Component reusability (TaskItem, CollapsibleSection)
- ✅ Type safety (full TypeScript coverage)
- ✅ Test coverage > 80%
- ✅ No prop drilling (proper state management)

### Performance
- ✅ Initial load < 1.5s (LCP)
- ✅ Interaction latency < 100ms (FID)
- ✅ No layout shifts (CLS = 0)
- ✅ Bundle size impact < 50kb

---

## Future Enhancements

**Phase 2 (Post-Launch):**
- Restore Knowledge Graph (after fixing errors)
- Drag-to-reorder tasks
- Bulk actions (select multiple, complete/delete)
- Custom dashboard layouts (user preferences)
- Widgets system (add/remove sections)

**Phase 3 (Advanced):**
- AI-suggested task prioritization
- Smart task scheduling (ML-based)
- Voice input for quick-add
- Offline mode with sync
- Dashboard templates for different workflows

---

## Conclusion

This redesign transforms the dashboard from a passive overview into an **active command center**. By merging inbox functionality, prioritizing actionable items, and optimizing for mobile-first usage, we create a streamlined experience that supports the full range of personal knowledge management workflows.

The "Today's Focus" principle ensures users start each session with clarity about what needs attention, while collapsible sections keep contextual information accessible without overwhelming the interface.

**Ready for implementation.**
