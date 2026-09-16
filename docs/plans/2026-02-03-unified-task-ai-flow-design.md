# Unified Task & AI Agent Flow - Design Document

**Date:** 2026-02-03
**Status:** Approved
**Goal:** Merge tasks and AI agents into one unified flow where "AI is a team member" you assign work to

## Problem Statement

Current system has two separate mental models and entry points:

1. **`/tasks` page** - "My work" with hidden delegate button
2. **`/agents` page** - "AI work queue" with separate creation

**User Confusion:**
- "Is this for me or AI?" (decision before creating)
- "Where do I create this?" (two entry points)
- "Where's my AI work?" (split between two pages)
- "How do I check AI progress?" (separate queue)

**Cognitive overhead:** Users must learn two systems for one goal: getting work done.

## Design Principle

**"AI as Team Member"** - One task list, different assignees (You, Writer, Dev, Researcher, etc.)

Like Asana or Linear with bot teammates. Everything is a task. Who does it is just an assignment.

## Solution Overview

### Single Unified Flow

**One Task Page:** All work lives in `/tasks`, filtered by assignee

**Smart Assignment:** System detects what type of work it is, suggests assignee

**Seamless Handoff:** Assign to AI → AI works → You review → Complete

### Key UX Improvements

1. **Smart Assign (Default)** - Auto-detect agent from task text, user can override
2. **Single Entry Point** - One "New Task" button, assignment happens inside
3. **Unified Filtering** - "Show: My Tasks | AI Tasks | All | By Agent"
4. **Progressive Disclosure** - Advanced options hidden by default
5. **Non-Breaking** - Existing `/agents` page continues to work

## User Flows

### Flow 1: Create Task with Smart Assignment

```
1. Click "+ New Task"
2. Type: "Write a blog post about AI productivity"
3. System detects: "🤖 Smart Assign → Writer Agent (Recommended)"
4. Click "Create Task"
5. Done! AI starts working automatically
```

**User decisions:** 1 (what needs done)
**System handles:** Agent selection, execution, status tracking

### Flow 2: Create Task for Yourself

```
1. Click "+ New Task"
2. Type: "Call dentist to schedule appointment"
3. System detects: No AI match → "Assigned to: You"
4. Click "Create Task"
5. Task appears in your list
```

**Fallback to human:** System knows when AI isn't appropriate

### Flow 3: Manually Choose Agent

```
1. Click "+ New Task"
2. Type: "Research competitor pricing models"
3. Click "AI Agent" tab (override smart assign)
4. Select "🔍 Researcher"
5. Click "Create Task"
6. AI starts working
```

**Power user option:** Full control when needed

## Component Architecture

### Enhanced Task Creation Dialog

**Before (Current):**
```
┌─ New Task ─────────────┐
│ Content: [____]        │
│ Priority: [___]        │
│ Project: [___]         │
│ Due Date: [___]        │
│ [Cancel] [Create]      │
└────────────────────────┘
```

**After (Unified):**
```
┌─ New Task ─────────────────────────────────┐
│ What needs to be done?                     │
│ [Text area with content]                   │
│                                            │
│ Assign to:                                 │
│ [🤖 Smart Assign] [👤 Me] [🤖 AI Agent]   │
│                                            │
│ 📝 Writer Agent (Recommended)              │
│ Detected: content creation                 │
│                                            │
│ [More Options ▼]                           │
│                                            │
│ [Cancel]              [Create Task →]      │
└────────────────────────────────────────────┘
```

**Progressive Disclosure:**
- Smart assign by default
- Agent selection on demand
- Advanced options collapsed
- No cognitive overhead

### Smart Agent Detection

**Keyword-based inference:**

```javascript
function detectAgentFromText(text: string): string | null {
  const lower = text.toLowerCase();

  // Writing: write, blog, article, post, content, draft, email
  if (/(write|blog|article|post|content|copy|email|draft)/.test(lower)) {
    return 'copy'; // Writer
  }

  // Development: code, bug, fix, implement, debug, feature, api
  if (/(code|bug|fix|implement|debug|function|api|feature)/.test(lower)) {
    return 'code'; // Dev
  }

  // Research: research, find, analyze, investigate, study, compare
  if (/(research|find|analyze|investigate|study|compare)/.test(lower)) {
    return 'research'; // Researcher
  }

  // Marketing: market, campaign, ad, seo, conversion, landing
  if (/(market|campaign|ad|promotion|seo|conversion|landing)/.test(lower)) {
    return 'marketing'; // Marketer
  }

  // Analytics: analyze, metrics, insights, report, dashboard, kpi
  if (/(analyze|metrics|insights|report|dashboard|kpi)/.test(lower)) {
    return 'analyst'; // Analyst
  }

  return null; // No match = assign to user
}
```

