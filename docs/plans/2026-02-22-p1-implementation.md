# P1 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LLM-powered natural language task parsing (replaces keyword regex) and a project health dashboard card + dashboard feed alerts.

**Architecture:** `parseTaskNL()` in `src/lib/tasks/parse.ts` calls `completeJSON` via the existing `fast_llm`-tier AI client, with results cached 24h in `ai_cache`. Health checks run 3 fast SQL queries in a new `/api/projects/[id]/health` route and optionally call `full_llm` for a 1-sentence risk summary (48h cache). The `ProjectHealthCard` component fetches health data client-side and renders above existing project sections.

**Tech Stack:** Next.js 15 App Router, Turso (libSQL), `completeJSON` from `@/lib/ai/client`, `@tanstack/react-query`, shadcn/ui, Vitest

---

## Task 1: `parseTaskNL` utility

**Files:**
- Create: `src/lib/tasks/parse.ts`
- Create: `tests/lib/tasks/parse.test.ts`

### Step 1: Write the failing tests

```typescript
// tests/lib/tasks/parse.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/client', () => ({
  completeJSON: vi.fn(),
  DEFAULT_MODEL: 'test-model',
}));
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn().mockResolvedValue(null), // no cache hit by default
}));

import { parseTaskNL } from '@/lib/tasks/parse';
import { completeJSON } from '@/lib/ai/client';
import { queryOne, db } from '@/lib/db/client';

describe('parseTaskNL', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns parsed task fields from LLM response', async () => {
    vi.mocked(completeJSON).mockResolvedValue({
      title: 'Write blog post about AI',
      dueDate: '2026-02-27',
      priority: 'urgent',
      agent: 'copy',
      tags: ['blog', 'AI'],
    });

    const result = await parseTaskNL('Write blog post about AI by Friday urgent', '2026-02-22', 'user-1');

    expect(result).toEqual({
      title: 'Write blog post about AI',
      dueDate: '2026-02-27',
      priority: 'urgent',
      agent: 'copy',
      tags: ['blog', 'AI'],
    });
  });

  it('returns null when LLM throws', async () => {
    vi.mocked(completeJSON).mockRejectedValue(new Error('API error'));

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns malformed data', async () => {
    vi.mocked(completeJSON).mockResolvedValue(null);

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');
    expect(result).toBeNull();
  });

  it('returns cached result without calling LLM on cache hit', async () => {
    vi.mocked(queryOne).mockResolvedValue({
      output: JSON.stringify({ title: 'Cached title', dueDate: null, priority: null, agent: null, tags: [] }),
    });

    const result = await parseTaskNL('some task', '2026-02-22', 'user-1');

    expect(result?.title).toBe('Cached title');
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it('saves result to ai_cache after LLM call', async () => {
    vi.mocked(completeJSON).mockResolvedValue({
      title: 'Fix bug', dueDate: null, priority: 'high', agent: 'code', tags: [],
    });

    await parseTaskNL('Fix bug in auth', '2026-02-22', 'user-1');

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      ([arg]) => typeof arg === 'object' && (arg as any).sql?.includes('INSERT INTO ai_cache')
    );
    expect(insertCall).toBeDefined();
  });
});
```

### Step 2: Run to verify it fails

```bash
npx vitest run tests/lib/tasks/parse.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/tasks/parse'`

### Step 3: Implement `parseTaskNL`

