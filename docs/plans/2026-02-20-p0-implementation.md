# P0 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Context Briefcase (post-run agent context visibility in review panel) and Recurring Tasks (RRULE-based, creates new task instance on completion).

**Architecture:** Context Briefcase adds a `context_used` column to `agent_tasks`, persists auto-retrieved notes in the executor, and renders them in the review panel. Recurring Tasks adds three columns to `tasks`, hooks into the PUT completion handler to spawn the next occurrence, and adds a `RecurrencePicker` component wired into both task dialogs.

**Tech Stack:** Next.js App Router, Turso/libSQL, Vitest, React Query, `rrule` npm package, Tailwind + shadcn/ui

---

## Feature 1: Context Briefcase

### Task 1: DB Migration — add `context_used` to `agent_tasks`

**Files:**
- Create: `scripts/migrate-add-agent-context-used.ts`

**Step 1: Create the migration script**

```ts
// scripts/migrate-add-agent-context-used.ts
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding context_used column to agent_tasks...");

  try {
    await db.execute(
      `ALTER TABLE agent_tasks ADD COLUMN context_used TEXT DEFAULT '[]'`
    );
    console.log("✅ Done: agent_tasks.context_used added");
  } catch (error: any) {
    if (error.message?.includes("duplicate column")) {
      console.log("✅ Column already exists, skipping");
    } else {
      console.error("❌ Migration failed:", error);
      process.exit(1);
    }
  }

  await db.close();
}

migrate().catch(console.error);
```

**Step 2: Run the migration**

```bash
npx tsx scripts/migrate-add-agent-context-used.ts
```

Expected output:
```
Adding context_used column to agent_tasks...
✅ Done: agent_tasks.context_used added
```

**Step 3: Commit**

```bash
git add scripts/migrate-add-agent-context-used.ts
git commit -m "feat: add context_used column to agent_tasks"
```

---

### Task 2: Executor — persist auto-retrieved context

**Files:**
- Modify: `src/lib/agents/executor.ts`
- Modify: `tests/lib/agents/executor.test.ts`

**Step 1: Write the failing test**

Replace the contents of `tests/lib/agents/executor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing executor
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn().mockResolvedValue('Agent output'),
  DEFAULT_MODEL: 'test-model',
}));
vi.mock('@/lib/agents/context', () => ({
  buildTaskContext: vi.fn().mockResolvedValue({
    attachedNotes: [{ id: 'note-1', title: 'Attached Note', content: 'content' }],
    attachedUrls: [],
    relevantNotes: [
      { id: 'note-2', title: 'Auto Note', content: 'auto content', similarity: 0.89 },
    ],
  }),
  formatContextForPrompt: vi.fn().mockReturnValue('formatted context'),
}));
vi.mock('@/lib/agents/status-sync', () => ({
  syncTaskStatusFromAgentTask: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgentTask } from '@/lib/agents/executor';
import { db, queryOne, queryAll } from '@/lib/db/client';

describe('Agent Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: return a valid task
    vi.mocked(queryOne).mockResolvedValue({
      id: 'task-1',
      user_id: 'user-1',
      assigned_agent: 'general',
      description: 'Write something',
      title: 'Test task',
      context_note_ids: '[]',
      context_urls: '[]',
      output_format: 'markdown',
      current_version: 0,
      max_revisions: 5,
    });
  });

  it('persists context_used with auto-retrieved notes after building context', async () => {
    await executeAgentTask('task-1');

    // Find the UPDATE call that sets context_used
    const calls = vi.mocked(db.execute).mock.calls;
    const contextUsedCall = calls.find(
      ([arg]) => typeof arg === 'object' && arg.sql?.includes('context_used')
    );

    expect(contextUsedCall).toBeDefined();
    const savedJson = JSON.parse(contextUsedCall![0].args![0] as string);
    expect(savedJson).toEqual([
      { id: 'note-2', title: 'Auto Note', similarity: 0.89 },
    ]);
  });

  it('saves empty array when no auto-retrieved notes found', async () => {
    const { buildTaskContext } = await import('@/lib/agents/context');
    vi.mocked(buildTaskContext).mockResolvedValueOnce({
      attachedNotes: [],
      attachedUrls: [],
      relevantNotes: [],
    });

    await executeAgentTask('task-1');

    const calls = vi.mocked(db.execute).mock.calls;
    const contextUsedCall = calls.find(
      ([arg]) => typeof arg === 'object' && arg.sql?.includes('context_used')
    );
    const savedJson = JSON.parse(contextUsedCall![0].args![0] as string);
    expect(savedJson).toEqual([]);
  });
});
```

**Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/lib/agents/executor.test.ts
```

Expected: FAIL — `context_used` UPDATE call not found.

**Step 3: Add the persistence to the executor**

In `src/lib/agents/executor.ts`, after `buildTaskContext()` resolves and before building the prompt, add:

```ts
// Persist auto-retrieved context for post-run visibility
const contextUsed = context.relevantNotes.map((n) => ({
  id: n.id,
  title: n.title,
  similarity: n.similarity,
}));
await db.execute({
  sql: "UPDATE agent_tasks SET context_used = ? WHERE id = ?",
  args: [JSON.stringify(contextUsed), taskId],
});
```

Insert this block starting at line ~54 of `executor.ts`, right after the `console.log` that says `Context built with...`.

**Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/lib/agents/executor.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agents/executor.ts tests/lib/agents/executor.test.ts
git commit -m "feat: persist auto-retrieved context in agent_tasks.context_used"
```

---

### Task 3: API — resolve note titles for context_note_ids

**Files:**
- Modify: `src/app/api/agent-tasks/[id]/route.ts`

**Step 1: Update the GET handler**

In `src/app/api/agent-tasks/[id]/route.ts`, after fetching the task, resolve the manually pinned note IDs into `{id, title, slug}` objects:

```ts
// Resolve context_note_ids into note objects
const contextNoteIds = JSON.parse(task.context_note_ids || '[]') as string[];
let contextNotes: Array<{ id: string; title: string; slug: string }> = [];
if (contextNoteIds.length > 0) {
  const placeholders = contextNoteIds.map(() => '?').join(',');
  contextNotes = await queryAll<{ id: string; title: string; slug: string }>(
    `SELECT id, title, slug FROM notes WHERE id IN (${placeholders})`,
    contextNoteIds
  );
}

// Parse context_used (auto-retrieved)
const contextUsed = JSON.parse(task.context_used || '[]') as Array<{
  id: string;
  title: string;
  similarity: number;
}>;

return NextResponse.json({ task, outputs, feedback, contextNotes, contextUsed });
```

Add the `queryAll` import if not already present — it's already imported.

**Step 2: Run the full test suite to check for regressions**

```bash
npx vitest run
```

Expected: All existing tests pass.

**Step 3: Commit**

```bash
git add src/app/api/agent-tasks/[id]/route.ts
git commit -m "feat: resolve context note titles in agent-tasks GET"
```

---

### Task 4: UI — Context Used section in AgentReviewFocusPanel

**Files:**
- Modify: `src/components/agents/agent-review-focus-panel.tsx`

**Step 1: Update the data shape**

The `useQuery` in `AgentReviewFocusPanel` already fetches from `/api/agent-tasks/${taskId}`. Now that the API returns `contextNotes` and `contextUsed`, destructure them:

```ts
// Replace line 52-54:
const task = data?.task;
const outputs = data?.outputs || [];
const contextNotes: Array<{ id: string; title: string; slug: string }> = data?.contextNotes || [];
const contextUsed: Array<{ id: string; title: string; similarity: number }> = data?.contextUsed || [];
const currentOutput = outputs[0];
```

**Step 2: Replace the "View Original Prompt" section with Context Used**

