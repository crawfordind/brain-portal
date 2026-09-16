# Unified Task & AI Agent System Design

**Date:** 2026-02-02
**Status:** Approved
**Goal:** Integrate AI agents with the tasks system so users can delegate tasks to AI agents and convert responses to notes

---

## Overview

Transform the tasks and AI agents from separate systems into one unified, intuitive workflow where:
- Tasks page = searchable repository of all tasks (user + AI-delegated)
- Inbox = personal tasks assigned to the user
- Users can delegate tasks in-place to AI agents
- AI responses can be converted to notes with full context preservation

---

## User Workflows

### Workflow 1: Simple Task (Unchanged)
1. User types "Buy milk" in quick-add input
2. Task created with just title
3. Shows in inbox, marked as user's task

### Workflow 2: Detailed Task
1. User clicks "+" to open full form
2. Fills: Title, Description (optional), Project, Priority
3. Task created with context
4. Shows in inbox

### Workflow 3: Delegate to AI Agent
1. User has task: "Research competitors for Q2 strategy"
2. Clicks "Delegate to AI" button
3. Modal opens with:
   - Agent selection grid (Researcher agent makes sense)
   - Editable instructions (pre-filled with task description)
   - Advanced options: link reference notes, set priority/format
4. System automatically finds related notes via embeddings
5. Submits → task status changes to "processing"
6. Task stays in list with AI agent badge
7. When complete → status "awaiting_review"
8. User reviews output, approves/revises/rejects

### Workflow 4: Convert AI Output to Note
1. User reviews approved AI task output
2. Clicks "Save as Note"
3. Preview modal shows formatted note with:
   - AI output as main content
   - Original request as context
   - Metadata (agent, model, timestamp)
   - Links to reference notes used
4. User edits if needed, chooses project/tags
5. Saves → note created with full provenance
6. Task links to note for future reference

---

## Architecture

### Database Schema Changes

**Tasks Table Enhancement (Backward Compatible):**
```sql
-- Migration 1: Add new columns
ALTER TABLE tasks ADD COLUMN title TEXT;
ALTER TABLE tasks ADD COLUMN description TEXT;
ALTER TABLE tasks ADD COLUMN delegated_to TEXT; -- null or agent_type
ALTER TABLE tasks ADD COLUMN agent_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN linked_note_ids TEXT DEFAULT '[]';

-- Migration 2: Backfill existing tasks
UPDATE tasks SET title = content WHERE title IS NULL;

-- Migration 3: Add index for delegated tasks
CREATE INDEX IF NOT EXISTS idx_tasks_delegated ON tasks(delegated_to) WHERE delegated_to IS NOT NULL;
```

**Field Descriptions:**
- `title`: Task summary (required, backward compat with old `content`)
- `description`: Detailed context (optional, for complex tasks)
- `content`: Keep for backward compatibility, but deprecated
- `delegated_to`: null = user task, 'code'/'copy'/etc = AI agent type
- `agent_task_id`: Links to agent_tasks record when delegated
- `linked_note_ids`: JSON array of note IDs for AI context

**Agent Tasks Enhancement:**
```sql
ALTER TABLE agent_tasks ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_task ON agent_tasks(task_id);
```

**Bidirectional Linking:**
- `tasks.agent_task_id` → `agent_tasks.id` (task knows its agent task)
- `agent_tasks.task_id` → `tasks.id` (agent task knows source task)
- Enables status sync and data integrity

---

## Component Design

### 1. Enhanced Task Item Component

**Display Logic:**
```typescript
// User task (delegated_to = null)
┌─────────────────────────────────────┐
│ ☐ Buy milk                          │
│   📁 Personal · 🔴 High            │
└─────────────────────────────────────┘

// AI-delegated task (delegated_to = 'research')
┌─────────────────────────────────────┐
│ ☐ Research competitors              │
│   🔍 Researcher · ⏳ Processing    │
│   📁 Work · 🟡 Medium              │
└─────────────────────────────────────┘

// Completed AI task
┌─────────────────────────────────────┐
│ ☑ Research competitors              │
│   🔍 Researcher · ✅ Awaiting Review│
│   [Review Output] [Save as Note]    │
└─────────────────────────────────────┘
```

**Actions on Hover/Click:**
- User tasks: Edit, Complete, Delete, **Delegate to AI**
- AI tasks (processing): View status, Cancel
- AI tasks (complete): Review, Save as Note, Revise

### 2. Task Delegation Modal

**Mobile:** Sheet from bottom (85vh)
**Desktop:** Dialog (max-w-2xl)