```typescript
// src/lib/tasks/parse.ts
import { completeJSON, DEFAULT_MODEL } from '@/lib/ai/client';
import { db, queryOne } from '@/lib/db/client';
import { createHash } from 'crypto';

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  agent: string | null;
  tags: string[];
}

export async function parseTaskNL(
  content: string,
  today: string,
  userId: string
): Promise<ParsedTask | null> {
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const cacheKey = `parse:${userId}:${contentHash}`;

  // Check cache
  try {
    const cached = await queryOne<{ output: string }>(
      "SELECT output FROM ai_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
      [cacheKey]
    );
    if (cached) {
      return JSON.parse(cached.output) as ParsedTask;
    }
  } catch {
    // Cache miss or error — proceed to LLM
  }

  // Call LLM
  try {
    const prompt = `Today is ${today}. Parse this task description and return JSON only:
{
  "title": "cleaned task title without date/priority/agent keywords",
  "dueDate": "YYYY-MM-DD or null",
  "priority": "low|medium|high|urgent or null",
  "agent": "code|copy|research|marketing|analyst|general or null",
  "tags": []
}
Task: "${content.replace(/"/g, "'")}"`;

    const parsed = await completeJSON<ParsedTask>(prompt, {
      model: DEFAULT_MODEL,
      maxTokens: 256,
    });

    if (!parsed || typeof parsed.title !== 'string') return null;

    // Normalize
    const result: ParsedTask = {
      title: parsed.title || content,
      dueDate: parsed.dueDate || null,
      priority: parsed.priority || null,
      agent: parsed.agent || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };

    // Save to cache (24h TTL)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    await db.execute({
      sql: `INSERT OR REPLACE INTO ai_cache
        (user_id, cache_key, operation_type, tier, model, input_hash, output, expires_at)
        VALUES (?, ?, 'task_parse', 'fast_llm', ?, ?, ?, ?)`,
      args: [userId, cacheKey, DEFAULT_MODEL, contentHash, JSON.stringify(result), expiresAt],
    });

    return result;
  } catch {
    return null;
  }
}
```

### Step 4: Run tests to verify they pass

```bash
npx vitest run tests/lib/tasks/parse.test.ts
```
Expected: 5 passing

### Step 5: Commit

```bash
git add src/lib/tasks/parse.ts tests/lib/tasks/parse.test.ts
git commit -m "feat: add parseTaskNL with LLM parsing and ai_cache support"
```

---

## Task 2: Wire `parseTaskNL` into POST `/api/tasks`

**Files:**
- Modify: `src/app/api/tasks/route.ts`

### Step 1: Write the failing test

Add to or create `tests/app/api/tasks/route.test.ts`:

```typescript
// tests/app/api/tasks/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/tasks/parse', () => ({
  parseTaskNL: vi.fn().mockResolvedValue({
    title: 'Write blog post',
    dueDate: '2026-02-27',
    priority: 'urgent',
    agent: null,
    tags: ['blog'],
  }),
}));

import { POST } from '@/app/api/tasks/route';
import { db, queryOne } from '@/lib/db/client';
import { parseTaskNL } from '@/lib/tasks/parse';
import { NextRequest } from 'next/server';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryOne).mockResolvedValue({ id: 'task-1' }); // return created task
  });

  it('calls parseTaskNL with content and today', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    await POST(req);

    expect(parseTaskNL).toHaveBeenCalledWith(
      'Write blog post by Friday urgent',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'user-1'
    );
  });

  it('stores parsed title (not raw content) in DB', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    await POST(req);

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      ([arg]) => typeof arg === 'object' && (arg as any).sql?.includes('INSERT INTO tasks')
    );
    expect(insertCall).toBeDefined();
    const args = (insertCall![0] as any).args;
    expect(args).toContain('Write blog post'); // parsed title, not raw
  });

  it('uses parsed priority when body priority is default medium', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent', priority: 'medium' });
    await POST(req);

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      ([arg]) => typeof arg === 'object' && (arg as any).sql?.includes('INSERT INTO tasks')
    );
    const args = (insertCall![0] as any).args;
    expect(args).toContain('urgent'); // from parsed priority
  });

  it('uses explicit priority over parsed when user changed it', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent', priority: 'low' });
    await POST(req);

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      ([arg]) => typeof arg === 'object' && (arg as any).sql?.includes('INSERT INTO tasks')
    );
    const args = (insertCall![0] as any).args;
    expect(args).toContain('low'); // explicit user value wins
  });

  it('returns parsed fields in response', async () => {
    const req = makeRequest({ content: 'Write blog post by Friday urgent' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.parsed).toBeDefined();
    expect(body.parsed.title).toBe('Write blog post');
    expect(body.parsed.dueDate).toBe('2026-02-27');
  });

  it('proceeds normally when parseTaskNL returns null', async () => {
    vi.mocked(parseTaskNL).mockResolvedValueOnce(null);
    const req = makeRequest({ content: 'some task' });
    const res = await POST(req);

    expect(res.status).toBe(201);
  });
});
```

### Step 2: Run to verify it fails

```bash
npx vitest run tests/app/api/tasks/route.test.ts
```
Expected: FAIL — `parseTaskNL` not called, wrong values stored

### Step 3: Update POST handler

Replace the relevant section of `src/app/api/tasks/route.ts` POST function. Import `parseTaskNL` at the top and update the handler:

```typescript
// Add to imports at top of file:
import { parseTaskNL } from '@/lib/tasks/parse';