Find the block starting at:
```tsx
{/* Collapsible Prompt */}
<div className="px-3 sm:px-6 pt-3 sm:pt-4 flex-shrink-0">
```

Replace the entire block (through the closing `</div>` after `</AnimatePresence>`) with:

```tsx
{/* Context Used - expanded by default */}
{(contextNotes.length > 0 || contextUsed.length > 0) && (
  <div className="px-3 sm:px-6 pt-3 sm:pt-4 flex-shrink-0">
    <button
      type="button"
      onClick={() => setShowPrompt(!showPrompt)}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
    >
      {showPrompt ? (
        <ChevronUp className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3" />
      )}
      Context used by agent
    </button>

    {showPrompt && (
      <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-2 mb-3">
        {contextNotes.length > 0 && (
          <div>
            <span className="text-muted-foreground font-medium">📌 Your notes: </span>
            <span className="flex flex-wrap gap-1 mt-1">
              {contextNotes.map((note) => (
                <a
                  key={note.id}
                  href={`/notes/${note.slug}`}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-background border text-foreground hover:bg-accent transition-colors"
                  target="_blank"
                  rel="noreferrer"
                >
                  {note.title}
                </a>
              ))}
            </span>
          </div>
        )}
        {contextUsed.length > 0 && (
          <div>
            <span className="text-muted-foreground font-medium">🔍 Auto-found: </span>
            <span className="flex flex-wrap gap-1 mt-1">
              {contextUsed.map((note) => (
                <a
                  key={note.id}
                  href={`/notes/${note.id}`}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-background border text-foreground hover:bg-accent transition-colors"
                  target="_blank"
                  rel="noreferrer"
                >
                  {note.title}
                  <span className="ml-1 text-muted-foreground">
                    {Math.round(note.similarity * 100)}%
                  </span>
                </a>
              ))}
            </span>
          </div>
        )}
      </div>
    )}
  </div>
)}
```

Note: `showPrompt` state is already declared — repurpose it for the context section toggle. Initialize it to `true` (expanded by default):

```ts
// Change line 36:
const [showPrompt, setShowPrompt] = useState(true); // default open
```

**Step 3: Manual smoke test**

1. `npm run dev`
2. Open an existing completed agent task
3. Verify the "Context used by agent" section appears expanded at the top of the review panel
4. Verify it's collapsible
5. Verify note links open correctly

**Step 4: Commit**

```bash
git add src/components/agents/agent-review-focus-panel.tsx
git commit -m "feat: show Context Used section in agent review panel"
```

---

## Feature 2: Recurring Tasks

### Task 5: Install rrule

**Step 1: Install the package**

```bash
npm install rrule
```

**Step 2: Verify the install**

```bash
node -e "const { RRule } = require('rrule'); console.log(new RRule({ freq: RRule.WEEKLY, byweekday: [RRule.MO] }).toText())"
```

Expected output: `every week on Monday`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install rrule for RFC 5545 recurrence support"
```

---

### Task 6: DB Migration — add recurrence columns to `tasks`

**Files:**
- Create: `scripts/migrate-add-recurrence.ts`

**Step 1: Create the migration script**

```ts
// scripts/migrate-add-recurrence.ts
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const columns = [
    {
      sql: "ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT",
      name: "recurrence_rule",
    },
    {
      sql: "ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT",
      name: "recurrence_end_date",
    },
    {
      sql: "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL",
      name: "parent_task_id",
    },
  ];

  for (const col of columns) {
    try {
      await db.execute(col.sql);
      console.log(`✅ Added tasks.${col.name}`);
    } catch (error: any) {
      if (error.message?.includes("duplicate column")) {
        console.log(`✅ tasks.${col.name} already exists, skipping`);
      } else {
        console.error(`❌ Failed to add ${col.name}:`, error);
        await db.close();
        process.exit(1);
      }
    }
  }

  console.log("\n✅ Recurrence migration complete");
  await db.close();
}