**Layout:**
```
┌────────────────────────────────────┐
│ Delegate to AI Agent            [×]│
├────────────────────────────────────┤
│                                    │
│ Select Agent (Required)            │
│ ┌────┐ ┌────┐ ┌────┐              │
│ │ 💻 │ │ ✍️ │ │ 🔍 │              │
│ │Dev │ │Copy│ │Res │              │
│ └────┘ └────┘ └────┘              │
│ ┌────┐ ┌────┐ ┌────┐              │
│ │ 📈 │ │ 📊 │ │ 🤖 │              │
│ │Mkt │ │Anl │ │Gen │              │
│ └────┘ └────┘ └────┘              │
│                                    │
│ Task Instructions                  │
│ ┌──────────────────────────────┐  │
│ │ Research our top 5           │  │
│ │ competitors and analyze      │  │
│ │ their pricing strategies     │  │
│ └──────────────────────────────┘  │
│                                    │
│ ▼ Advanced Options                │
│   Link Notes: [Select notes...]   │
│   Priority: Medium ▼               │
│   Format: Markdown ▼               │
│                                    │
│ ℹ️  AI will also use embeddings to│
│    find relevant context           │
│                                    │
├────────────────────────────────────┤
│          [Cancel]  [Delegate]      │
└────────────────────────────────────┘
```

### 3. Save as Note Modal

```
┌────────────────────────────────────┐
│ Save AI Output as Note          [×]│
├────────────────────────────────────┤
│                                    │
│ Title                              │
│ [Competitor Analysis Q2 2026]      │
│                                    │
│ Preview                            │
│ ┌──────────────────────────────┐  │
│ │ # Competitor Analysis Q2     │  │
│ │                              │  │
│ │ ## AI Output                 │  │
│ │ Our top 5 competitors are... │  │
│ │                              │  │
│ │ ---                          │  │
│ │ ## Original Request          │  │
│ │ > Research our top 5...      │  │
│ │                              │  │
│ │ ## Context Used              │  │
│ │ - Agent: Researcher          │  │
│ │ - Model: grok-4.1-fast       │  │
│ │ - Linked: [[Q1 Report]]      │  │
│ └──────────────────────────────┘  │
│                                    │
│ Project: Work ▼                    │
│ Tags: [competitors] [research]     │
│                                    │
├────────────────────────────────────┤
│          [Cancel]  [Save Note]     │
└────────────────────────────────────┘
```

---

## AI Context Building

When a task is delegated, the system assembles comprehensive context:

### 1. Explicit Context (User-Provided)
- Task title + description (editable prompt)
- Linked notes (user-selected)
- Project information (name, description)
- Task priority (signals urgency to AI)

### 2. Automatic Context (Embeddings)
```typescript
async function buildTaskContext(taskId: string) {
  const task = await getTask(taskId);

  // Get explicitly linked notes
  const linkedNotes = await getNotesByIds(task.linked_note_ids);

  // Find similar notes via embeddings
  const similarNotes = await findSimilarNotes(
    task.user_id,
    task.description || task.title,
    limit: 5,
    threshold: 0.7
  );

  // Exclude duplicates
  const relevantNotes = similarNotes.filter(
    n => !task.linked_note_ids.includes(n.id)
  );

  // Get project context if applicable
  const projectContext = task.project_id
    ? await getProjectWithRecentNotes(task.project_id)
    : null;

  return {
    explicitNotes: linkedNotes,
    relevantNotes,
    projectContext,
  };
}
```

### 3. Context Formatting for AI
```
<task>
Title: {task.title}
Requirements: {task.description}
Priority: {task.priority}
</task>

<explicitly_linked_notes>
### {note.title}
{note.content}
</explicitly_linked_notes>

<relevant_context>
[Auto-retrieved via embeddings, similarity > 70%]
### {note.title} (similarity: 85%)
{note.content}
</relevant_context>

<project_context>
Project: {project.name}
{project.description}
Recent activity: [summary]
</project_context>
```

---

## API Routes

### New/Modified Endpoints

**Tasks API Enhancement:**
```typescript
// PATCH /api/tasks/[id]/delegate
// Delegates task to AI agent
{
  agentType: 'research',
  instructions: 'editable prompt',
  linkedNoteIds: ['note1', 'note2'],
  priority: 'high',
  outputFormat: 'markdown'
}

// POST /api/tasks/[id]/save-as-note
// Converts agent output to note
{
  title: 'Note title',
  editedContent?: 'optional edited output',
  projectId?: 'project-id',
  tags: ['tag1', 'tag2']
}
```