// Replace the POST function body (keep GET unchanged):
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    content,
    status = "pending",
    priority = "medium",
    projectId,
    noteId,
    dueDate,
    delegatedTo,
    autoExecute,
    recurrenceRule,
    recurrenceEndDate,
  } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  // NL parsing: extract structured fields from free-form text
  const today = new Date().toISOString().split('T')[0];
  const parsed = await parseTaskNL(content.trim(), today, user.id);

  // Merge: explicit user values win over parsed; parsed wins over defaults
  const finalTitle = parsed?.title || content.trim();
  const finalDueDate = dueDate || parsed?.dueDate || null;
  // Use explicit priority only if user changed it from default; otherwise use parsed
  const finalPriority = (priority !== 'medium') ? priority : (parsed?.priority || 'medium');

  // Create the task
  await db.execute({
    sql: `
      INSERT INTO tasks (user_id, content, status, priority, project_id, note_id, due_date,
                         delegated_to, recurrence_rule, recurrence_end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      user.id,
      finalTitle,
      delegatedTo && autoExecute ? "in_progress" : status,
      finalPriority,
      projectId || null,
      noteId || null,
      finalDueDate,
      delegatedTo || null,
      recurrenceRule || null,
      recurrenceEndDate || null,
    ],
  });

  const task = await queryOne<Task>(
    "SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [user.id]
  );

  // If assigned to AI agent and autoExecute, create agent task
  if (delegatedTo && autoExecute && task) {
    const title = finalTitle.split('\n')[0].slice(0, 60);
    const description = content.trim();

    await db.execute({
      sql: `
        INSERT INTO agent_tasks (
          user_id, task_id, title, description,
          task_type, assigned_agent, status, priority
        )
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
      `,
      args: [
        user.id,
        task.id,
        title,
        description,
        delegatedTo,
        delegatedTo,
        finalPriority,
      ],
    });

    const agentTask = await queryOne<any>(
      "SELECT * FROM agent_tasks WHERE user_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1",
      [user.id, task.id]
    );

    if (agentTask) {
      await db.execute({
        sql: "UPDATE tasks SET agent_task_id = ? WHERE id = ?",
        args: [agentTask.id, task.id],
      });
    }
  }

  return NextResponse.json({ task, parsed }, { status: 201 });
}
```

### Step 4: Run tests

```bash
npx vitest run tests/app/api/tasks/route.test.ts
```
Expected: all passing

### Step 5: Commit

```bash
git add src/app/api/tasks/route.ts tests/app/api/tasks/route.test.ts
git commit -m "feat: wire NL parsing into task creation API"
```

---

## Task 3: Update `TaskCreateDialog` — remove regex, add parse toast

**Files:**
- Modify: `src/components/tasks/task-create-dialog.tsx`

### Step 1: Understand what to change

Open `src/components/tasks/task-create-dialog.tsx` and make these changes:
1. Remove the `detectAgentFromText` function (lines 31–60)
2. Remove `autoDetectedAgent` state and the `useEffect` that calls it (lines 82, 104–116)
3. In `handleSubmit`, after `const data = await response.json()`, build a descriptive toast from `data.parsed`
4. Remove the Smart Assign Preview section that shows `autoDetectedAgent` (lines 261–279) — or simplify to show nothing (Smart Assign with no preview is fine; the LLM runs on submit)

### Step 2: Make the changes

In `handleSubmit`, replace the current success toast section:

```typescript
// Replace the current success toast lines (approx lines 176–180):
if (payload.delegatedTo) {
  toast.success('Task created and assigned to AI agent');
} else {
  toast.success('Task created');
}

// With:
const parsedInfo = data.parsed;
const parts: string[] = ['Task created'];
if (parsedInfo?.dueDate) {
  const d = new Date(parsedInfo.dueDate + 'T00:00:00');
  parts.push(`due ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
}
if (parsedInfo?.priority && parsedInfo.priority !== 'medium') {
  parts.push(parsedInfo.priority);
}
if (payload.delegatedTo) {
  parts.push('→ AI agent');
}
toast.success(parts.join(' · '));
```

Remove `detectAgentFromText` function, `autoDetectedAgent` state, and its `useEffect`:
- Delete lines 31–60 (the `detectAgentFromText` function)
- Delete line `const [autoDetectedAgent, setAutoDetectedAgent] = useState<string | null>(null);`
- Delete the `useEffect` that calls `detectAgentFromText` (lines 104–116)
- Delete the Smart Assign Preview JSX block (the two `{assignTo === 'auto' && ...}` divs, lines 261–279)
- Remove `autoDetectedAgent` from the `useMemo` deps array

Also update `handleClose` to remove `setAutoDetectedAgent(null);`.

### Step 3: Verify no TypeScript errors

```bash
npm run typecheck 2>&1 | head -30
```
Expected: no errors related to these files

### Step 4: Commit

```bash
git add src/components/tasks/task-create-dialog.tsx
git commit -m "feat: remove keyword regex, show NL parse results in task toast"
```

---

## Task 4: Project health API endpoint

**Files:**
- Create: `src/app/api/projects/[id]/health/route.ts`
- Create: `tests/lib/projects/health.test.ts`

### Step 1: Write the failing tests

```typescript
// tests/lib/projects/health.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/db/client', () => ({
  db: { execute: vi.fn().mockResolvedValue({}) },
  queryOne: vi.fn(),
  queryAll: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ai/client', () => ({
  completeJSON: vi.fn(),
  complete: vi.fn().mockResolvedValue('This project has stalled.'),
  DEFAULT_MODEL: 'test-model',
}));

