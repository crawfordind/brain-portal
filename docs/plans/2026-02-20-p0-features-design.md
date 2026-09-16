# P0 Features Design: Context Briefcase + Recurring Tasks
> Date: 2026-02-20
> Status: Approved

---

## Overview

Two P0 items from the product roadmap:

1. **Context Briefcase** — Show users what context was sent to the AI agent after a task runs, expanded by default in the review panel.
2. **Recurring Tasks** — Full RRULE-based recurrence for tasks, creating a new task instance on completion.

---

## Feature 1: Context Briefcase

### Problem

`buildTaskContext()` in `src/lib/agents/context.ts` auto-retrieves up to 3 semantically similar notes via embeddings and injects them silently into the LLM prompt. These notes are never persisted — they vanish after `executor.ts` formats them into the prompt string. The review panel (`agent-review-focus-panel.tsx`) only surfaces the raw prompt text, collapsed by default. Users have no visibility into what context influenced the AI's output.

### Decision

Post-run visibility in `AgentReviewFocusPanel`, expanded by default. No pre-run editing.

### Architecture

#### 1. DB Migration
File: `scripts/migrate-add-agent-context-used.ts`

Add one nullable column to `agent_tasks`:
```sql
ALTER TABLE agent_tasks ADD COLUMN context_used TEXT DEFAULT '[]';
```

Stores a JSON array of auto-retrieved notes:
```json
[{"id": "abc", "title": "My Note", "similarity": 0.89}]
```

Manually pinned notes remain in the existing `context_note_ids` column.

#### 2. Executor Update
File: `src/lib/agents/executor.ts`

After `buildTaskContext()` resolves and before calling the LLM, persist `context.relevantNotes` to the `context_used` column:
```sql
UPDATE agent_tasks SET context_used = ? WHERE id = ?
```

#### 3. Review Panel UI
File: `src/components/agents/agent-review-focus-panel.tsx`

Replace the collapsed "View Original Prompt" toggle with a structured "Context Used" section, expanded by default:

```
┌─ Context Used ──────────────────────────────────┐
│ 📌 Your notes:   [Marketing Plan] [Brand Guide]  │
│ 🔍 Auto-found:   [Note A  89%]  [Note B  74%]   │
└─────────────────────────────────────────────────┘
```

- Note titles link to `/notes/[slug]`
- Section is collapsible but open by default
- If no context was used, section is hidden
- Auto-found notes show similarity percentage

No new API endpoints needed — `GET /api/agent-tasks/[id]` already returns the full task row; `context_used` will be included automatically once the column exists.

Also update `GET /api/agent-tasks/[id]` to resolve note titles for `context_note_ids` (currently only stored as IDs). Join with `notes` table to return `{id, title, slug}` for each manually pinned note.

### Files Changed
- `scripts/migrate-add-agent-context-used.ts` — new migration
- `src/lib/agents/executor.ts` — persist context after build
- `src/app/api/agent-tasks/[id]/route.ts` — resolve note titles for context_note_ids
- `src/components/agents/agent-review-focus-panel.tsx` — Context Used section

---

## Feature 2: Recurring Tasks

### Problem

The `tasks` table has no recurrence fields. Recurring tasks are table-stakes for any productivity tool — their absence is a P0 gap.

### Decisions

- **Recurrence standard**: Full RRULE (RFC 5545) via the `rrule` npm package
- **On completion**: Create a new task instance with the next occurrence date; preserve the completed task for history
- **Recurrence chain**: `parent_task_id` links each new instance back to the task it was spawned from

### Architecture

#### 1. DB Migration
File: `scripts/migrate-add-recurrence.ts`

Three nullable `ALTER TABLE` additions (safe — no rename needed):
```sql
ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
-- e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"

ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT;
-- ISO date string, null = repeat indefinitely

ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
-- links each spawned instance back to the task it was created from
```

#### 2. Install rrule
```bash
npm install rrule
```

#### 3. Completion Hook
File: `src/app/api/tasks/[id]/route.ts` — PUT handler

When `body.status === 'completed'` and `existing.recurrence_rule` is set:
1. Mark current task complete (existing behavior unchanged)
2. Compute next occurrence:
   ```ts
   import { RRule } from 'rrule';
   const rule = RRule.fromString('RRULE:' + existing.recurrence_rule);
   const next = rule.after(new Date());
   ```
3. If `next` exists and is before `recurrence_end_date` (or no end date):
   - Insert new task copying: `content`, `priority`, `project_id`, `note_id`, `tags`, `recurrence_rule`, `recurrence_end_date`
   - Set `due_date` = `next.toISOString().split('T')[0]`
   - Set `parent_task_id` = current task `id`
   - Set `status` = `'pending'`

#### 4. Recurrence Picker Component
File: `src/components/tasks/recurrence-picker.tsx`

Reusable controlled component accepting `value: string | null` and `onChange: (rule: string | null) => void`.

Preset modes:
| Mode | RRULE output |
|---|---|
| None | `null` |
| Daily | `FREQ=DAILY` |
| Every N days | `FREQ=DAILY;INTERVAL=N` |
| Weekly (day picker) | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| Monthly (on day X) | `FREQ=MONTHLY;BYMONTHDAY=15` |
| Custom | Raw text input |

Human-readable preview rendered via `rule.toText()` from the `rrule` package:
> "every Monday and Wednesday"

Optional end date picker: ISO date input, stored as `recurrenceEndDate`.

#### 5. Wire into Dialogs
Files: `src/components/tasks/task-create-dialog.tsx`, `src/components/tasks/task-edit-dialog.tsx`

- Add `RecurrencePicker` in the advanced options section of both dialogs
- Add `recurrenceRule` and `recurrenceEndDate` to the form state
- Include both in the POST/PUT payload
- The PUT route reads and persists both fields

#### 6. API Route Updates
File: `src/app/api/tasks/route.ts` (POST) and `src/app/api/tasks/[id]/route.ts` (PUT)

Handle two new body fields:
- `recurrenceRule: string | null`
- `recurrenceEndDate: string | null`

#### 7. Visual Indicator
Files: `src/components/tasks/task-card.tsx`, `src/components/tasks/task-detail-panel.tsx`

Show a small `↻` (repeat) icon badge when `recurrence_rule` is non-null. On the detail panel, show the human-readable recurrence text.

### Files Changed
- `scripts/migrate-add-recurrence.ts` — new migration
- `package.json` — add `rrule` dependency
- `src/app/api/tasks/[id]/route.ts` — completion hook + new fields
- `src/app/api/tasks/route.ts` — new fields on create
- `src/components/tasks/recurrence-picker.tsx` — new component
- `src/components/tasks/task-create-dialog.tsx` — wire in picker
- `src/components/tasks/task-edit-dialog.tsx` — wire in picker
- `src/components/tasks/task-card.tsx` — repeat icon
- `src/components/tasks/task-detail-panel.tsx` — recurrence display

---

## Implementation Order

1. Context Briefcase (smaller surface area, pure addition)
   - Migration → executor → API → UI

2. Recurring Tasks (larger, touches more files)
   - Migration → install rrule → completion hook → picker component → wire into dialogs → visual indicators

---

## Out of Scope

- Pre-run context editing (deferred — user chose post-run only)
- Recurrence skip/pause controls
- Recurrence count limit (RRULE `COUNT` param)
- Calendar view integration for recurring tasks (separate concern)
