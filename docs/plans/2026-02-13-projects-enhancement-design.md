# Project Dashboard Enhancement - Design Document

**Date:** 2026-02-13
**Author:** Claude Code
**Status:** Approved

## Overview

Transform the project detail page into a comprehensive, intuitive project management dashboard that surfaces all project-related data from the existing database schema. This enhancement makes projects the central hub for organizing notes, tasks, captures, AI work, insights, and activity.

## Goals

1. **Comprehensive View:** Show all project-related data in one place
2. **Intuitive UX:** Dashboard layout with collapsible sections
3. **Performance:** Lazy-load below-fold data, optimize queries
4. **Mobile-First:** Responsive design that works on all devices
5. **No Schema Changes:** Use existing database tables only

## Design Approach: Dashboard Layout

Single scrolling page with collapsible card sections, organized by priority and relevance. Each section can be expanded/collapsed with preferences saved per project.

### Why Dashboard Layout?

- Everything accessible without navigation
- Progressive disclosure (collapse what you don't need)
- Mobile-friendly single column design
- Incremental implementation
- Familiar pattern for users
- Easy to add/reorder sections

## Architecture & Data Flow

### Data Fetching Strategy

**Phase 1 - Critical Path (Initial Load):**
- Project metadata
- Notes (top 20)
- Tasks (all)
- Quick stats (counts only)
- Sub-projects (immediate children)

**Phase 2 - Below the Fold (Lazy Load):**
- Activity timeline (intersection observer)
- Captures linked to project
- Agent tasks for project
- Insights from project notes
- Note connections within project
- Task recommendations

### API Endpoints

#### New Endpoints

1. **`GET /api/projects/[id]/stats`**
   - Returns: note count, task counts, capture count, agent task count, activity count, sub-project count
   - Used for: Overview stats card

2. **`GET /api/projects/[id]/subprojects`**
   - Returns: Child projects with their stats
   - Used for: Sub-projects section

3. **`GET /api/projects/[id]/activities`**
   - Query params: `?limit=50&offset=0&type=all`
   - Returns: Activity log entries for project, notes, tasks
   - Used for: Activity timeline

4. **`GET /api/projects/[id]/captures`**
   - Returns: Captures where `linked_projects` contains project ID
   - Used for: Captures section

5. **`GET /api/projects/[id]/agent-tasks`**
   - Query params: `?status=all&type=all`
   - Returns: Agent tasks assigned to project
   - Used for: AI Agent Tasks section

6. **`GET /api/projects/[id]/insights`**
   - Returns: Insights from project notes
   - Used for: Insights section

7. **`GET /api/projects/[id]/connections`**
   - Returns: Note connections within project
   - Used for: Note Connections section

8. **`GET /api/projects/[id]/recommendations`**
   - Returns: Task recommendations from project sources
   - Used for: Task Recommendations section

#### Enhanced Endpoint

**`GET /api/projects/[id]?full=true`**
- Add optional query param to include stats and sub-projects
- Reduces initial API calls from 3 to 1

### Database Queries

All queries use existing schema, no new tables needed.

**Stats Query:**
```sql
SELECT
  (SELECT COUNT(*) FROM notes WHERE project_id = ?) as noteCount,
  (SELECT COUNT(*) FROM tasks WHERE project_id = ?) as taskCount,
  (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status IN ('pending', 'in_progress')) as activeTasks,
  (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'completed') as completedTasks,
  (SELECT COUNT(*) FROM captures WHERE linked_projects LIKE '%' || ? || '%') as captureCount,
  (SELECT COUNT(*) FROM agent_tasks WHERE project_id = ?) as agentTaskCount,
  (SELECT COUNT(*) FROM activity_log WHERE entity_type IN ('project', 'note', 'task') AND created_at > datetime('now', '-7 days')) as recentActivityCount,
  (SELECT COUNT(*) FROM projects WHERE parent_id = ?) as subProjectCount
```

**Activities Query:**
```sql
SELECT * FROM activity_log
WHERE user_id = ?
  AND (
    (entity_type = 'project' AND entity_id = ?)
    OR (entity_type = 'note' AND entity_id IN (SELECT id FROM notes WHERE project_id = ?))
    OR (entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE project_id = ?))
  )
ORDER BY created_at DESC
LIMIT ? OFFSET ?
```

**Captures Query:**
```sql
SELECT * FROM captures
WHERE user_id = ?
  AND linked_projects LIKE '%' || ? || '%'
ORDER BY captured_at DESC
LIMIT 50
```

**Insights Query:**
```sql
SELECT DISTINCT i.*
FROM insights i
WHERE i.user_id = ?
  AND i.is_dismissed = 0
  AND EXISTS (
    SELECT 1 FROM notes n
    WHERE n.project_id = ?
      AND i.source_notes LIKE '%' || n.id || '%'
  )
ORDER BY i.generated_at DESC
LIMIT 50
```

**Connections Query:**
```sql
SELECT nc.*,
  n1.title as source_title,
  n2.title as target_title
FROM note_connections nc
JOIN notes n1 ON nc.source_note_id = n1.id
JOIN notes n2 ON nc.target_note_id = n2.id
WHERE nc.user_id = ?
  AND n1.project_id = ?
  AND n2.project_id = ?
ORDER BY nc.strength DESC
```

## UI Component Structure

### Page Layout

```
┌─────────────────────────────────────────────┐
│ Project Header (sticky)                     │
│ - Name, description, status, actions        │
│ - Breadcrumb (if sub-project)              │
└─────────────────────────────────────────────┘
│                                             │
│ ┌─────────────────────────────────────┐   │
│ │ Overview Stats Card                  │   │
│ │ [Collapsible, expanded by default]  │   │
│ └─────────────────────────────────────┘   │
│                                             │
│ ┌─────────────────────────────────────┐   │
│ │ Sub-projects Card (if any)           │   │
│ │ [Collapsible, expanded by default]  │   │
│ └─────────────────────────────────────┘   │
│                                             │
│ ┌─────────────────────────────────────┐   │
│ │ Activity Timeline                    │   │
│ │ [Collapsible, collapsed by default] │   │
│ └─────────────────────────────────────┘   │
│                                             │
│ ┌──────────────┬──────────────┐           │
│ │ Notes Card   │ Tasks Card   │ [2-col]   │
│ │ [Enhanced]   │ [Enhanced]   │           │
│ └──────────────┴──────────────┘           │
│                                             │
│ ┌──────────────┬──────────────┐           │
│ │ Captures     │ AI Tasks     │ [2-col]   │
│ └──────────────┴──────────────┘           │
│                                             │
│ ┌──────────────┬──────────────┐           │
│ │ Insights     │ Task Recs    │ [2-col]   │
│ └──────────────┴──────────────┘           │
│                                             │
│ ┌─────────────────────────────────────┐   │
│ │ Note Connections (full width)        │   │
│ └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### Responsive Behavior

- **Desktop (lg):** 2-column grid for paired cards
- **Tablet (md):** 2-column for some, 1-column for others
- **Mobile (sm):** All single column, reduced spacing

### Component Hierarchy

```tsx
<ProjectDetailPage>
  <ProjectHeader
    project={project}
    onEdit={...}
    onDelete={...}
    sticky={true}
  />

  <div className="space-y-4">
    <CollapsibleSection title="Overview" defaultExpanded={true}>
      <StatsGrid stats={stats} />
    </CollapsibleSection>

    {subProjects.length > 0 && (
      <CollapsibleSection title="Sub-projects" count={subProjects.length}>
        <ProjectTree projects={subProjects} />
      </CollapsibleSection>
    )}

    <CollapsibleSection title="Activity" count={activities.length}>
      <ActivityTimeline activities={activities} />
    </CollapsibleSection>

    <div className="grid md:grid-cols-2 gap-4">
      <NotesCard notes={notes} projectId={project.id} />
      <TasksCard tasks={tasks} projectId={project.id} />
    </div>

    <div className="grid md:grid-cols-2 gap-4">
      <CapturesCard captures={captures} />
      <AgentTasksCard agentTasks={agentTasks} />
    </div>

    <div className="grid md:grid-cols-2 gap-4">
      <InsightsCard insights={insights} />
      <TaskRecommendationsCard recommendations={recommendations} />
    </div>

    <CollapsibleSection title="Note Connections" count={connections.length}>
      <NoteConnectionsGraph connections={connections} />
    </CollapsibleSection>
  </div>
</ProjectDetailPage>
```

### New Shared Component: CollapsibleSection

```tsx
interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  defaultExpanded?: boolean;
  children: ReactNode;
}
```

**Features:**
- Title with count badge
- Chevron expand/collapse indicator
- Saves state to localStorage per project
- Smooth Radix Collapsible animation

## Section Breakdown

### 1. Overview Stats Card

**Display:**
- 2x3 grid of metric cards (responsive)
- Each metric: icon, label, count, optional change indicator

**Metrics:**
- Total Notes
- Active Tasks (pending + in_progress)
- Completed Tasks
- Captures Linked
- AI Tasks (queued + processing + awaiting_review)
- Recent Activity (last 7 days)

**Features:**
- Click metric to jump/filter to that section
- Color-coded by status

### 2. Sub-projects Card

**Display:**
- Hierarchical tree view
- Shows immediate children by default
- Each item: name, status badge, note count, task count

**Features:**
- Expand/collapse nested children
- Quick navigation to sub-project
- "Add Sub-project" button

### 3. Activity Timeline

**Display:**
- Reverse chronological feed
- Grouped by date (Today, Yesterday, This Week, Older)
- Shows last 50 activities with "Load More"

**Activity Types:**
- Note created/updated/deleted
- Task created/completed/updated
- Capture linked to project
- AI task assigned/completed
- Project status changed
- Sub-project added

**Each Item Shows:**
- Type icon
- Action description
- Relative timestamp
- Click to navigate

**Features:**
- Filter by activity type
- Date range picker
- Export to CSV

### 4. Notes Card (Enhanced)

**Current Features:**
- List view with title, word count, date, pinned badge

**New Features:**
- Search/filter bar
- Sort options (Recent, Oldest, A-Z, Word Count)
- View toggle (List vs. Grid)
- Pagination with "Load More"
- Bulk actions (multi-select)

### 5. Tasks Card (Enhanced)

**Current Features:**
- List view with checkboxes

**New Features:**
- View toggle (List vs. Kanban)
- Filter by status, priority, due date
- Sort by due date, priority, created date
- Quick inline task creation
- Bulk actions (multi-select)

### 6. Captures Card

**Display:**
- List of captures linked to project
- Shows: content (truncated), type badge, date

**Features:**
- Filter by capture type
- Click to view full capture in modal
- Unlink from project action
- Convert capture to note/task
- Link additional notes

### 7. AI Agent Tasks Card

**Display:**
- List of agent tasks for project
- Shows: title, agent type badge, status badge, date

**Features:**
- Filter by status and agent type
- Click to view task detail and output
- "New AI Task" button (pre-filled with project context)

### 8. Insights Card

**Display:**
- List of insights from project notes
- Shows: title, insight type badge, confidence, source count

**Insight Types:**
- connection, theme, action, question, pattern, summary, gap, leverage

**Features:**
- Filter by insight type
- Dismiss insight
- Mark as actioned
- View full insight with sources

### 9. Task Recommendations Card

**Display:**
- List of task recommendations from project
- Shows: task text, confidence, priority, reasoning

**Features:**
- Accept recommendation (creates task)
- Reject/dismiss recommendation
- Edit before accepting
- Filter by confidence threshold

### 10. Note Connections

**Display Options:**
- Graph view: Visual network (nodes & edges)
- List view: Grouped by connection type

**Connection Types:**
- related, references, extends, contradicts, supports

**Features:**
- Filter by connection strength (0.0-1.0)
- Filter by connection type
- Highlight manual vs. AI-generated
- Click to navigate to note
- "Add Connection" button (manual)

## User Experience

### State Management

**Collapsible State:**
- Saved to localStorage: `project_${projectId}_sections`
- JSON: `{ overview: true, activity: false, ... }`
- Persists across sessions
- "Reset to Defaults" button

**Filters & Sort:**
- Saved to URL query params
- Example: `/projects/my-project?notesSort=recent&tasksView=kanban`
- Shareable, bookmarkable

### Performance Optimizations

**Initial Load:**
- Fetch only critical data (project, notes, tasks, stats)
- Skeleton loaders for below-fold

**Lazy Loading:**
- Intersection Observer triggers fetch when section scrolls into view
- Reduces initial payload size

**Data Caching:**
- React Query with stale times:
  - Stats: 5 minutes
  - Sub-projects: 10 minutes
  - Activities: 2 minutes
  - Captures: 10 minutes
  - Insights: 30 minutes (expensive)
  - Connections: 30 minutes (expensive)
  - Recommendations: 10 minutes

**Virtualization:**
- Use `react-virtual` for 100+ item lists
- Especially: activity timeline, note connections

### Loading States

1. **Not loaded:** Collapsed section with count badge
2. **Loading:** Expanded with skeleton loaders
3. **Loaded:** Show actual data
4. **Error:** Error message with retry button
5. **Empty:** Empty state with action button

### Empty States

Each section has helpful empty state:
- **Notes:** "No notes yet. Create your first note for this project."
- **Tasks:** "No tasks yet. Add a task to get started."
- **Captures:** "No captures linked. Link captures from the captures page."
- **AI Tasks:** "No AI tasks yet. Delegate work to an AI agent."
- **Insights:** "No insights yet. Insights are generated from your notes."
- **Connections:** "No connections yet. Connections are discovered automatically."
- **Activity:** "No recent activity."

### Mobile Experience

**Optimizations:**
- Single column stacking
- Larger tap targets (min 44x44px)
- Swipe gestures on lists
- Bottom sheet modals
- Sticky header collapses on scroll down

**Touch Interactions:**
- Long-press for context menu
- Pull-to-refresh on timeline
- Haptic feedback on actions

### Keyboard Shortcuts

**Global:**
- `?` - Show shortcuts help
- `/` - Focus search
- `Esc` - Close modals

**Navigation:**
- `1-9` - Jump to section
- `[` / `]` - Previous/next section
- `Space` - Expand/collapse focused section

**Actions:**
- `n` - New note
- `t` - New task
- `a` - New AI task

### Accessibility

**ARIA:**
- All sections have `aria-label`
- Collapsible sections use `aria-expanded`
- Counts use `aria-live`

**Keyboard Navigation:**
- All elements focusable
- Logical tab order
- Focus visible styles

**Color & Contrast:**
- WCAG AA contrast on badges
- Icons have text labels
- No color-only indicators

### User Preferences

**Customization (in project settings):**
- Default collapsed/expanded state per section
- Default view mode (list vs. kanban)
- Default sort order per section
- Hide/show specific sections
- Section order (drag to reorder)

**Storage:** `projects.metadata` JSON field

## Performance Considerations

### Database Indexes

All required indexes exist in current schema:
- `idx_notes_project` on `notes(project_id)`
- `idx_tasks_project` on `tasks(project_id)`
- `idx_activity_entity` on `activity_log(entity_type, entity_id)`
- `idx_connections_source` on `note_connections(source_note_id)`

### Query Optimization

- Use `LIMIT` on all list queries
- Cursor-based pagination for infinite scroll
- Use `EXISTS` instead of `IN` for better performance
- Consider materialized view for insights if too slow

### Caching Strategy

- Client-side: React Query with appropriate stale times
- Server-side: Consider Redis for expensive queries (insights, connections)

## Implementation Plan

### Phase 1: Foundation
1. Create new API endpoints
2. Build CollapsibleSection component
3. Refactor existing project detail page
4. Add stats card

### Phase 2: Core Sections
1. Sub-projects card
2. Activity timeline
3. Enhanced notes card
4. Enhanced tasks card

### Phase 3: AI & Intelligence
1. Captures card
2. Agent tasks card
3. Insights card
4. Task recommendations card

### Phase 4: Advanced Features
1. Note connections (graph + list)
2. Keyboard shortcuts
3. User preferences
4. Performance optimizations

### Phase 5: Polish
1. Empty states
2. Loading states
3. Error handling
4. Accessibility audit
5. Mobile optimizations

## Success Metrics

- **Engagement:** Time spent on project detail page
- **Discovery:** Click-through rate on insights/connections
- **Productivity:** Tasks created from recommendations
- **Performance:** Page load time < 2s, lazy sections < 500ms
- **Satisfaction:** User feedback on comprehensiveness

## Future Enhancements

- Drag-to-reorder sections
- Custom dashboard templates
- Project templates
- Gantt chart view for tasks
- Real-time collaboration indicators
- Project sharing with external users
- Export project report (PDF)
- Project analytics dashboard

## Conclusion

This comprehensive project dashboard transforms projects into the central hub for all project management activities. By surfacing all related data in an intuitive, performant, and accessible interface, users can manage their work more effectively without navigating between multiple pages.

The design leverages the existing database schema without requiring any schema changes, making implementation straightforward and safe. Progressive enhancement through lazy loading ensures fast initial page loads while still providing comprehensive data access.