**Status Sync:**
```typescript
// When agent_task status changes
agent_task.status = 'awaiting_review'
→ task.status = 'in_progress' (AI working on it)

agent_task.status = 'approved'
→ task.status = 'completed'

agent_task.status = 'failed'
→ task.status = 'pending' (returns to user)
```

---

## Data Flow Diagrams

### Task Delegation Flow
```
User Task (pending)
    ↓ [User clicks "Delegate to AI"]
    ↓
Delegation Modal
    ↓ [Select agent, edit instructions]
    ↓
Create agent_task record
    ↓
task.delegated_to = agent_type
task.agent_task_id = new_agent_task.id
    ↓
Build context (linked notes + embeddings)
    ↓
Execute agent task
    ↓
task.status = 'in_progress' (synced)
    ↓
Agent generates output
    ↓
task.status = 'awaiting_review'
    ↓
User reviews in task list
    ↓ [Approve]
    ↓
task.status = 'completed'
```

### Save as Note Flow
```
Completed AI Task
    ↓ [User clicks "Save as Note"]
    ↓
Load agent_task output
    ↓
Format note content:
  - AI output
  - Original request
  - Metadata (agent, model, time)
  - Links to reference notes
    ↓
Preview Modal
    ↓ [User edits, sets project/tags]
    ↓
Create note record
    ↓
note.content = formatted_content
note.project_id = task.project_id
note.tags = auto + manual tags
note.metadata = {
  source: 'ai_task',
  task_id: task.id,
  agent_type: agent_type,
  model: model_used
}
    ↓
Link back: task.note_id = new_note.id
    ↓
Toast: "Note created" + link
```

---

## UI/UX Considerations

### Mobile Optimization
- **Task list:** Swipe actions for quick delegate/complete
- **Delegation modal:** Sheet from bottom, scrollable, collapsible sections
- **Agent grid:** 2 columns on mobile, 3 on tablet+
- **Save as note:** Sheet with sticky footer buttons

### Keyboard Shortcuts
- `d` - Delegate selected task to AI
- `s` - Save AI output as note (when reviewing)
- `r` - Request revision (when reviewing)
- `a` - Approve AI output

### Loading States
- Task item shows spinner when AI processing
- Real-time status updates via polling (5s interval)
- Toast notifications for status changes

### Error Handling
- If agent task fails → task returns to pending with error message
- If embeddings unavailable → still delegate with explicit context only
- If save-as-note fails → show error, preserve output, allow retry

---

## Testing Strategy

### Unit Tests
- Task schema migration (backward compatibility)
- Context builder (embeddings + linked notes)
- Status sync logic (task ↔ agent_task)
- Note formatting with metadata

### Integration Tests
- Full delegation flow (task → agent_task → output)
- Save as note with all metadata
- Bidirectional task linking
- Status updates across systems

### E2E Tests (Manual)
1. Create simple task → delegate → review → approve
2. Create detailed task with linked notes → delegate → verify context used
3. Complete AI task → save as note → verify formatting
4. Request revision → verify new version created
5. Mobile: test sheet modals, swipe actions

---

## Migration Plan

### Phase 1: Schema Migration
1. Add new columns to tasks table
2. Backfill existing tasks (content → title)
3. Add indexes
4. Deploy without UI changes (backward compatible)

### Phase 2: API Updates
1. Add PATCH /api/tasks/[id]/delegate
2. Add POST /api/tasks/[id]/save-as-note
3. Implement status sync logic
4. Deploy API changes

### Phase 3: UI Components
1. Update task item component (delegate button)
2. Build delegation modal (reuse agent components)
3. Build save-as-note modal
4. Update task list to show AI status

### Phase 4: Context Engine
1. Enhance buildTaskContext in agents/context.ts
2. Add project context retrieval
3. Update agent executor to use enhanced context

### Phase 5: Testing & Polish
1. Run integration tests
2. Test mobile responsiveness
3. Add keyboard shortcuts
4. Polish loading states

---

## Success Metrics

- Tasks can be delegated to AI agents in < 5 clicks
- AI tasks show clear status at all times
- Context preservation: 100% of linked notes appear in generated output
- Note conversion: < 3 clicks from AI output to saved note
- Mobile UX: All features accessible on mobile without desktop
- Zero data loss in migration (all existing tasks preserved)

---

## Future Enhancements (Out of Scope)

- Bulk delegate multiple tasks
- AI task templates (saved prompts)
- Task chaining (AI output → new task)
- Agent performance analytics
- Custom agent creation
- Voice input for task delegation