import { GET } from '@/app/api/projects/[id]/health/route';
import { queryOne, queryAll, db } from '@/lib/db/client';
import { complete } from '@/lib/ai/client';
import { NextRequest } from 'next/server';

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/projects/${id}/health`);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/projects/[id]/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: healthy project
    vi.mocked(queryOne).mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return { id: 'proj-1', name: 'Test', status: 'active' };
      if (sql.includes('ai_cache')) return null; // no cache
      if (sql.includes('FROM insights')) return null; // no existing insight
      return null;
    });
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(updated_at)')) return [{ last_note_date: new Date().toISOString() }];
      if (sql.includes('open_tasks')) return [{ open_tasks: 2, overdue_tasks: 1 }];
      if (sql.includes('MAX(completed_at)')) return [{ last_completion_date: new Date().toISOString() }];
      return [];
    });
  });

  it('returns healthy when no rules fire', async () => {
    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.healthy).toBe(true);
    expect(body.flags).toHaveLength(0);
  });

  it('flags no_activity when last note > 7 days old and open tasks exist', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(updated_at)')) {
        const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        return [{ last_note_date: old }];
      }
      if (sql.includes('open_tasks')) return [{ open_tasks: 3, overdue_tasks: 0 }];
      if (sql.includes('MAX(completed_at)')) return [{ last_completion_date: new Date().toISOString() }];
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.healthy).toBe(false);
    expect(body.flags).toContain('no_activity');
  });

  it('flags overdue_pressure when > 3 overdue tasks', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(updated_at)')) return [{ last_note_date: new Date().toISOString() }];
      if (sql.includes('open_tasks')) return [{ open_tasks: 5, overdue_tasks: 4 }];
      if (sql.includes('MAX(completed_at)')) return [{ last_completion_date: new Date().toISOString() }];
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.flags).toContain('overdue_pressure');
  });

  it('flags stalled when no completion in 14 days and project is active', async () => {
    vi.mocked(queryAll).mockImplementation(async (sql: string) => {
      if (sql.includes('MAX(updated_at)')) return [{ last_note_date: new Date().toISOString() }];
      if (sql.includes('open_tasks')) return [{ open_tasks: 0, overdue_tasks: 0 }];
      if (sql.includes('MAX(completed_at)')) {
        const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
        return [{ last_completion_date: old }];
      }
      return [];
    });

    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    const body = await res.json();

    expect(body.flags).toContain('stalled');
  });

  it('does not call LLM when healthy', async () => {
    await GET(makeRequest('proj-1'), makeParams('proj-1'));
    expect(complete).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null);
    const res = await GET(makeRequest('proj-1'), makeParams('proj-1'));
    expect(res.status).toBe(404);
  });
});
```