**Simple, fast, good enough.** Can be enhanced with ML later.

### Task List with Assignee Filter

**Before (Current):**
```
Tasks
Filters: [Open] [Completed] [All] | [Project: All ▼]
```

**After (Unified):**
```
Tasks
Filters: [Open] [Completed] [All] | [Project: All ▼] | [Assignee: All ▼]
                                                        ├─ My Tasks (47)
                                                        ├─ AI Tasks (12)
                                                        ├─ Unassigned (3)
                                                        └─ By Agent:
                                                            ├─ 📝 Writer (5)
                                                            ├─ 💻 Dev (4)
                                                            └─ 🔍 Researcher (3)
```

**Visual indicators on task cards:**
```
┌──────────────────────────────────────────────┐
│ ○ Write blog post about AI agents           │
│   📝 Writer Agent  ⏳ Awaiting Review        │
│   [Review Output →]                          │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ ○ Research competitor pricing                │
│   👤 Me  📋 To Do                             │
└──────────────────────────────────────────────┘
```

**Clear ownership:** Always know who's working on what

## Implementation Details

### Database (No Changes Needed!)

Existing schema already supports this:

```sql
-- tasks table already has:
delegated_to TEXT,           -- NULL = user, 'code' = dev agent, etc.
agent_task_id TEXT,          -- Link to agent_tasks
status TEXT,                 -- pending, in_progress, completed

-- agent_tasks table already has:
task_id TEXT,                -- Bidirectional link
status TEXT,                 -- queued, processing, awaiting_review, etc.
```

**No migrations required.** Pure UX enhancement.

### API Changes

**`POST /api/tasks`** - Enhanced to support AI assignment:

```json
{
  "content": "Write a blog post about AI",
  "priority": "medium",
  "delegatedTo": "copy",      // NEW: Agent type or null
  "autoExecute": true         // NEW: Auto-start agent work
}
```

**Logic:**
1. Create task record
2. If `delegatedTo` is set:
   - Create `agent_task` record
   - Link bidirectionally
   - Set task status to `in_progress`
   - Agent picks it up from queue

**`GET /api/tasks`** - Enhanced filters:

```
/api/tasks?delegatedTo=null      // My tasks only
/api/tasks?delegatedTo=copy      // Writer agent tasks
/api/tasks?hasAgent=true         // All AI tasks
```

**Backward compatible:** Existing queries still work

### Component Changes

**1. Task Create Dialog** (`src/components/tasks/task-create-dialog.tsx`)
- Add assignment mode selector
- Add smart detection with preview
- Add agent grid (when manual selection)
- Collapse advanced options by default
- Submit with `delegatedTo` field

**2. Tasks Page** (`src/app/(dashboard)/tasks/page.tsx`)
- Add assignee filter dropdown
- Show agent badges on task cards
- Show "Review Output" for AI tasks awaiting review
- No other changes (all existing features preserved)

**3. Task Edit Dialog** (`src/components/tasks/task-edit-dialog.tsx`)
- Show current assignment
- Add "Reassign" capability
- Support unassigning from AI (back to user)

**4. API Route** (`src/app/api/tasks/route.ts`)
- Accept `delegatedTo` and `autoExecute` in POST
- Auto-create `agent_task` when assigned to AI
- Support assignee filters in GET
- Return agent status in task responses

**5. Agents Page** (`src/app/(dashboard)/agents/page.tsx`)
- No breaking changes
- Optionally add link: "View in Tasks"
- Continues to work as dedicated AI queue

## Progressive Enhancement Path

**Phase 1: Core Unified Flow (This Design)**
- ✅ Smart assignment in task creation
- ✅ Assignee filtering
- ✅ Auto-create agent tasks
- ✅ Unified task list

**Phase 2: Enhanced Intelligence**
- Learn from user overrides (ML model)
- Context-aware suggestions (link related notes)
- Confidence scoring ("80% sure this is for Writer")
- Multi-agent suggestions ("Writer OR Researcher?")

**Phase 3: Advanced Collaboration**
- Task handoffs (AI → Human → AI)
- Parallel assignment (both work on it)
- Team members (real humans as assignees)
- Approval workflows

## Success Metrics

**Simplicity:**
- ✅ Single entry point for all task creation
- ✅ One decision: "What needs done?"
- ✅ System handles assignment (90% accuracy target)

**Discoverability:**
- ✅ AI capabilities visible inline
- ✅ Smart suggestions teach users
- ✅ No need to learn two systems

