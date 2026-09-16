# Navigation Redesign: Dashboard-Centric Mobile-First UX

**Date:** 2026-01-24
**Status:** Design Complete - Awaiting Implementation
**Author:** UX Architecture Team

## Executive Summary

This redesign consolidates 13 pages into 5 primary sections, making Brain Portal more intuitive for users who capture and process information hundreds of times per day. The dashboard becomes the central command center, integrating the knowledge graph, weekly reviews, insights, and quick actions into a single unified workspace.

**Key Changes:**
- Reduce main navigation from 10 items to 5
- Make dashboard the primary workspace (replaces 5 separate pages)
- Persistent site-wide search in header
- Insights integrated into Inbox workflow
- Attachments accessible contextually (no dedicated page)
- Graph, Weekly Reviews, and Daily Note creation all on Dashboard

**Design Philosophy:** Command-palette-first, mobile-optimized, capture-heavy workflow with minimal navigation friction.

---

## 1. Navigation Structure

### 1.1 Current Navigation (13 Pages)

**Main Nav (10):**
- Dashboard
- Inbox
- Daily
- Notes
- Projects
- Tasks
- Captures
- Insights
- Graph
- Weekly

**Secondary (3):**
- Search
- Attachments
- Settings

### 1.2 New Navigation (5 Pages)

**Main Nav (5):**
1. **Dashboard** - Command center with graph, insights feed, weekly summary, quick stats
2. **Inbox** - Process captures & insights (combines Captures + Insights pages)
3. **Notes** - All notes with smart filtering (includes Daily notes)
4. **Projects** - Project workspace (unchanged)
5. **Tasks** - Task management (unchanged)

**Utility:**
- **Settings** - Configuration only

**Removed Pages:**
- ❌ Search (replaced by persistent header search)
- ❌ Attachments (contextual access only)
- ❌ Graph (embedded in dashboard)
- ❌ Weekly (embedded in dashboard)
- ❌ Daily (quick create on dashboard, view in Notes)
- ❌ Captures (merged into Inbox)
- ❌ Insights (merged into Inbox)

### 1.3 Mobile Bottom Navigation

**5 Items (unchanged count, different targets):**
- Dashboard (home icon)
- Inbox (inbox icon)
- Capture (center FAB - action button)
- Notes (file icon)
- Tasks (checkmark icon)

---

## 2. Persistent Search Header

### 2.1 Layout

**Desktop:**
```
[Brain Portal Logo] [Search Bar - full width] [Voice] [Sync] [User Menu]
```

**Mobile:**
```
[Logo] [Search Icon] [Voice] [Menu]
```
(Search icon opens full-screen search overlay on mobile)

### 2.2 Search Features

- **Real-time results** as you type (150ms debounce)
- **Result grouping:** Notes | Tasks | Projects | Captures | Attachments
- **Keyboard navigation:** Arrow keys + Enter
- **Result preview:** Snippet with highlighted matches
- **Scoped search:** Filter by page context (e.g., "Search in: Projects only")
- **Search syntax:**
  - `#tag` - Search by tag
  - `@project` - Search in project
  - `type:task` - Filter by type
  - `date:2024-01-20` - Filter by date

### 2.3 Technical Implementation

**Component:** `src/components/layout/search-header.tsx`

**Reuse:**
- Search API: `/api/search` (already exists)
- Search logic from `src/app/(dashboard)/search/page.tsx`
- FTS5 full-text search (already implemented)

**New:**
- Header component with responsive behavior
- Mobile search overlay
- Integration with main layout

---

## 3. Dashboard Redesign

### 3.1 Vision

The dashboard becomes your daily workspace - the first thing you see and the place you return to constantly. It surfaces what needs attention (inbox count, insights), visualizes your knowledge growth (graph), and provides quick access to all creation actions.

### 3.2 Layout Zones (Mobile-First)

**Zone 1: Action Bar** (sticky header)
```
[Quick Capture] [Create Daily Note] [Generate Weekly Review]
[Inbox: 12] [Today: 5 captures] [Streak: 7 days]
```
- Prominent action buttons with touch-friendly sizing (min-h-11)
- Stats as colored chips with badges