migrate().catch(console.error);
```

**Step 2: Run the migration**

```bash
npx tsx scripts/migrate-add-recurrence.ts
```

Expected:
```
✅ Added tasks.recurrence_rule
✅ Added tasks.recurrence_end_date
✅ Added tasks.parent_task_id

✅ Recurrence migration complete
```

**Step 3: Commit**

```bash
git add scripts/migrate-add-recurrence.ts
git commit -m "feat: add recurrence columns to tasks table"
```

---

### Task 7: Recurrence utility — next-occurrence logic

**Files:**
- Create: `src/lib/tasks/recurrence.ts`
- Create: `tests/lib/tasks/recurrence.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/lib/tasks/recurrence.test.ts
import { describe, it, expect } from 'vitest';
import { getNextOccurrence, rruleToText } from '@/lib/tasks/recurrence';

describe('getNextOccurrence', () => {
  it('returns next daily occurrence after given date', () => {
    const after = new Date('2026-03-01T12:00:00Z');
    const result = getNextOccurrence('FREQ=DAILY', after);
    expect(result?.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('returns next weekly occurrence on correct weekday', () => {
    // MO = Monday. 2026-03-02 is a Monday. after = Sunday 2026-03-01
    const after = new Date('2026-03-01T00:00:00Z');
    const result = getNextOccurrence('FREQ=WEEKLY;BYDAY=MO', after);
    expect(result?.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('returns null when past recurrence_end_date', () => {
    const after = new Date('2026-04-01T00:00:00Z');
    const result = getNextOccurrence('FREQ=DAILY', after, '2026-03-31');
    expect(result).toBeNull();
  });

  it('returns null for invalid RRULE string', () => {
    const result = getNextOccurrence('NOT_VALID', new Date());
    expect(result).toBeNull();
  });
});

describe('rruleToText', () => {
  it('converts daily rule to human text', () => {
    expect(rruleToText('FREQ=DAILY')).toBe('every day');
  });

  it('converts weekly rule to human text', () => {
    const text = rruleToText('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(text).toMatch(/monday/i);
    expect(text).toMatch(/wednesday/i);
  });

  it('returns null for empty or invalid input', () => {
    expect(rruleToText('')).toBeNull();
    expect(rruleToText(null)).toBeNull();
  });
});
```

**Step 2: Run to verify failing**

```bash
npx vitest run tests/lib/tasks/recurrence.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement the utility**

```ts
// src/lib/tasks/recurrence.ts
import { RRule } from 'rrule';

/**
 * Compute the next occurrence date after `after`.
 * Returns null if no next occurrence exists (past end date or invalid rule).
 */
export function getNextOccurrence(
  recurrenceRule: string,
  after: Date,
  recurrenceEndDate?: string | null
): Date | null {
  try {
    const rule = RRule.fromString(`RRULE:${recurrenceRule}`);
    const next = rule.after(after, false); // exclusive — don't include `after` itself

    if (!next) return null;

    if (recurrenceEndDate) {
      const endDate = new Date(recurrenceEndDate);
      if (next > endDate) return null;
    }

    return next;
  } catch {
    return null;
  }
}

/**
 * Convert an RRULE string to a human-readable description.
 * Returns null for empty / invalid input.
 */
export function rruleToText(recurrenceRule: string | null | undefined): string | null {
  if (!recurrenceRule) return null;
  try {
    const rule = RRule.fromString(`RRULE:${recurrenceRule}`);
    return rule.toText();
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify passing**

```bash
npx vitest run tests/lib/tasks/recurrence.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/tasks/recurrence.ts tests/lib/tasks/recurrence.test.ts
git commit -m "feat: add recurrence utility (getNextOccurrence, rruleToText)"
```

---

### Task 8: API — handle recurrence on task completion

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts`
- Modify: `src/app/api/tasks/route.ts`
- Create: `tests/api/tasks/recurrence.test.ts`

**Step 1: Write the failing test**

```ts
// tests/api/tasks/recurrence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextOccurrence } from '@/lib/tasks/recurrence';

// Unit test the recurrence spawning logic in isolation
// (API routes are harder to unit-test; test the utility they call)

describe('Recurrence on completion', () => {
  it('spawns next occurrence for daily rule', () => {
    const after = new Date('2026-03-01T00:00:00Z');
    const next = getNextOccurrence('FREQ=DAILY', after);
    expect(next).not.toBeNull();
    expect(next!.toISOString().split('T')[0]).toBe('2026-03-02');
  });

  it('does not spawn when past end date', () => {
    const after = new Date('2026-04-01T00:00:00Z');
    const next = getNextOccurrence('FREQ=DAILY', after, '2026-03-31');
    expect(next).toBeNull();
  });

  it('does not spawn for task with no recurrence_rule', () => {
    const next = getNextOccurrence('', new Date());
    expect(next).toBeNull();
  });
});
```

**Step 2: Run to verify passing (it uses the already-built utility)**

```bash
npx vitest run tests/api/tasks/recurrence.test.ts
```

Expected: PASS

**Step 3: Update the PUT handler in `src/app/api/tasks/[id]/route.ts`**

Add import at the top of the file:
```ts
import { getNextOccurrence } from '@/lib/tasks/recurrence';
```

Add handling for the two new fields in the body section (after line ~103 where `completed_at` is handled):
```ts
if (body.recurrenceRule !== undefined) {
  updates.push("recurrence_rule = ?");
  args.push(body.recurrenceRule || null);
}

if (body.recurrenceEndDate !== undefined) {
  updates.push("recurrence_end_date = ?");
  args.push(body.recurrenceEndDate || null);
}
```

After the existing `db.execute` update call (after line ~116), add the recurrence spawning block:

```ts
// Spawn next occurrence when a recurring task is completed
if (body.status === 'completed' && existing.status !== 'completed' && existing.recurrence_rule) {
  const next = getNextOccurrence(
    existing.recurrence_rule,
    new Date(),
    existing.recurrence_end_date
  );

  if (next) {
    await db.execute({
      sql: `
        INSERT INTO tasks
          (user_id, content, status, priority, project_id, note_id, due_date,
           recurrence_rule, recurrence_end_date, parent_task_id, tags)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        user.id,
        existing.content,
        existing.priority,
        existing.project_id || null,
        existing.note_id || null,
        next.toISOString().split('T')[0],
        existing.recurrence_rule,
        existing.recurrence_end_date || null,
        id, // parent_task_id = current task
        existing.tags || '[]',
      ],
    });
  }
}
```

**Step 4: Update the POST handler in `src/app/api/tasks/route.ts`**

In the POST body destructuring (around line ~110), add:
```ts
const {
  content,
  status = "pending",
  priority = "medium",
  projectId,
  noteId,
  dueDate,
  delegatedTo,
  autoExecute,
  recurrenceRule,      // NEW
  recurrenceEndDate,   // NEW
} = body;
```

In the `INSERT INTO tasks` statement, add the two new columns:
```ts
await db.execute({
  sql: `
    INSERT INTO tasks (user_id, content, status, priority, project_id, note_id, due_date,
                       delegated_to, recurrence_rule, recurrence_end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  args: [
    user.id,
    content.trim(),
    delegatedTo && autoExecute ? "in_progress" : status,
    priority,
    projectId || null,
    noteId || null,
    dueDate || null,
    delegatedTo || null,
    recurrenceRule || null,    // NEW
    recurrenceEndDate || null, // NEW
  ],
});
```

**Step 5: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/app/api/tasks/[id]/route.ts src/app/api/tasks/route.ts tests/api/tasks/recurrence.test.ts
git commit -m "feat: spawn next task occurrence on completion of recurring task"
```

---

### Task 9: RecurrencePicker component

**Files:**
- Create: `src/components/tasks/recurrence-picker.tsx`

**Step 1: Create the component**

```tsx
// src/components/tasks/recurrence-picker.tsx
'use client';

import { useState, useEffect } from 'react';
import { RRule } from 'rrule';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { rruleToText } from '@/lib/tasks/recurrence';

interface RecurrencePickerProps {
  value: string | null;
  endDate: string | null;
  onChange: (rule: string | null) => void;
  onEndDateChange: (date: string | null) => void;
}

const DAYS = [
  { label: 'M', value: RRule.MO, name: 'Mon' },
  { label: 'T', value: RRule.TU, name: 'Tue' },
  { label: 'W', value: RRule.WE, name: 'Wed' },
  { label: 'T', value: RRule.TH, name: 'Thu' },
  { label: 'F', value: RRule.FR, name: 'Fri' },
  { label: 'S', value: RRule.SA, name: 'Sat' },
  { label: 'S', value: RRule.SU, name: 'Sun' },
];

type Mode = 'none' | 'daily' | 'every_n_days' | 'weekly' | 'monthly' | 'custom';

function parseMode(rule: string | null): Mode {
  if (!rule) return 'none';
  if (rule.startsWith('FREQ=DAILY;INTERVAL=')) return 'every_n_days';
  if (rule === 'FREQ=DAILY') return 'daily';
  if (rule.startsWith('FREQ=WEEKLY')) return 'weekly';
  if (rule.startsWith('FREQ=MONTHLY')) return 'monthly';
  return 'custom';
}

export function RecurrencePicker({ value, endDate, onChange, onEndDateChange }: RecurrencePickerProps) {
  const [mode, setMode] = useState<Mode>(() => parseMode(value));
  const [intervalDays, setIntervalDays] = useState(2);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(1);
  const [customRule, setCustomRule] = useState(value || '');

  // Sync internal state when value changes externally
  useEffect(() => {
    setMode(parseMode(value));
  }, [value]);

  const buildRule = (m: Mode): string | null => {
    switch (m) {
      case 'none': return null;
      case 'daily': return 'FREQ=DAILY';
      case 'every_n_days': return `FREQ=DAILY;INTERVAL=${intervalDays}`;
      case 'weekly': {
        if (selectedDays.length === 0) return 'FREQ=WEEKLY';
        const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
        const byDay = selectedDays.map(i => dayNames[i]).join(',');
        return `FREQ=WEEKLY;BYDAY=${byDay}`;
      }
      case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${monthDay}`;
      case 'custom': return customRule.trim() || null;
    }
  };

  const handleModeChange = (m: Mode) => {
    setMode(m);
    onChange(buildRule(m));
  };

  const humanText = value ? rruleToText(value) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(['none', 'daily', 'every_n_days', 'weekly', 'monthly', 'custom'] as Mode[]).map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? 'default' : 'outline'}
            className="h-8 text-xs capitalize"
            onClick={() => handleModeChange(m)}
          >
            {m === 'none' ? 'No repeat' :
             m === 'every_n_days' ? 'Every N days' :
             m.charAt(0).toUpperCase() + m.slice(1)}
          </Button>
        ))}
      </div>

      {mode === 'every_n_days' && (
        <div className="flex items-center gap-2 text-sm">
          <span>Every</span>
          <Input
            type="number"
            min={2}
            max={365}
            value={intervalDays}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 2;
              setIntervalDays(n);
              onChange(`FREQ=DAILY;INTERVAL=${n}`);
            }}
            className="h-8 w-20 text-sm"
          />
          <span>days</span>
        </div>
      )}

      {mode === 'weekly' && (
        <div className="flex gap-1">
          {DAYS.map((day, i) => (
            <button
              key={day.name}
              type="button"
              title={day.name}
              onClick={() => {
                const next = selectedDays.includes(i)
                  ? selectedDays.filter(d => d !== i)
                  : [...selectedDays, i];
                setSelectedDays(next);
                const dayNames = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
                const byDay = next.map(idx => dayNames[idx]).join(',');
                onChange(next.length > 0 ? `FREQ=WEEKLY;BYDAY=${byDay}` : 'FREQ=WEEKLY');
              }}
              className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${
                selectedDays.includes(i)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'monthly' && (
        <div className="flex items-center gap-2 text-sm">
          <span>On day</span>
          <Input
            type="number"
            min={1}
            max={31}
            value={monthDay}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 1;
              setMonthDay(n);
              onChange(`FREQ=MONTHLY;BYMONTHDAY=${n}`);
            }}
            className="h-8 w-20 text-sm"
          />
          <span>of the month</span>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-1">
          <Input
            placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=2"
            value={customRule}
            onChange={(e) => {
              setCustomRule(e.target.value);
              onChange(e.target.value.trim() || null);
            }}
            className="h-8 text-xs font-mono"
          />
          <p className="text-xs text-muted-foreground">RFC 5545 RRULE string (without "RRULE:" prefix)</p>
        </div>
      )}

      {humanText && mode !== 'none' && (
        <p className="text-xs text-muted-foreground italic">{humanText}</p>
      )}

      {mode !== 'none' && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">End date (optional)</Label>
          <Input
            type="date"
            value={endDate || ''}
            onChange={(e) => onEndDateChange(e.target.value || null)}
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Manual visual check**

```bash
npm run dev
```

We'll wire it into dialogs in the next task. For now, verify the component file has no TypeScript errors:

```bash
npm run typecheck
```

Expected: No errors in the new file.

**Step 3: Commit**

```bash
git add src/components/tasks/recurrence-picker.tsx
git commit -m "feat: add RecurrencePicker component (RRULE-based)"
```

---

### Task 10: Wire RecurrencePicker into TaskCreateDialog

**Files:**
- Modify: `src/components/tasks/task-create-dialog.tsx`

**Step 1: Add state and imports**

At the top of `TaskCreateDialog`, add the import:
```ts
import { RecurrencePicker } from '@/components/tasks/recurrence-picker';
```

In the component state block (around line 76), add:
```ts
const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
```

**Step 2: Add RecurrencePicker to the form**

In the advanced options section (the block rendered when `showAdvanced` is true, around line 322), add after the project select:

```tsx
<div className="space-y-2">
  <Label className="text-sm">Repeat</Label>
  <RecurrencePicker
    value={recurrenceRule}
    endDate={recurrenceEndDate}
    onChange={setRecurrenceRule}
    onEndDateChange={setRecurrenceEndDate}
  />
</div>
```

**Step 3: Include in the submit payload**

In `handleSubmit` (around line 143), add to `payload`:
```ts
if (recurrenceRule) {
  payload.recurrenceRule = recurrenceRule;
  payload.recurrenceEndDate = recurrenceEndDate;
}
```

**Step 4: Reset on close**

In `handleClose`, add:
```ts
setRecurrenceRule(null);
setRecurrenceEndDate(null);
```

**Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

**Step 6: Commit**

```bash
git add src/components/tasks/task-create-dialog.tsx
git commit -m "feat: wire RecurrencePicker into TaskCreateDialog"
```

---

### Task 11: Wire RecurrencePicker into TaskEditDialog

**Files:**
- Modify: `src/components/tasks/task-edit-dialog.tsx`

**Step 1: Add state and imports**

```ts
import { RecurrencePicker } from '@/components/tasks/recurrence-picker';
```

Update the `Task` interface in the file (around line 27) to include:
```ts
interface Task {
  id: string;
  content: string;
  status: string;
  priority: string;
  project_id: string | null;
  due_date: string | null;
  recurrence_rule: string | null;      // NEW
  recurrence_end_date: string | null;  // NEW
}
```

Add state:
```ts
const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
```

**Step 2: Populate on task load**

In the `useEffect` that populates the form (around line 59), add:
```ts
setRecurrenceRule(task.recurrence_rule || null);
setRecurrenceEndDate(task.recurrence_end_date || null);
```

**Step 3: Add RecurrencePicker to the form**

After the project `<Select>` (around line 175), add:
```tsx
<div className="space-y-2">
  <Label htmlFor="recurrence" className="text-sm">Repeat</Label>
  <RecurrencePicker
    value={recurrenceRule}
    endDate={recurrenceEndDate}
    onChange={setRecurrenceRule}
    onEndDateChange={setRecurrenceEndDate}
  />
</div>
```

**Step 4: Include in submit payload**

In `handleSubmit`, add to the JSON body:
```ts
recurrenceRule: recurrenceRule,
recurrenceEndDate: recurrenceEndDate,
```

**Step 5: Run typecheck**

```bash
npm run typecheck
```

**Step 6: Commit**

```bash
git add src/components/tasks/task-edit-dialog.tsx
git commit -m "feat: wire RecurrencePicker into TaskEditDialog"
```

---

### Task 12: Visual indicator on task cards and detail panel

**Files:**
- Modify: `src/components/tasks/task-card.tsx`
- Modify: `src/components/tasks/task-detail-panel.tsx`

**Step 1: task-card.tsx — add repeat icon**

First, read the file to find the right location. The task card renders the task content and metadata. Find where tags or status badges are rendered and add a repeat icon alongside them.

Add the import at the top:
```ts
import { rruleToText } from '@/lib/tasks/recurrence';
```

The `Task` type in the card likely comes from a prop. Verify the prop type includes `recurrence_rule`. If the local interface doesn't, add:
```ts
recurrence_rule?: string | null;
```

Then, in the JSX, wherever status or priority is shown, add:
```tsx
{task.recurrence_rule && (
  <span title={rruleToText(task.recurrence_rule) || 'Recurring'} className="text-muted-foreground">
    ↻
  </span>
)}
```

**Step 2: task-detail-panel.tsx — show human-readable recurrence text**

Add the import:
```ts
import { rruleToText } from '@/lib/tasks/recurrence';
```

Find where due date or metadata is rendered and add:
```tsx
{task.recurrence_rule && (
  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
    <span>↻</span>
    <span>{rruleToText(task.recurrence_rule) || task.recurrence_rule}</span>
    {task.recurrence_end_date && (
      <span>· until {task.recurrence_end_date}</span>
    )}
  </div>
)}
```

**Step 3: Run typecheck and full test suite**

```bash
npm run typecheck && npx vitest run
```

Expected: No errors, all tests pass.

**Step 4: Commit**

```bash
git add src/components/tasks/task-card.tsx src/components/tasks/task-detail-panel.tsx
git commit -m "feat: show repeat icon and recurrence text on task cards"
```

---

## Final Verification

**Step 1: Run full lint + typecheck + tests**

```bash
npm run lint && npm run typecheck && npx vitest run
```

Expected: All pass.

**Step 2: Manual end-to-end smoke test**

**Context Briefcase:**
1. Create a task, delegate it to any agent
2. Wait for it to process (or trigger via cron)
3. Open the review panel
4. Verify "Context used by agent" section is expanded by default
5. Verify auto-found notes show with similarity %
6. Verify manually pinned notes show as links
7. Verify section is collapsible

**Recurring Tasks:**
1. Create a task, expand advanced options, set repeat to "Weekly" + pick Monday and Wednesday
2. Verify the human-readable text shows: "every Monday and Wednesday"
3. Save the task
4. Open the task — verify ↻ icon shows in the card and detail panel shows recurrence text
5. Mark the task complete
6. Verify a new task appears in the list with next occurrence date and the same ↻ icon
7. Edit the task and remove recurrence (set to "No repeat") — verify the ↻ icon disappears

**Step 3: Final commit if any cleanup needed**

```bash
git add -p  # review and stage only intentional changes
git commit -m "chore: final cleanup for P0 features"
```