### Step 2: Run to verify it fails

```bash
npx vitest run tests/lib/projects/health.test.ts
```
Expected: FAIL — module not found

### Step 3: Create the health route

Create `src/app/api/projects/[id]/health/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db, queryOne, queryAll } from '@/lib/db/client';
import { getCurrentUser } from '@/lib/auth';
import { complete, DEFAULT_MODEL } from '@/lib/ai/client';
import { createHash } from 'crypto';

interface HealthResult {
  healthy: boolean;
  flags: string[];
  severity: 'healthy' | 'warning' | 'at-risk';
  summary: string | null;
  stats: {
    openTasks: number;
    overdueTasks: number;
    lastNoteDate: string | null;
    lastCompletionDate: string | null;
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const project = await queryOne<{ id: string; name: string; status: string }>(
    'SELECT id, name, status FROM projects WHERE id = ? AND user_id = ?',
    [id, user.id]
  );
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Run health queries in parallel
  const [noteRows, taskRows, completionRows] = await Promise.all([
    queryAll<{ last_note_date: string | null }>(
      'SELECT MAX(updated_at) as last_note_date FROM notes WHERE project_id = ?',
      [id]
    ),
    queryAll<{ open_tasks: number; overdue_tasks: number }>(
      `SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) as open_tasks,
        COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled') AND due_date < datetime('now')) as overdue_tasks
       FROM tasks WHERE project_id = ?`,
      [id]
    ),
    queryAll<{ last_completion_date: string | null }>(
      "SELECT MAX(completed_at) as last_completion_date FROM tasks WHERE project_id = ? AND status = 'completed'",
      [id]
    ),
  ]);

  const lastNoteDate = noteRows[0]?.last_note_date ?? null;
  const openTasks = taskRows[0]?.open_tasks ?? 0;
  const overdueTasks = taskRows[0]?.overdue_tasks ?? 0;
  const lastCompletionDate = completionRows[0]?.last_completion_date ?? null;

  // Evaluate rules
  const flags: string[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  if ((!lastNoteDate || new Date(lastNoteDate) < sevenDaysAgo) && openTasks > 0) {
    flags.push('no_activity');
  }
  if (overdueTasks > 3) {
    flags.push('overdue_pressure');
  }
  if (project.status === 'active' && (!lastCompletionDate || new Date(lastCompletionDate) < fourteenDaysAgo)) {
    flags.push('stalled');
  }

  const healthy = flags.length === 0;
  const severity: HealthResult['severity'] = healthy ? 'healthy'
    : flags.includes('stalled') ? 'at-risk'
    : 'warning';

  const stats = { openTasks, overdueTasks, lastNoteDate, lastCompletionDate };

  // Update insight record
  if (healthy) {
    // Dismiss any existing health insight for this project
    await db.execute({
      sql: `UPDATE insights SET is_dismissed = TRUE
            WHERE user_id = ? AND insight_type = 'gap' AND json_extract(metadata, '$.project_id') = ?`,
      args: [user.id, id],
    });
    return NextResponse.json({ healthy: true, flags: [], severity: 'healthy', summary: null, stats });
  }

  // At-risk: get or generate AI summary
  const flagHash = [...flags].sort().join(',');
  const cacheKey = `health:${id}:${createHash('sha256').update(flagHash).digest('hex').slice(0, 8)}`;
  let summary: string | null = null;

  const cached = await queryOne<{ output: string }>(
    "SELECT output FROM ai_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [cacheKey]
  );
  if (cached) {
    summary = cached.output;
  } else {
    try {
      const flagDescriptions = {
        no_activity: `no notes updated in ${lastNoteDate ? Math.floor((Date.now() - new Date(lastNoteDate).getTime()) / 86400000) : '7+'} days`,
        overdue_pressure: `${overdueTasks} overdue tasks`,
        stalled: `no task completed in ${lastCompletionDate ? Math.floor((Date.now() - new Date(lastCompletionDate).getTime()) / 86400000) : '14+'} days`,
      };
      const flagText = flags.map(f => flagDescriptions[f as keyof typeof flagDescriptions]).join('; ');
      summary = await complete(
        `Project "${project.name}" has issues: ${flagText}. Write one sentence summarizing the health risk for the project owner. Be direct and actionable.`,
        { model: DEFAULT_MODEL, maxTokens: 100, temperature: 0.4 }
      );

      // Cache for 48h
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      await db.execute({
        sql: `INSERT OR REPLACE INTO ai_cache
              (user_id, cache_key, operation_type, tier, model, input_hash, output, expires_at)
              VALUES (?, ?, 'project_health', 'full_llm', ?, ?, ?, ?)`,
        args: [user.id, cacheKey, DEFAULT_MODEL, flagHash, summary, expiresAt],
      });
    } catch {
      // LLM failure is non-blocking — card renders without summary
    }
  }

  // Upsert insight for dashboard feed
  const insightTitle = `${project.name} needs attention`;
  const insightContent = summary || `Health flags: ${flags.join(', ')}`;
  const metadata = JSON.stringify({ project_id: id, health_flags: flags, project_name: project.name });

  const existingInsight = await queryOne<{ id: string }>(
    `SELECT id FROM insights WHERE user_id = ? AND insight_type = 'gap' AND json_extract(metadata, '$.project_id') = ?`,
    [user.id, id]
  );

  if (existingInsight) {
    await db.execute({
      sql: `UPDATE insights SET title = ?, content = ?, is_dismissed = FALSE, generated_at = datetime('now'), metadata = ?
            WHERE id = ?`,
      args: [insightTitle, insightContent, metadata, existingInsight.id],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO insights (user_id, insight_type, title, content, metadata, confidence)
            VALUES (?, 'gap', ?, ?, ?, 0.9)`,
      args: [user.id, insightTitle, insightContent, metadata],
    });
  }

  return NextResponse.json({ healthy: false, flags, severity, summary, stats });
}
```

### Step 4: Run tests

```bash
npx vitest run tests/lib/projects/health.test.ts
```
Expected: all passing

### Step 5: Commit

```bash
git add src/app/api/projects/[id]/health/route.ts tests/lib/projects/health.test.ts
git commit -m "feat: add project health API with rule-based checks and AI summary"
```

---

## Task 5: `ProjectHealthCard` component

**Files:**
- Create: `src/components/projects/project-health-card.tsx`

### Step 1: Create the component

No unit test needed for this UI component (tested manually). Create `src/components/projects/project-health-card.tsx`:

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface HealthData {
  healthy: boolean;
  flags: string[];
  severity: 'healthy' | 'warning' | 'at-risk';
  summary: string | null;
  stats: {
    openTasks: number;
    overdueTasks: number;
    lastNoteDate: string | null;
    lastCompletionDate: string | null;
  };
}

const FLAG_LABELS: Record<string, string> = {
  no_activity: 'No notes updated in 7+ days',
  overdue_pressure: 'More than 3 overdue tasks',
  stalled: 'No tasks completed in 14+ days',
};

interface ProjectHealthCardProps {
  projectId: string;
}

export function ProjectHealthCard({ projectId }: ProjectHealthCardProps) {
  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ['project-health', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/health`);
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });

  if (isLoading || !data || data.healthy) return null;

  const isAtRisk = data.severity === 'at-risk';
  const Icon = isAtRisk ? AlertCircle : AlertTriangle;
  const badgeClass = isAtRisk
    ? 'bg-red-500 text-white'
    : 'bg-amber-500 text-white';
  const cardClass = isAtRisk
    ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
    : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20';

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${isAtRisk ? 'text-red-500' : 'text-amber-500'}`} />
          <span className="font-medium text-sm">Project Health</span>
        </div>
        <Badge className={badgeClass}>
          {data.severity}
        </Badge>
      </div>

      <ul className="space-y-1">
        {data.flags.map((flag) => (
          <li key={flag} className="text-sm text-muted-foreground flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-current shrink-0" />
            {FLAG_LABELS[flag] ?? flag}
          </li>
        ))}
      </ul>

      {data.summary && (
        <p className="text-sm leading-relaxed border-t pt-3">
          {data.summary}
        </p>
      )}
    </div>
  );
}
```