**Zone 2: Knowledge Graph** (hero section)
```
┌─────────────────────────────────────┐
│  Interactive Force-Directed Graph   │
│         (60vh on mobile)            │
│                                     │
│  [Filter: All ▾] [This Week] [Month]│
└─────────────────────────────────────┘
```
- Touch/tap interactive - opens notes in modal
- Visual clustering by project/tag
- Legend overlay (hidden on mobile)
- Reuses: `src/components/graph/knowledge-graph.tsx`

**Zone 3: Smart Insights Feed**
```
┌─────────────────────────────────────┐
│ 💡 Insight: Consider connecting     │
│    "React Patterns" with "State     │
│    Management"                      │
│    [Convert to Note] [Dismiss]     │
└─────────────────────────────────────┘
```
- 3-5 AI-generated insight cards
- Swipeable on mobile
- Each shows: insight text, source, actions
- Sources from `insights` table where `is_dismissed = false`

**Zone 4: Weekly Summary** (collapsible)
```
┌─────────────────────────────────────┐
│ 📅 Week 4, 2026 (Jan 20-26)         │
│ • 12 notes created                  │
│ • 8 tasks completed                 │
│ • Top tags: #development #planning  │
│ • Most active: Brain Portal project │
│ [Regenerate] [View Full Review]    │
└─────────────────────────────────────┘
```
- Shows current week's review (if exists)
- Accordion-style collapsible
- Sources from `weekly_reviews` table

**Zone 5: Quick Access Grid**
```
[Recent Notes]    [Active Projects]    [Upcoming Tasks]
┌──────────┐      ┌──────────┐         ┌──────────┐
│ Note 1   │      │ Project  │         │ Task 1   │
│ Note 2   │      │ Project  │         │ Task 2   │
│ Note 3   │      │ Project  │         │ Task 3   │
│ View All →│     │ View All →│        │ View All →│
└──────────┘      └──────────┘         └──────────┘
```
- 3 cards per section
- Click card → navigate to list view
- Mobile: vertical stack; Desktop: 3-column grid

### 3.3 Desktop Enhancement

**Two-Column Layout:**
```
┌─────────────────┬──────────────┐
│                 │              │
│  Graph (60%)    │  Insights    │
│                 │  Feed (40%)  │
│                 │              │
├─────────────────┴──────────────┤
│  Quick Access Grid (3 columns) │
└─────────────────────────────────┘
```

### 3.4 Data Sources

**Queries needed:**
1. Inbox count: `SELECT COUNT(*) FROM captures WHERE processed = false`
2. Today's captures: `SELECT COUNT(*) FROM captures WHERE date(captured_at) = date('now')`
3. Weekly streak: Calculate from `daily_notes` table
4. Graph data: `GET /api/graph` (already exists)
5. Insights: `SELECT * FROM insights WHERE is_dismissed = false ORDER BY generated_at DESC LIMIT 5`
6. Weekly review: `SELECT * FROM weekly_reviews WHERE year = ? AND week_number = ?`
7. Recent notes: `SELECT * FROM notes WHERE is_archived = false ORDER BY updated_at DESC LIMIT 3`
8. Active projects: `SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT 3`
9. Pending tasks: `SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority DESC LIMIT 3`

**No new API endpoints needed** - all data sources exist.

---

## 4. Inbox Redesign

### 4.1 Purpose

Inbox becomes the unified processing hub for all unprocessed information: quick captures needing conversion AND AI-generated insights needing review.

### 4.2 Tab Structure

**Three Tabs:**

1. **Unprocessed** (default) - Captures needing action
2. **Insights** - AI-generated insights to review
3. **All Captures** - Archive view with filters

### 4.3 Unprocessed Tab

**Layout:**
```
┌─────────────────────────────────────┐
│ 💭 "Need to research Next.js 16"    │
│ 🤖 Suggested: Task                  │
│ Just now                            │
│ ← Convert to Task | Delete →        │
└─────────────────────────────────────┘
```

**Features:**
- Each item shows: content preview, AI-suggested type, timestamp
- **Mobile swipe actions:**
  - Swipe right → Convert to Note
  - Swipe left → Convert to Task
  - Tap → View details & choose action
- **Desktop:** Hover actions
- **Bulk actions toolbar:** Select multiple, batch convert, archive
- **Query:** `SELECT * FROM captures WHERE processed = false ORDER BY captured_at DESC`

**Conversion Actions:**
- Convert to Note → Creates note, marks capture as processed
- Convert to Task → Creates task, marks capture as processed
- Delete → Soft delete (keep in archive)

### 4.4 Insights Tab

