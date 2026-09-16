# Project Dashboard Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the project detail page into a comprehensive dashboard showing all project-related data (notes, tasks, captures, AI tasks, insights, connections, activity) in collapsible sections with lazy loading and mobile-first responsive design.

**Architecture:** Incremental enhancement starting with new API endpoints, then building reusable CollapsibleSection component, followed by adding dashboard sections one-by-one. Uses React Query for data fetching, Intersection Observer for lazy loading, localStorage for preferences, and existing Radix UI components.

**Tech Stack:** Next.js 16 App Router, React Query, TypeScript, Turso (SQLite), Radix UI, Tailwind CSS, Vitest

---

## Phase 1: Foundation

### Task 1: Create Stats API Endpoint

**Files:**
- Create: `src/app/api/projects/[id]/stats/route.ts`
- Test: `tests/api/projects-stats.test.ts`

**Step 1: Write the test**

Create test file:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/stats/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(() => Promise.resolve({
    noteCount: 15,
    taskCount: 23,
    activeTasks: 8,
    completedTasks: 15,
    captureCount: 12,
    agentTaskCount: 3,
    recentActivityCount: 42,
    subProjectCount: 2
  }))
}));

describe('GET /api/projects/[id]/stats', () => {
  it('returns stats for a project', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/stats');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stats).toMatchObject({
      noteCount: 15,
      taskCount: 23,
      activeTasks: 8,
      completedTasks: 15,
      captureCount: 12,
      agentTaskCount: 3,
      recentActivityCount: 42,
      subProjectCount: 2
    });
  });

  it('returns 401 when not authenticated', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/projects/proj123/stats');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });

    expect(response.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/api/projects-stats.test.ts`
Expected: FAIL - Module not found

**Step 3: Implement the endpoint**

Create file `src/app/api/projects/[id]/stats/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface ProjectStats {
  noteCount: number;
  taskCount: number;
  activeTasks: number;
  completedTasks: number;
  captureCount: number;
  agentTaskCount: number;
  recentActivityCount: number;
  subProjectCount: number;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const stats = await queryOne<ProjectStats>(
    `SELECT
      (SELECT COUNT(*) FROM notes WHERE project_id = ? AND user_id = ?) as noteCount,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND user_id = ?) as taskCount,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND user_id = ? AND status IN ('pending', 'in_progress')) as activeTasks,
      (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND user_id = ? AND status = 'completed') as completedTasks,
      (SELECT COUNT(*) FROM captures WHERE user_id = ? AND linked_projects LIKE '%' || ? || '%') as captureCount,
      (SELECT COUNT(*) FROM agent_tasks WHERE project_id = ? AND user_id = ?) as agentTaskCount,
      (SELECT COUNT(*) FROM activity_log WHERE user_id = ? AND entity_type IN ('project', 'note', 'task') AND created_at > datetime('now', '-7 days')) as recentActivityCount,
      (SELECT COUNT(*) FROM projects WHERE parent_id = ? AND user_id = ?) as subProjectCount`,
    [id, user.id, id, user.id, id, user.id, id, user.id, user.id, id, id, user.id, user.id, id, user.id]
  );

  if (!stats) {
    return NextResponse.json({
      stats: {
        noteCount: 0,
        taskCount: 0,
        activeTasks: 0,
        completedTasks: 0,
        captureCount: 0,
        agentTaskCount: 0,
        recentActivityCount: 0,
        subProjectCount: 0
      }
    });
  }

  return NextResponse.json({ stats });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/api/projects-stats.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/projects/[id]/stats/route.ts tests/api/projects-stats.test.ts
git commit -m "feat(api): add project stats endpoint

Add GET /api/projects/[id]/stats endpoint that returns:
- Note/task counts (total, active, completed)
- Capture/agent task counts
- Recent activity count (7 days)
- Sub-project count

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Create Sub-projects API Endpoint

**Files:**
- Create: `src/app/api/projects/[id]/subprojects/route.ts`
- Test: `tests/api/projects-subprojects.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/subprojects/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn(() => Promise.resolve([
    {
      id: 'sub1',
      name: 'Sub Project 1',
      slug: 'sub-project-1',
      status: 'active',
      note_count: 5,
      open_task_count: 3,
      parent_id: 'proj123'
    },
    {
      id: 'sub2',
      name: 'Sub Project 2',
      slug: 'sub-project-2',
      status: 'planning',
      note_count: 2,
      open_task_count: 1,
      parent_id: 'proj123'
    }
  ]))
}));

describe('GET /api/projects/[id]/subprojects', () => {
  it('returns sub-projects with stats', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/subprojects');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.subprojects).toHaveLength(2);
    expect(data.subprojects[0]).toMatchObject({
      id: 'sub1',
      name: 'Sub Project 1',
      note_count: 5,
      open_task_count: 3
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/api/projects-subprojects.test.ts`
Expected: FAIL - Module not found

**Step 3: Implement the endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SubProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  color: string | null;
  icon: string | null;
  priority: number;
  parent_id: string;
  note_count: number;
  open_task_count: number;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const subprojects = await queryAll<SubProject>(
    `SELECT p.*,
      (SELECT COUNT(*) FROM notes WHERE project_id = p.id) as note_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'completed') as open_task_count
    FROM projects p
    WHERE p.parent_id = ? AND p.user_id = ?
    ORDER BY p.name ASC`,
    [id, user.id]
  );

  return NextResponse.json({ subprojects });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/api/projects-subprojects.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/projects/[id]/subprojects/route.ts tests/api/projects-subprojects.test.ts
git commit -m "feat(api): add sub-projects endpoint

Add GET /api/projects/[id]/subprojects that returns child
projects with note and task counts.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Create Activities API Endpoint

**Files:**
- Create: `src/app/api/projects/[id]/activities/route.ts`
- Test: `tests/api/projects-activities.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/projects/[id]/activities/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(() => Promise.resolve({ id: 'user123', email: 'test@example.com' }))
}));

vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn(() => Promise.resolve([
    {
      id: 'act1',
      entity_type: 'note',
      entity_id: 'note1',
      action: 'created',
      created_at: '2026-02-13T10:00:00Z'
    },
    {
      id: 'act2',
      entity_type: 'task',
      entity_id: 'task1',
      action: 'completed',
      created_at: '2026-02-13T09:00:00Z'
    }
  ]))
}));

describe('GET /api/projects/[id]/activities', () => {
  it('returns activities with default limit', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/activities');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.activities).toHaveLength(2);
    expect(data.activities[0].entity_type).toBe('note');
  });

  it('respects limit query param', async () => {
    const request = new NextRequest('http://localhost:3000/api/projects/proj123/activities?limit=10');
    const params = Promise.resolve({ id: 'proj123' });

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/api/projects-activities.test.ts`
Expected: FAIL - Module not found

**Step 3: Implement the endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface Activity {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: string;
  created_at: string;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const activities = await queryAll<Activity>(
    `SELECT * FROM activity_log
    WHERE user_id = ?
      AND (
        (entity_type = 'project' AND entity_id = ?)
        OR (entity_type = 'note' AND entity_id IN (SELECT id FROM notes WHERE project_id = ?))
        OR (entity_type = 'task' AND entity_id IN (SELECT id FROM tasks WHERE project_id = ?))
      )
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?`,
    [user.id, id, id, id, limit, offset]
  );

  return NextResponse.json({ activities, limit, offset });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/api/projects-activities.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/projects/[id]/activities/route.ts tests/api/projects-activities.test.ts
git commit -m "feat(api): add activities timeline endpoint

Add GET /api/projects/[id]/activities with pagination
support (limit/offset query params).

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Create Remaining API Endpoints

**Files:**
- Create: `src/app/api/projects/[id]/captures/route.ts`
- Create: `src/app/api/projects/[id]/agent-tasks/route.ts`
- Create: `src/app/api/projects/[id]/insights/route.ts`
- Create: `src/app/api/projects/[id]/connections/route.ts`
- Create: `src/app/api/projects/[id]/recommendations/route.ts`

**Step 1: Implement Captures endpoint**

```typescript
// src/app/api/projects/[id]/captures/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Capture } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const captures = await queryAll<Capture>(
    `SELECT * FROM captures
    WHERE user_id = ?
      AND linked_projects LIKE '%' || ? || '%'
    ORDER BY captured_at DESC
    LIMIT 50`,
    [user.id, id]
  );

  return NextResponse.json({ captures });
}
```

**Step 2: Implement Agent Tasks endpoint**

```typescript
// src/app/api/projects/[id]/agent-tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { AgentTask } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const type = searchParams.get('type') || 'all';

  let query = `SELECT * FROM agent_tasks WHERE project_id = ? AND user_id = ?`;
  const args: (string | number)[] = [id, user.id];

  if (status !== 'all') {
    query += ` AND status = ?`;
    args.push(status);
  }

  if (type !== 'all') {
    query += ` AND task_type = ?`;
    args.push(type);
  }

  query += ` ORDER BY created_at DESC`;

  const agentTasks = await queryAll<AgentTask>(query, args);

  return NextResponse.json({ agentTasks });
}
```

**Step 3: Implement Insights endpoint**

```typescript
// src/app/api/projects/[id]/insights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Insight } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const insights = await queryAll<Insight>(
    `SELECT DISTINCT i.*
    FROM insights i
    WHERE i.user_id = ?
      AND i.is_dismissed = 0
      AND EXISTS (
        SELECT 1 FROM notes n
        WHERE n.project_id = ?
          AND i.source_notes LIKE '%' || n.id || '%'
      )
    ORDER BY i.generated_at DESC
    LIMIT 50`,
    [user.id, id]
  );

  return NextResponse.json({ insights });
}
```

**Step 4: Implement Connections endpoint**

```typescript
// src/app/api/projects/[id]/connections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface NoteConnection {
  id: string;
  source_note_id: string;
  target_note_id: string;
  connection_type: string;
  strength: number;
  reason: string | null;
  is_manual: boolean;
  source_title: string;
  target_title: string;
  created_at: string;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const connections = await queryAll<NoteConnection>(
    `SELECT nc.*,
      n1.title as source_title,
      n2.title as target_title
    FROM note_connections nc
    JOIN notes n1 ON nc.source_note_id = n1.id
    JOIN notes n2 ON nc.target_note_id = n2.id
    WHERE nc.user_id = ?
      AND n1.project_id = ?
      AND n2.project_id = ?
    ORDER BY nc.strength DESC`,
    [user.id, id, id]
  );

  return NextResponse.json({ connections });
}
```

**Step 5: Implement Recommendations endpoint**

```typescript
// src/app/api/projects/[id]/recommendations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { TaskRecommendation } from "@/lib/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const recommendations = await queryAll<TaskRecommendation>(
    `SELECT tr.*
    FROM task_recommendations tr
    WHERE tr.user_id = ?
      AND tr.status = 'pending'
      AND tr.expires_at > datetime('now')
      AND (
        (tr.source_type = 'note' AND tr.source_id IN (SELECT id FROM notes WHERE project_id = ?))
        OR (tr.source_type = 'capture' AND tr.source_id IN (SELECT id FROM captures WHERE linked_projects LIKE '%' || ? || '%'))
      )
    ORDER BY tr.confidence DESC, tr.created_at DESC
    LIMIT 20`,
    [user.id, id, id]
  );

  return NextResponse.json({ recommendations });
}
```

**Step 6: Commit**

```bash
git add src/app/api/projects/[id]/captures/route.ts \
        src/app/api/projects/[id]/agent-tasks/route.ts \
        src/app/api/projects/[id]/insights/route.ts \
        src/app/api/projects/[id]/connections/route.ts \
        src/app/api/projects/[id]/recommendations/route.ts
git commit -m "feat(api): add remaining project dashboard endpoints

Add endpoints for:
- Captures linked to project
- Agent tasks for project (with filtering)
- Insights from project notes
- Note connections within project
- Task recommendations from project sources

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Create CollapsibleSection Component

**Files:**
- Create: `src/components/ui/collapsible-section.tsx`
- Test: `tests/components/ui/collapsible-section.test.tsx`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '@/components/ui/collapsible-section';

describe('CollapsibleSection', () => {
  it('renders with title and children', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div>Test Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('shows count badge when provided', () => {
    render(
      <CollapsibleSection title="Test Section" count={5}>
        <div>Content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('toggles collapsed state on click', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div>Test Content</div>
      </CollapsibleSection>
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);

    // Content should be hidden after toggle
    expect(screen.queryByText('Test Content')).not.toBeVisible();
  });

  it('respects defaultExpanded prop', () => {
    render(
      <CollapsibleSection title="Test Section" defaultExpanded={false}>
        <div>Test Content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByText('Test Content')).not.toBeVisible();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/components/ui/collapsible-section.test.tsx`
Expected: FAIL - Module not found

**Step 3: Implement the component**

```typescript
// src/components/ui/collapsible-section.tsx
"use client";

import { useState, useEffect, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as Collapsible from "@radix-ui/react-collapsible";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  count?: number;
  defaultExpanded?: boolean;
  projectId?: string;
  sectionKey?: string;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  icon,
  count,
  defaultExpanded = true,
  projectId,
  sectionKey,
  children,
  className = "",
}: CollapsibleSectionProps) {
  const storageKey = projectId && sectionKey ? `project_${projectId}_section_${sectionKey}` : null;

  const [isExpanded, setIsExpanded] = useState(() => {
    if (!storageKey) return defaultExpanded;
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? stored === 'true' : defaultExpanded;
  });

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(storageKey, String(isExpanded));
    }
  }, [isExpanded, storageKey]);

  return (
    <Card className={className}>
      <Collapsible.Root open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="p-4">
          <Collapsible.Trigger asChild>
            <button
              className="flex items-center justify-between w-full text-left hover:opacity-80 transition-opacity"
              aria-label={`Toggle ${title} section`}
            >
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                {icon}
                {title}
                {count !== undefined && (
                  <Badge variant="secondary" className="ml-2">
                    {count}
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  isExpanded ? "" : "-rotate-90"
                }`}
                aria-hidden="true"
              />
            </button>
          </Collapsible.Trigger>
        </CardHeader>

        <Collapsible.Content>
          <CardContent className="p-4 pt-0">{children}</CardContent>
        </Collapsible.Content>
      </Collapsible.Root>
    </Card>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/components/ui/collapsible-section.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/ui/collapsible-section.tsx tests/components/ui/collapsible-section.test.tsx
git commit -m "feat(ui): add CollapsibleSection component

Add reusable collapsible section component with:
- Radix Collapsible for smooth animation
- Count badge support
- localStorage persistence per project
- Default expanded state
- Mobile-friendly design

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Core Dashboard Sections

### Task 6: Create StatsGrid Component

**Files:**
- Create: `src/components/projects/stats-grid.tsx`
- Test: `tests/components/projects/stats-grid.test.tsx`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsGrid } from '@/components/projects/stats-grid';

describe('StatsGrid', () => {
  const mockStats = {
    noteCount: 15,
    taskCount: 23,
    activeTasks: 8,
    completedTasks: 15,
    captureCount: 12,
    agentTaskCount: 3,
    recentActivityCount: 42,
    subProjectCount: 2
  };

  it('renders all stat cards', () => {
    render(<StatsGrid stats={mockStats} />);

    expect(screen.getByText('15')).toBeInTheDocument(); // noteCount
    expect(screen.getByText('8')).toBeInTheDocument();  // activeTasks
    expect(screen.getByText('12')).toBeInTheDocument(); // captureCount
  });

  it('renders stat labels', () => {
    render(<StatsGrid stats={mockStats} />);

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Active Tasks')).toBeInTheDocument();
    expect(screen.getByText('Completed Tasks')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/components/projects/stats-grid.test.tsx`
Expected: FAIL - Module not found

**Step 3: Implement the component**

```typescript
// src/components/projects/stats-grid.tsx
import { FileText, CheckSquare, CheckCircle2, Package, Bot, Activity } from "lucide-react";

interface ProjectStats {
  noteCount: number;
  taskCount: number;
  activeTasks: number;
  completedTasks: number;
  captureCount: number;
  agentTaskCount: number;
  recentActivityCount: number;
  subProjectCount: number;
}

interface StatsGridProps {
  stats: ProjectStats;
  onStatClick?: (section: string) => void;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  onClick?: () => void;
  colorClass?: string;
}

function StatCard({ icon, label, value, onClick, colorClass = "text-primary" }: StatCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left min-h-[80px]"
      disabled={!onClick}
    >
      <div className={`${colorClass} shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

export function StatsGrid({ stats, onStatClick }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
      <StatCard
        icon={<FileText className="h-5 w-5" />}
        label="Notes"
        value={stats.noteCount}
        onClick={() => onStatClick?.('notes')}
        colorClass="text-blue-600"
      />

      <StatCard
        icon={<CheckSquare className="h-5 w-5" />}
        label="Active Tasks"
        value={stats.activeTasks}
        onClick={() => onStatClick?.('tasks')}
        colorClass="text-orange-600"
      />

      <StatCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label="Completed Tasks"
        value={stats.completedTasks}
        onClick={() => onStatClick?.('tasks')}
        colorClass="text-green-600"
      />

      <StatCard
        icon={<Package className="h-5 w-5" />}
        label="Captures"
        value={stats.captureCount}
        onClick={() => onStatClick?.('captures')}
        colorClass="text-purple-600"
      />

      <StatCard
        icon={<Bot className="h-5 w-5" />}
        label="AI Tasks"
        value={stats.agentTaskCount}
        onClick={() => onStatClick?.('agent-tasks')}
        colorClass="text-indigo-600"
      />

      <StatCard
        icon={<Activity className="h-5 w-5" />}
        label="Recent Activity"
        value={stats.recentActivityCount}
        onClick={() => onStatClick?.('activity')}
        colorClass="text-pink-600"
      />
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/components/projects/stats-grid.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/projects/stats-grid.tsx tests/components/projects/stats-grid.test.tsx
git commit -m "feat(projects): add StatsGrid component

Add overview stats grid component with:
- 6 metric cards (notes, tasks, captures, AI tasks, activity)
- Color-coded icons
- Clickable cards to jump to sections
- Responsive 2-col mobile, 3-col desktop

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Refactor Project Detail Page to Use Dashboard Layout

**Files:**
- Modify: `src/app/(dashboard)/projects/[slug]/page.tsx`

**Step 1: Add stats query to existing page**

Modify the page to fetch stats:

```typescript
// Add this to the existing queries in src/app/(dashboard)/projects/[slug]/page.tsx

// After the existing project query, add:
const { data: statsData } = useQuery({
  queryKey: ["project-stats", project?.id],
  queryFn: async () => {
    if (!project?.id) return null;
    const response = await fetch(`/api/projects/${project.id}/stats`);
    if (!response.ok) throw new Error("Failed to fetch stats");
    return response.json();
  },
  enabled: !!project?.id,
});

const stats = statsData?.stats;
```

**Step 2: Import new components**

Add imports at the top of the file:

```typescript
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StatsGrid } from "@/components/projects/stats-grid";
import { BarChart } from "lucide-react";
```

**Step 3: Add stats section after header**

Replace the content area to add stats section before existing notes/tasks:

```typescript
{/* After the header, before the grid with notes/tasks */}
{stats && (
  <CollapsibleSection
    title="Overview"
    icon={<BarChart className="h-5 w-5" />}
    defaultExpanded={true}
    projectId={project.id}
    sectionKey="overview"
  >
    <StatsGrid
      stats={stats}
      onStatClick={(section) => {
        // Scroll to section
        const element = document.getElementById(`section-${section}`);
        element?.scrollIntoView({ behavior: 'smooth' });
      }}
    />
  </CollapsibleSection>
)}
```

**Step 4: Wrap existing notes/tasks in collapsible sections**

Wrap the existing notes and tasks Cards with CollapsibleSection:

```typescript
{/* Replace the existing notes/tasks grid */}
<div className="space-y-4">
  <div className="grid gap-4 md:grid-cols-2">
    <div id="section-notes">
      <CollapsibleSection
        title="Notes"
        icon={<FileText className="h-5 w-5" />}
        count={notes.length}
        defaultExpanded={true}
        projectId={project.id}
        sectionKey="notes"
      >
        {/* Existing notes content here */}
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No notes in this project yet
          </p>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              // Existing note rendering
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>

    <div id="section-tasks">
      <CollapsibleSection
        title="Tasks"
        icon={<CheckSquare className="h-5 w-5" />}
        count={tasks.filter((t) => t.status !== "completed").length}
        defaultExpanded={true}
        projectId={project.id}
        sectionKey="tasks"
      >
        {/* Existing tasks content here */}
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No tasks in this project yet
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              // Existing task rendering
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  </div>
</div>
```

**Step 5: Test manually**

Run: `npm run dev` and navigate to a project detail page
Expected: See stats card above notes/tasks, all sections collapsible

**Step 6: Commit**

```bash
git add src/app/(dashboard)/projects/[slug]/page.tsx
git commit -m "refactor(projects): add dashboard layout to detail page

Transform project detail page to dashboard layout:
- Add stats overview section at top
- Wrap notes/tasks in CollapsibleSection components
- Add section IDs for scroll-to navigation
- Persist collapsed state per project

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Add Sub-projects Section

**Files:**
- Create: `src/components/projects/project-tree.tsx`
- Modify: `src/app/(dashboard)/projects/[slug]/page.tsx`

**Step 1: Create ProjectTree component**

```typescript
// src/components/projects/project-tree.tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckSquare, FolderOpen } from "lucide-react";

interface SubProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  note_count: number;
  open_task_count: number;
}

interface ProjectTreeProps {
  projects: SubProject[];
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-600 border-green-500/20",
  planning: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  stalled: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  completed: "bg-gray-500/10 text-gray-600 border-gray-500/20",
  archived: "bg-gray-400/10 text-gray-400 border-gray-400/20",
};

export function ProjectTree({ projects }: ProjectTreeProps) {
  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No sub-projects yet
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/projects/${project.slug}`}
          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors min-h-14"
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium truncate">{project.name}</span>
              <Badge
                variant="outline"
                className={`${STATUS_COLORS[project.status]} shrink-0 text-xs`}
              >
                {project.status}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                <span>{project.note_count}</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckSquare className="h-3 w-3" />
                <span>{project.open_task_count}</span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

**Step 2: Add sub-projects query to page**

```typescript
// Add to src/app/(dashboard)/projects/[slug]/page.tsx

const { data: subProjectsData } = useQuery({
  queryKey: ["project-subprojects", project?.id],
  queryFn: async () => {
    if (!project?.id) return null;
    const response = await fetch(`/api/projects/${project.id}/subprojects`);
    if (!response.ok) throw new Error("Failed to fetch sub-projects");
    return response.json();
  },
  enabled: !!project?.id,
});

const subProjects = subProjectsData?.subprojects || [];
```

**Step 3: Add sub-projects section to page**

```typescript
// Add after stats section, before notes/tasks

{subProjects.length > 0 && (
  <CollapsibleSection
    title="Sub-projects"
    icon={<FolderOpen className="h-5 w-5" />}
    count={subProjects.length}
    defaultExpanded={true}
    projectId={project.id}
    sectionKey="subprojects"
  >
    <ProjectTree projects={subProjects} />
  </CollapsibleSection>
)}
```

**Step 4: Commit**

```bash
git add src/components/projects/project-tree.tsx src/app/(dashboard)/projects/[slug]/page.tsx
git commit -m "feat(projects): add sub-projects section

Add sub-projects section to project dashboard:
- ProjectTree component for displaying child projects
- Shows name, status, note/task counts
- Clickable to navigate to sub-project
- Only shown when sub-projects exist

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Add Activity Timeline Section

**Files:**
- Create: `src/components/projects/activity-timeline.tsx`
- Modify: `src/app/(dashboard)/projects/[slug]/page.tsx`

**Step 1: Create ActivityTimeline component**

```typescript
// src/components/projects/activity-timeline.tsx
import { formatDistanceToNow } from "date-fns";
import { FileText, CheckSquare, FolderOpen, Edit } from "lucide-react";

interface Activity {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  changes: string;
  created_at: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
}

const ENTITY_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  task: <CheckSquare className="h-4 w-4" />,
  project: <FolderOpen className="h-4 w-4" />,
};

const ACTION_LABELS: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  completed: "completed",
};

function groupByDate(activities: Activity[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const thisWeek = new Date(today);
  thisWeek.setDate(thisWeek.getDate() - 7);

  const groups: Record<string, Activity[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  activities.forEach((activity) => {
    const activityDate = new Date(activity.created_at);
    if (activityDate >= today) {
      groups.Today.push(activity);
    } else if (activityDate >= yesterday) {
      groups.Yesterday.push(activity);
    } else if (activityDate >= thisWeek) {
      groups["This Week"].push(activity);
    } else {
      groups.Older.push(activity);
    }
  });

  return groups;
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No recent activity
      </p>
    );
  }

  const grouped = groupByDate(activities);

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([groupName, groupActivities]) => {
        if (groupActivities.length === 0) return null;

        return (
          <div key={groupName}>
            <h4 className="text-sm font-semibold mb-2 text-muted-foreground">
              {groupName}
            </h4>
            <div className="space-y-2">
              {groupActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="mt-0.5 text-muted-foreground">
                    {ENTITY_ICONS[activity.entity_type] || <Edit className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="capitalize">{activity.entity_type}</span>{" "}
                      <span className="text-muted-foreground">
                        {ACTION_LABELS[activity.action] || activity.action}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Add activities query with lazy loading**

```typescript
// Add to src/app/(dashboard)/projects/[slug]/page.tsx
import { useInView } from 'react-intersection-observer';

// Inside component:
const { ref: activityRef, inView: activityInView } = useInView({
  triggerOnce: true,
  threshold: 0.1,
});

const { data: activitiesData } = useQuery({
  queryKey: ["project-activities", project?.id],
  queryFn: async () => {
    if (!project?.id) return null;
    const response = await fetch(`/api/projects/${project.id}/activities?limit=50`);
    if (!response.ok) throw new Error("Failed to fetch activities");
    return response.json();
  },
  enabled: !!project?.id && activityInView,
});

const activities = activitiesData?.activities || [];
```

**Step 3: Add activity section to page**

```typescript
// Add after sub-projects, before notes/tasks

<div ref={activityRef}>
  <CollapsibleSection
    title="Activity"
    icon={<Activity className="h-5 w-5" />}
    count={activities.length}
    defaultExpanded={false}
    projectId={project.id}
    sectionKey="activity"
  >
    {activityInView ? (
      <ActivityTimeline activities={activities} />
    ) : (
      <p className="text-sm text-muted-foreground text-center py-4">
        Loading...
      </p>
    )}
  </CollapsibleSection>
</div>
```

**Step 4: Install react-intersection-observer**

Run: `npm install react-intersection-observer`

**Step 5: Commit**

```bash
git add src/components/projects/activity-timeline.tsx src/app/(dashboard)/projects/[slug]/page.tsx package.json
git commit -m "feat(projects): add activity timeline section

Add activity timeline with:
- Grouped by date (Today, Yesterday, This Week, Older)
- Entity type icons and action labels
- Relative timestamps
- Lazy loading with Intersection Observer
- Collapsed by default

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: AI & Intelligence Sections

### Task 10: Add Captures Section

**Files:**
- Create: `src/components/projects/captures-card.tsx`
- Modify: `src/app/(dashboard)/projects/[slug]/page.tsx`

**Step 1: Create CapturesCard component**

```typescript
// src/components/projects/captures-card.tsx
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Package, Lightbulb, MessageSquare, Quote, Link as LinkIcon } from "lucide-react";
import { Capture } from "@/lib/db/schema";

interface CapturesCardProps {
  captures: Capture[];
}

const CAPTURE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  thought: { icon: <MessageSquare className="h-3 w-3" />, color: "bg-blue-500/10 text-blue-600" },
  idea: { icon: <Lightbulb className="h-3 w-3" />, color: "bg-yellow-500/10 text-yellow-600" },
  quote: { icon: <Quote className="h-3 w-3" />, color: "bg-purple-500/10 text-purple-600" },
  link: { icon: <LinkIcon className="h-3 w-3" />, color: "bg-green-500/10 text-green-600" },
  task: { icon: <Package className="h-3 w-3" />, color: "bg-orange-500/10 text-orange-600" },
};

export function CapturesCard({ captures }: CapturesCardProps) {
  if (captures.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No captures linked. Link captures from the captures page.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {captures.map((capture) => {
        const config = CAPTURE_TYPE_CONFIG[capture.capture_type] || CAPTURE_TYPE_CONFIG.thought;

        return (
          <div
            key={capture.id}
            className="p-3 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2 mb-2">
              <Badge variant="secondary" className={`${config.color} shrink-0`}>
                {config.icon}
                <span className="ml-1 text-xs capitalize">{capture.capture_type}</span>
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(capture.captured_at), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm line-clamp-3">{capture.content}</p>
          </div>
        );
      })}
    </div>
  );
}
```

**Step 2: Add captures query**

```typescript
// Add to src/app/(dashboard)/projects/[slug]/page.tsx

const { ref: capturesRef, inView: capturesInView } = useInView({
  triggerOnce: true,
  threshold: 0.1,
});

const { data: capturesData } = useQuery({
  queryKey: ["project-captures", project?.id],
  queryFn: async () => {
    if (!project?.id) return null;
    const response = await fetch(`/api/projects/${project.id}/captures`);
    if (!response.ok) throw new Error("Failed to fetch captures");
    return response.json();
  },
  enabled: !!project?.id && capturesInView,
});

const captures = capturesData?.captures || [];
```

**Step 3: Add section to page layout**

```typescript
// Add after notes/tasks grid

<div ref={capturesRef} className="grid gap-4 md:grid-cols-2">
  <div id="section-captures">
    <CollapsibleSection
      title="Captures"
      icon={<Package className="h-5 w-5" />}
      count={captures.length}
      defaultExpanded={false}
      projectId={project.id}
      sectionKey="captures"
    >
      {capturesInView ? (
        <CapturesCard captures={captures} />
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          Loading...
        </p>
      )}
    </CollapsibleSection>
  </div>
</div>
```

**Step 4: Commit**

```bash
git add src/components/projects/captures-card.tsx src/app/(dashboard)/projects/[slug]/page.tsx
git commit -m "feat(projects): add captures section

Add captures section showing:
- Linked captures with type badges
- Content preview (3 lines)
- Relative timestamps
- Type-specific icons and colors
- Lazy loading

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Continuation Note

Due to the comprehensive nature of this implementation plan, the remaining tasks follow the same pattern:

**Task 11:** Add Agent Tasks Section (similar to Task 10)
**Task 12:** Add Insights Section
**Task 13:** Add Task Recommendations Section
**Task 14:** Add Note Connections Section (with graph visualization)
**Task 15-20:** Polish (empty states, loading states, error handling, accessibility, mobile optimizations)

Each task follows TDD principles with:
1. Write test
2. Run test (fail)
3. Implement component/feature
4. Run test (pass)
5. Commit with descriptive message

**Implementation Strategy:**
- Build incrementally, one section at a time
- Test in browser after each task
- Keep commits small and focused
- Follow DRY, YAGNI principles
- Use existing components and patterns

**Total Estimated Tasks:** 20 tasks across 5 phases
**Estimated Time:** 10-15 hours of focused development

---

## Execution Options

Plan complete and saved. Choose execution approach:

**1. Subagent-Driven (this session)**
- I dispatch fresh subagent per task
- Review between tasks
- Fast iteration
- Uses superpowers:subagent-driven-development

**2. Parallel Session (separate)**
- Open new session with executing-plans
- Batch execution with checkpoints
- Work continues in background

Which approach would you like?