### Step 2: Verify TypeScript

```bash
npm run typecheck 2>&1 | grep -i "project-health-card" | head -10
```
Expected: no errors

### Step 3: Commit

```bash
git add src/components/projects/project-health-card.tsx
git commit -m "feat: add ProjectHealthCard component"
```

---

## Task 6: Wire `ProjectHealthCard` into the project detail page

**Files:**
- Modify: `src/app/(dashboard)/projects/[slug]/page.tsx`

### Step 1: Add import and render

At the top of `src/app/(dashboard)/projects/[slug]/page.tsx`, add:
```typescript
import { ProjectHealthCard } from '@/components/projects/project-health-card';
```

In the JSX, just before the `{/* Stats Overview */}` block (the first `CollapsibleSection` around line 551), add:
```typescript
{/* Project Health */}
<ProjectHealthCard projectId={project.id} />
```

### Step 2: Verify TypeScript

```bash
npm run typecheck 2>&1 | head -20
```
Expected: no errors

### Step 3: Run full test suite

```bash
npm test 2>&1 | tail -20
```
Expected: same 10 pre-existing failures, no new failures

### Step 4: Commit

```bash
git add src/app/(dashboard)/projects/[slug]/page.tsx
git commit -m "feat: add project health card to project detail page"
```

---

## Task 7: Final verification and finish

### Step 1: Run all tests

```bash
npm test 2>&1 | tail -30
```
Expected: same 10 pre-existing failures, no new regressions, new tests all pass

### Step 2: TypeScript clean

```bash
npm run typecheck
```
Expected: no errors

### Step 3: Invoke finishing-a-development-branch skill

Use superpowers:finishing-a-development-branch to present merge/PR options.