**Layout:**
```
┌─────────────────────────────────────┐
│ 🔗 Connection                       │
│ "React Patterns" relates to "State  │
│ Management" - both discuss hooks    │
│                                     │
│ Source: 2 recent notes              │
│ Confidence: 85%                     │
│                                     │
│ [Create Connection] [Dismiss]      │
└─────────────────────────────────────┘
```

**Features:**
- Cards grouped by `insight_type` (connection, theme, action, etc.)
- Each card shows: title, content, source notes/captures, confidence
- **Actions:**
  - "Create Connection" → Adds to `note_connections` table
  - "Convert to Note" → Creates insight note
  - "Add to Project" → Links to project
  - "Dismiss" → Sets `is_dismissed = true`
- **Query:** `SELECT * FROM insights WHERE is_dismissed = false ORDER BY generated_at DESC`

### 4.5 All Captures Tab

**Layout:**
```
[Filters: All | Processed | Unprocessed] [Type: All ▾] [Date: All ▾]

┌─────────────────────────────────────┐
│ 💭 Processed capture content...     │
│ Converted to Note: "React Patterns" │
│ Jan 24, 2:30 PM                     │
└─────────────────────────────────────┘
```

**Features:**
- Archive view with all captures
- Filters: processed status, type, date range
- Shows conversion status (if converted to note/task)
- Read-only (no actions)

---

## 5. Notes Page Redesign

### 5.1 Purpose

Unified view of all note types (regular notes + daily notes) with smart filtering.

### 5.2 Layout

**Header:**
```
Notes
[Filter: All ▾] [Daily Notes] [Regular Notes] [By Tag ▾]
[New Note] [Today's Daily]
```

**List View:**
```
┌─────────────────────────────────────┐
│ 📅 Daily Note - Jan 24, 2026        │
│ Morning focus: Sprint planning...   │
│ Updated 2 hours ago                 │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 📝 React Patterns                   │
│ Custom hooks, context, state...     │
│ #development #react                 │
│ Updated yesterday                   │
└─────────────────────────────────────┘
```

### 5.3 Filtering

**Filter Chips:**
- **All** - Show everything
- **Daily Notes** - Filter `note_type = 'daily'`
- **Regular Notes** - Filter `note_type = 'note'`
- **By Tag** - Dropdown with all tags

**Visual Treatment:**
- Daily notes get calendar icon + date-based display
- Regular notes show tags
- Pinned notes float to top

### 5.4 Quick Create

**Buttons:**
1. **New Note** → Opens editor at `/notes/new`
2. **Today's Daily** →
   - If exists: opens today's daily note
   - If not: creates and opens

**Query for Today's Daily:**
```sql
SELECT n.* FROM notes n
JOIN daily_notes dn ON n.id = dn.note_id
WHERE dn.user_id = ? AND dn.date = date('now')
```

---

## 6. Attachments - Contextual Access

### 6.1 No Dedicated Page

Attachments page is removed. Instead, access attachments through:

1. **Within Notes**
   - Attachment section at bottom of each note
   - Drag-drop or click to upload
   - Preview/download buttons

2. **Command Palette**
   - "Find attachment..." command
   - Searches all attachments
   - Opens parent note

3. **Site-wide Search**
   - Searching filenames returns attachment results
   - Shows parent note context
   - Preview/download actions

4. **Dashboard Widget** (optional)
   - Recent attachments in collapsible panel
   - Quick preview
   - Click → navigate to parent note

### 6.2 Data Access

**No changes needed:**
- `attachments` table already links to `note_id` and `project_id`
- API endpoint `/api/attachments` exists
- Search API already includes attachments

---

## 7. Command Palette & Voice Integration

### 7.1 Command Palette (Cmd+K)

**Already exists at:** `src/components/command-palette/command-palette.tsx`

**Enhancement needed:**
- Add voice recording button in header
- Integrate voice command results into palette
- Add "Start Voice Capture" command

**Categories:**
1. **Create:** New Note, Task, Project, Capture, Today's Daily
2. **Navigate:** Dashboard, Inbox, Recent Notes (5), Active Projects
3. **Actions:** Generate Weekly Review, Process Inbox, Run AI Insights
4. **Search:** (typing automatically searches)
5. **Voice:** Start Voice Capture

### 7.2 Voice System

**Already exists at:** `src/components/voice/*`