**Efficiency:**
- ✅ 5 clicks → 2 clicks for AI tasks
- ✅ Zero mental overhead on agent selection
- ✅ Instant feedback on assignment

**Flexibility:**
- ✅ Power users can override
- ✅ All existing features preserved
- ✅ Both flows work simultaneously

## Non-Breaking Changes

**What Stays:**
- ✅ `/agents` page (alternative view)
- ✅ Manual delegate button (backup flow)
- ✅ All existing API endpoints
- ✅ All existing UI components
- ✅ Database schema unchanged

**What's Added:**
- ✅ Smart assignment option
- ✅ Assignee filter
- ✅ Agent detection logic
- ✅ Enhanced task creation
- ✅ Auto-execution on assignment

**Migration Path:**
- No data migration needed
- No breaking changes
- Deploy incrementally
- Users discover gradually

## Edge Cases & Handling

**1. Detection Ambiguity**
- Input: "Research and write about AI"
- Detection: Multiple matches (research + write)
- Handling: Pick first match, show override option
- UI: "Detected: Writer (override to Researcher?)"

**2. No Clear Match**
- Input: "Call dentist"
- Detection: No AI keywords
- Handling: Default to "Me"
- UI: "Assigned to: You (or delegate to Assistant?)"

**3. User Override Pattern**
- System: Suggests Writer
- User: Selects Researcher (3x in a row)
- Learning: Next time, suggest Researcher
- Implementation: Track override history (Phase 2)

**4. Task Too Vague**
- Input: "Do the thing"
- Detection: No context
- Handling: Require more detail or default to user
- UI: "Add more details for smart assignment"

**5. AI Assignment After Creation**
- User creates task, assigns to self
- Later: Clicks "Delegate to AI"
- Handling: Opens agent selector, creates link
- Status: Task moves to "in_progress"

## Implementation Plan

### Phase 1: Foundation (2-3 hours)
1. Add smart detection function
2. Enhance task creation dialog UI
3. Update task creation API
4. Test basic flow

### Phase 2: Filtering & Display (1-2 hours)
1. Add assignee filter to tasks page
2. Enhance task card display
3. Update API query filtering
4. Test filter combinations

### Phase 3: Edit & Reassignment (1 hour)
1. Add reassignment to edit dialog
2. Handle unassignment flow
3. Update task status sync
4. Test edge cases

### Phase 4: Polish & Testing (1-2 hours)
1. Add loading states
2. Improve detection accuracy
3. Add keyboard shortcuts
4. Cross-browser testing
5. Mobile responsiveness

**Total Estimate:** 5-8 hours for complete implementation

## Future Enhancements

**Machine Learning Detection:**
- Train on user override patterns
- Improve accuracy over time
- Multi-label classification
- Confidence scores

**Context-Aware Suggestions:**
- "This is similar to 3 tasks you assigned to Writer"
- "Last time you researched X, you used Researcher"
- "Based on linked notes, this seems like Dev work"

**Bulk Operations:**
- Select multiple tasks
- "Assign all to Writer"
- "Review all AI outputs"

**Agent Collaboration:**
- "Researcher finds info → Writer creates content"
- Sequential handoffs
- Parallel processing

**Analytics Dashboard:**
- "You've delegated 47% of tasks to AI"
- "Writer agent saves you 5 hours/week"
- "Most common: content creation → Writer"

## Rollback Plan

If issues arise:

**Immediate:**
- Remove assignee filter from UI
- Disable smart assignment in creation
- Users fall back to manual delegate button
- `/agents` page still fully functional

**Partial:**
- Keep unified view, disable auto-detection
- Manual assignment only
- Gradual rollout per user

**Full:**
- Revert all changes
- Existing flows unaffected
- No data loss (schema unchanged)

## Open Questions (Resolved)

**Q: Should we delete the `/agents` page?**
A: No. Keep it as alternative view. Some users prefer dedicated queues.

**Q: What if detection is wrong?**
A: Show the suggestion, always allow override. Learn from corrections (Phase 2).

**Q: What about human team members?**
A: Future phase. Architecture supports it (assignee is just a string).

**Q: How to handle failed AI tasks?**
A: Status syncs to task. User sees "Failed", can retry or reassign to self.

**Q: What about task templates?**
A: Compatible. Template can include `delegatedTo` field.

## Conclusion

**The Big Idea:**
Replace "Where do I go?" with "What needs done?"

**The Implementation:**
Enhance existing system without breaking anything.

**The Result:**
Genius-level intelligence, zero-level complexity.

Users think: "I have work."
System thinks: "Who should do it?"
AI handles the rest.

---

*"The best interface is no interface. The second best is one that feels like mind-reading."*