**Integration:**
- Voice button in header (next to search)
- Hotkey: Cmd+Shift+V
- Modal overlay: waveform, "Listening..." status
- AI processing: Transcribe → Classify → Create
- Confirmation: Shows result with Edit/Undo

**No changes needed** - already fully implemented.

---

## 8. Responsive Behavior

### 8.1 Breakpoints

- **Mobile:** < 640px (sm)
- **Tablet:** 640px - 1024px (sm to lg)
- **Desktop:** > 1024px (lg+)

### 8.2 Navigation

**Mobile:**
- Sidebar hidden
- Bottom nav visible (5 items)
- Search icon → full-screen overlay
- Hamburger menu for secondary nav

**Desktop:**
- Full sidebar visible
- Bottom nav hidden
- Search bar in header
- No hamburger needed

### 8.3 Dashboard

**Mobile:**
- Single column, vertical scroll
- Graph: 60vh height
- Insights: full-width cards (swipeable)
- Quick Access: vertical stack

**Desktop:**
- Two-column: Graph (60%) + Insights (40%)
- Quick Access: 3-column grid
- Graph: 50vh height
- More whitespace

### 8.4 Touch Targets

**Minimum sizes:**
- Buttons: 44x44px (11 units in Tailwind)
- Tap areas: 48x48px minimum
- Swipe actions: 80px swipe distance threshold

---

## 9. Implementation Plan

### Phase 1: Foundation (Week 1)

**Tasks:**
1. ✅ Create design document
2. Update navigation constants (`src/lib/navigation.ts`)
3. Create persistent search header component
4. Update main layout to include search header
5. Update sidebar and mobile nav with new structure

**Files to modify:**
- `src/lib/navigation.ts` - Update nav arrays
- `src/components/layout/search-header.tsx` - New component
- `src/components/layout/sidebar.tsx` - Update nav items
- `src/components/layout/mobile-nav.tsx` - Update bottom nav
- `src/app/(dashboard)/layout.tsx` - Add search header

**Testing:**
- Navigation works on mobile and desktop
- Search header responsive behavior
- Bottom nav correct items

### Phase 2: Dashboard Enhancement (Week 1-2)

**Tasks:**
1. Modify dashboard page to add new zones
2. Embed knowledge graph component
3. Add insights feed query and display
4. Add weekly summary section
5. Enhance quick access grid
6. Add action bar with stats

**Files to modify:**
- `src/app/(dashboard)/page.tsx` - Main dashboard
- Create `src/components/dashboard/insights-feed.tsx`
- Create `src/components/dashboard/weekly-summary.tsx`
- Create `src/components/dashboard/action-bar.tsx`
- Reuse `src/components/graph/knowledge-graph.tsx`

**Testing:**
- Graph renders and is interactive
- Insights load and display correctly
- Weekly summary shows current week
- Stats are accurate
- Responsive on all screen sizes

### Phase 3: Inbox Redesign (Week 2)

**Tasks:**
1. Add tab system to inbox page
2. Implement Unprocessed tab with swipe actions
3. Implement Insights tab with insight cards
4. Implement All Captures archive view
5. Add conversion actions (capture → note/task)
6. Add bulk actions toolbar

**Files to modify:**
- `src/app/(dashboard)/inbox/page.tsx` - Complete rewrite
- Create `src/components/inbox/capture-card.tsx`
- Create `src/components/inbox/insight-card.tsx`
- Create `src/components/inbox/swipe-actions.tsx`
- Update `src/app/api/captures/[id]/route.ts` - Add conversion endpoints

**Testing:**
- Tab switching works
- Swipe actions on mobile
- Conversion creates note/task and marks processed
- Bulk actions work
- Insights display with correct actions

### Phase 4: Notes Page Update (Week 2)

**Tasks:**
1. Add filter chip UI
2. Implement filtering logic
3. Add "Today's Daily" quick create
4. Update visual treatment for daily notes

**Files to modify:**
- `src/app/(dashboard)/notes/page.tsx` - Add filters
- Create `src/components/notes/filter-chips.tsx`

**Testing:**
- Filters work correctly
- Daily notes visually distinct
- Quick create buttons work
- Search within notes works

### Phase 5: Remove Old Pages (Week 3)

**Tasks:**
1. Remove graph page (redirect to dashboard)
2. Remove weekly page (redirect to dashboard)
3. Remove captures page (redirect to inbox)
4. Remove insights page (redirect to inbox)
5. Remove attachments page (redirect to search)
6. Remove daily page (redirect to notes or dashboard)
7. Add redirects for old URLs

**Files to delete:**
- `src/app/(dashboard)/graph/page.tsx`
- `src/app/(dashboard)/weekly/page.tsx`
- `src/app/(dashboard)/captures/page.tsx`
- `src/app/(dashboard)/insights/page.tsx`
- `src/app/(dashboard)/attachments/page.tsx`
- `src/app/(dashboard)/daily/page.tsx`

**Files to create:**
- `src/middleware.ts` - Add URL redirects

**Testing:**
- Old URLs redirect correctly
- No broken links in UI
- Search still finds attachments

### Phase 6: Polish & Testing (Week 3)

**Tasks:**
1. Add loading states for all new components
2. Add error boundaries
3. Optimize mobile performance
4. Add analytics events
5. User acceptance testing
6. Performance testing
7. Accessibility audit

**Testing checklist:**
- [ ] All pages load without errors
- [ ] Mobile navigation works smoothly
- [ ] Search is fast and accurate
- [ ] Graph is performant with 100+ nodes
- [ ] Swipe actions feel natural
- [ ] Voice integration works
- [ ] Command palette shortcuts work
- [ ] Responsive on all breakpoints
- [ ] Accessible (keyboard nav, screen readers)
- [ ] No console errors or warnings

---

## 10. Database Schema Changes

**Required:** ✅ **NONE**

All necessary tables already exist:
- `captures` - For inbox captures
- `insights` - For insights feed
- `weekly_reviews` - For weekly summaries
- `note_connections` - For graph
- `attachments` - For contextual access
- `daily_notes` - For daily note filtering

**No migrations needed.**

---

## 11. API Changes

**Required:** ✅ **NONE**

All necessary endpoints already exist:
- `GET /api/graph` - Graph data
- `GET /api/insights` - Insights list
- `GET /api/weekly` - Weekly reviews
- `GET /api/captures` - Captures list
- `PATCH /api/captures/[id]` - Update capture
- `GET /api/search` - Site-wide search
- `GET /api/daily` - Daily notes

**New endpoints needed (optional):**
- `POST /api/captures/[id]/convert` - Convert capture to note/task (or add to existing PATCH)

---

## 12. Migration & Rollout

### 12.1 User Communication

**Pre-launch:**
- Blog post explaining changes
- Screenshot tour of new UI
- Migration guide for bookmarks

**Launch:**
- In-app notification banner
- "What's new" modal on first visit
- Help tooltips on new features

### 12.2 Rollout Strategy

**Option A: Big Bang** (Recommended)
- Deploy all changes at once
- Simpler to manage
- Clear before/after state
- Include feature tour

**Option B: Gradual**
- Deploy phase by phase
- Feature flags for new dashboard
- More complex, but safer
- Allow opt-in testing

**Recommendation:** Big Bang with comprehensive testing, since this is a personal project.

### 12.3 Rollback Plan

**If issues arise:**
1. Revert navigation changes (restore old structure)
2. Keep search header (improvement regardless)
3. Keep enhanced dashboard (optional access)
4. Feature flag to enable "classic" nav

**Data safety:**
- No database changes = no data migration risk
- Old data fully compatible with new UI

---

## 13. Success Metrics

### 13.1 Quantitative

**Primary:**
- Time to capture (baseline vs. new) - target: < 5 seconds
- Captures per day - target: increase by 30%
- Inbox processing rate - target: increase by 50%

**Secondary:**
- Search usage frequency
- Command palette usage
- Voice capture adoption
- Dashboard bounce rate (should be low)

### 13.2 Qualitative

**User feedback:**
- "Feels faster"
- "Easier to find things"
- "Love the unified inbox"
- "Graph on dashboard is great"

**UX goals:**
- Zero-friction capture
- Intuitive processing workflow
- Clear information hierarchy
- Delightful interactions

---

## 14. Technical Considerations

### 14.1 Performance

**Graph rendering:**
- Lazy load with dynamic import (already implemented)
- Render on idle (requestIdleCallback)
- Limit nodes on mobile (< 100 visible)

**Search:**
- Debounce at 150ms
- Cache recent searches
- FTS5 indexes already exist

**Dashboard queries:**
- Parallel queries (Promise.all)
- Server-side rendering where possible
- React Query caching (5min staleTime)

### 14.2 Accessibility

**Keyboard navigation:**
- Tab order logical
- All actions keyboard-accessible
- Focus indicators visible

**Screen readers:**
- Semantic HTML
- ARIA labels on icons
- Status announcements

**Mobile:**
- Touch targets 44x44px minimum
- Swipe gestures have fallback tap actions
- No gesture-only interactions

### 14.3 Progressive Enhancement

**Core features work without JS:**
- Navigation (SSR links)
- Note viewing
- Basic search

**Enhanced with JS:**
- Command palette
- Real-time search
- Graph visualization
- Voice capture

---

## 15. Open Questions

1. **Graph performance:** With 1000+ notes, should we add pagination/filtering to graph?
   - **Answer:** Add "Show: Last 50 | 100 | 200 | All" filter

2. **Insights generation:** Should insights auto-generate daily or on-demand?
   - **Answer:** Hybrid - auto-generate in background queue, manual trigger available

3. **Weekly review timing:** Generate on Sunday night or Monday morning?
   - **Answer:** User configurable in settings (default: Sunday 8pm)

4. **Mobile graph gestures:** Pinch-to-zoom or button controls only?
   - **Answer:** Both - pinch-to-zoom + button controls for accessibility

5. **Attachment preview:** In-app viewer or always open in new tab?
   - **Answer:** In-app for images/PDFs, new tab for downloads

---

## 16. Future Enhancements (Post-MVP)

### 16.1 Dashboard Customization

- Widget system (drag-drop layout)
- Hide/show sections
- Custom time ranges for stats
- Theme/color customization

### 16.2 Advanced Filters

- Saved search queries
- Complex filter combinations
- Smart folders (auto-updating filters)

### 16.3 Collaboration

- Shared notes/projects
- Commenting
- Real-time collaboration

### 16.4 AI Enhancements

- Auto-organize captures
- Smart daily note templates
- Predictive insights
- Natural language search

---

## 17. Conclusion

This redesign transforms Brain Portal from a feature-rich but navigation-heavy app into a streamlined, mobile-first knowledge management system optimized for rapid capture and processing.

**Key Wins:**
- 60% reduction in top-level navigation items
- Unified processing workflow (Inbox)
- Always-accessible search and voice
- Visual knowledge exploration on dashboard
- Zero learning curve (intuitive UX)

**No Breaking Changes:**
- No database migrations
- No API changes
- All existing data works as-is
- Can implement incrementally if needed

**Ready for Implementation:** ✅

All design decisions are validated against the existing codebase. All necessary infrastructure exists. Implementation is primarily UI/UX reorganization with no risky database or API changes.

---

## Appendix A: File Structure Changes

### New Files
```
src/components/layout/search-header.tsx
src/components/dashboard/insights-feed.tsx
src/components/dashboard/weekly-summary.tsx
src/components/dashboard/action-bar.tsx
src/components/inbox/capture-card.tsx
src/components/inbox/insight-card.tsx
src/components/inbox/swipe-actions.tsx
src/components/notes/filter-chips.tsx
```

### Modified Files
```
src/lib/navigation.ts
src/components/layout/sidebar.tsx
src/components/layout/mobile-nav.tsx
src/app/(dashboard)/layout.tsx
src/app/(dashboard)/page.tsx
src/app/(dashboard)/inbox/page.tsx
src/app/(dashboard)/notes/page.tsx
```

### Deleted Files
```
src/app/(dashboard)/graph/page.tsx
src/app/(dashboard)/weekly/page.tsx
src/app/(dashboard)/captures/page.tsx
src/app/(dashboard)/insights/page.tsx
src/app/(dashboard)/attachments/page.tsx
src/app/(dashboard)/daily/page.tsx
```

---

## Appendix B: Component Reuse Matrix

| Old Component | New Location | Changes |
|--------------|--------------|---------|
| KnowledgeGraph | Dashboard embed | Height: 60vh (mobile), 50vh (desktop) |
| CommandPalette | Header (unchanged) | Add voice button integration |
| VoiceCommands | Header (unchanged) | None |
| SearchPage | Search Header | Extract search bar, keep page for "See all" |
| AttachmentsWidget | Dashboard (optional) | Collapsible panel |
| WeeklyReviewsAPI | Dashboard | Display current week summary |
| InsightsAPI | Inbox + Dashboard | Feed view |

---

**End of Design Document**
