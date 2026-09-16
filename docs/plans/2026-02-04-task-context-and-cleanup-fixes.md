# Task Context & AI Cleanup Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix AI cleanup target matching and add note/project context to all task displays

**Architecture:** Two parallel fixes - (1) fuzzy string matching for AI cleanup to prevent content appending, (2) inherit project_id from notes when creating tasks and show context badges across all task UIs

**Tech Stack:** Next.js 16, TypeScript, Turso SQLite, TanStack Query, shadcn/ui

---

## Task 1: Backend - Inherit Project from Note in Task Recommendations

**Files:**
- Modify: `src/app/api/tasks/recommendations/[id]/feedback/route.ts:47-74`

**Step 1: Update feedback route to fetch note's project_id**

In `src/app/api/tasks/recommendations/[id]/feedback/route.ts`, replace lines 47-74 with:

```typescript
if (feedback === 'accepted') {
  // Create the task
  const taskContent = editedTask || recommendation.recommended_task;

  // Get source note's project_id if this is from a note
  let projectId = null;
  if (recommendation.source_type === 'note') {
    const sourceNote = await queryOne<{ project_id: string | null }>(
      'SELECT project_id FROM notes WHERE id = ?',
      [recommendation.source_id]
    );
    projectId = sourceNote?.project_id || null;
  }

  await db.execute({
    sql: `INSERT INTO tasks (user_id, content, status, priority, note_id, project_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      user.id,
      taskContent,
      'pending',
      recommendation.priority,
      recommendation.source_type === 'note' ? recommendation.source_id : null,
      projectId
    ]
  });

  const task = await queryOne<Task>(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );

  // Update recommendation
  await db.execute({
    sql: `UPDATE task_recommendations
          SET status = ?, user_feedback = ?, feedback_at = ?, task_id = ?
          WHERE id = ?`,
    args: ['accepted', 'accepted', now, task?.id || null, id]
  });

  const updatedRec = await queryOne<TaskRecommendation>(
    'SELECT * FROM task_recommendations WHERE id = ?',
    [id]
  );

  return NextResponse.json({
    recommendation: updatedRec,
    task: task
  });
}
```

**Step 2: Test manually**

Create a task recommendation from a note that belongs to a project, accept it, verify the created task has project_id set.

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/[id]/feedback/route.ts
git commit -m "feat: inherit project_id from note when accepting task recommendations"
```

---

## Task 2: API - Add Note/Project Context to Task Recommendations

**Files:**
- Modify: `src/app/api/tasks/recommendations/route.ts:17-32`

**Step 1: Update GET query to JOIN with notes and projects**

In `src/app/api/tasks/recommendations/route.ts`, replace lines 17-32 with:

```typescript
let query = `
  SELECT
    tr.*,
    n.title as note_title,
    n.slug as note_slug,
    p.name as project_name,
    p.id as project_id
  FROM task_recommendations tr
  LEFT JOIN notes n ON tr.source_type = 'note' AND tr.source_id = n.id
  LEFT JOIN projects p ON n.project_id = p.id
  WHERE tr.user_id = ? AND tr.status = ?
`;
const args: (string | number)[] = [user.id, status];

if (sourceType) {
  query += ' AND tr.source_type = ?';
  args.push(sourceType);
}

query += ' ORDER BY tr.confidence DESC, tr.created_at DESC LIMIT ?';
args.push(limit);
```

**Step 2: Update TypeScript interface**

In `src/components/recommendations/recommendation-card.tsx`, update the `TaskRecommendation` interface (lines 13-23):

```typescript
interface TaskRecommendation {
  id: string;
  source_type: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: string;
  reasoning: string | null;
  status: string;
  created_at: string;
  note_title?: string;
  note_slug?: string;
  project_name?: string;
  project_id?: string;
}
```

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/route.ts src/components/recommendations/recommendation-card.tsx
git commit -m "feat: add note and project context to task recommendations API"
```

---

## Task 3: UI - Add Context Badges to Task Recommendations

**Files:**
- Modify: `src/components/recommendations/recommendation-card.tsx:1,202-204`

**Step 1: Add imports**

At the top of `src/components/recommendations/recommendation-card.tsx` (after line 1), add:

```typescript
import Link from "next/link";
import { FileText, FolderOpen } from "lucide-react";
```

**Step 2: Replace "From:" section with context badges**

Replace lines 202-204 with:

```typescript
<div className="flex flex-wrap items-center gap-1.5 text-xs pt-1">
  {recommendation.note_title && recommendation.note_slug && (
    <Link
      href={`/notes/${recommendation.note_slug}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Badge variant="outline" className="gap-1 hover:bg-muted cursor-pointer">
        <FileText className="h-3 w-3" />
        {recommendation.note_title}
      </Badge>
    </Link>
  )}
  {recommendation.project_name && (
    <Badge variant="outline" className="gap-1">
      <FolderOpen className="h-3 w-3" />
      {recommendation.project_name}
    </Badge>
  )}
  <span className="text-muted-foreground">
    {format(new Date(recommendation.created_at), "MMM d, h:mm a")}
  </span>
</div>
```

**Step 3: Test in browser**

Navigate to task recommendations, verify note and project badges appear with icons and correct styling.

**Step 4: Commit**

```bash
git add src/components/recommendations/recommendation-card.tsx
git commit -m "feat: add note and project context badges to task recommendations"
```

---

## Task 4: UI - Update Tasks List with Standardized Badges

**Files:**
- Modify: `src/app/(dashboard)/tasks/page.tsx:312-325`

**Step 1: Add FolderOpen import**

In `src/app/(dashboard)/tasks/page.tsx`, verify `FileText` and `FolderOpen` are imported from lucide-react. If not, update the import around line 17-40.

**Step 2: Replace project and note display with standardized badges**

Replace lines 312-325 with:

```typescript
{task.project_name && (
  <Badge variant="outline" className="text-[10px] lg:text-xs h-4 lg:h-5 gap-1">
    <FolderOpen className="h-3 w-3" />
    {task.project_name}
  </Badge>
)}
{task.note_slug && task.note_title && (
  <Link
    href={`/notes/${task.note_slug}`}
    onClick={(e) => e.stopPropagation()}
  >
    <Badge variant="outline" className="text-[10px] lg:text-xs h-4 lg:h-5 gap-1 hover:bg-muted cursor-pointer">
      <FileText className="h-3 w-3" />
      {task.note_title}
    </Badge>
  </Link>
)}
```

**Step 3: Test in browser**

Navigate to tasks page, verify project and note badges show with icons and match the style of recommendation cards.

**Step 4: Commit**

```bash
git add src/app/(dashboard)/tasks/page.tsx
git commit -m "feat: standardize task context badges with icons in tasks list"
```

---

## Task 5: API - Add Note/Project Context to Agent Tasks

**Files:**
- Modify: `src/app/api/agent-tasks/route.ts:17-43`

**Step 1: Update GET query to include task context**

In `src/app/api/agent-tasks/route.ts`, modify the query (lines 17-43) to JOIN with tasks table:

```typescript
let query = `
  SELECT
    at.*,
    p.name as project_name,
    ac.display_name as agent_name,
    ac.icon as agent_icon,
    t.note_id as task_note_id,
    n.title as note_title,
    n.slug as note_slug
  FROM agent_tasks at
  LEFT JOIN projects p ON at.project_id = p.id
  LEFT JOIN agent_configs ac ON at.assigned_agent = ac.agent_type
  LEFT JOIN tasks t ON at.task_id = t.id
  LEFT JOIN notes n ON t.note_id = n.id
  WHERE at.user_id = ?
`;
const args: string[] = [user.id];

if (status) {
  query += " AND at.status = ?";
  args.push(status);
}

query += " ORDER BY at.created_at DESC";

const tasks = await queryAll<
  AgentTask & {
    project_name?: string;
    agent_name?: string;
    agent_icon?: string;
    task_note_id?: string;
    note_title?: string;
    note_slug?: string;
  }
>(query, args);
```

**Step 2: Commit**

```bash
git add src/app/api/agent-tasks/route.ts
git commit -m "feat: add note and project context to agent tasks API"
```

---

## Task 6: UI - Add Context Badges to Agent Task Card

**Files:**
- Modify: `src/components/agents/agent-task-card.tsx:1,17-28,82-84`

**Step 1: Add imports and update interface**

At the top of `src/components/agents/agent-task-card.tsx`, add imports:

```typescript
import Link from 'next/link';
import { FileText, FolderOpen } from 'lucide-react';
```

Update the task interface (lines 17-28):

```typescript
interface AgentTaskCardProps {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    agent_name?: string;
    agent_icon?: string;
    project_name?: string;
    note_title?: string;
    note_slug?: string;
    created_at: string;
    updated_at: string;
  };
  onView: () => void;
}
```

**Step 2: Add context badges after agent name**

Replace line 82-84 with:

```typescript
<div className="space-y-1">
  <p className="text-sm text-muted-foreground">
    {task.agent_name} • {timeAgo}
  </p>
  <div className="flex flex-wrap items-center gap-1.5 text-xs">
    {task.note_title && task.note_slug && (
      <Link
        href={`/notes/${task.note_slug}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Badge variant="outline" className="gap-1 hover:bg-muted cursor-pointer">
          <FileText className="h-3 w-3" />
          {task.note_title}
        </Badge>
      </Link>
    )}
    {task.project_name && (
      <Badge variant="outline" className="gap-1">
        <FolderOpen className="h-3 w-3" />
        {task.project_name}
      </Badge>
    )}
  </div>
</div>
```

**Step 3: Add Badge import**

Ensure Badge is imported at the top:

```typescript
import { Badge } from '@/components/ui/badge';
```

**Step 4: Test in browser**

Navigate to agents page, verify note and project badges appear on agent task cards.

**Step 5: Commit**

```bash
git add src/components/agents/agent-task-card.tsx
git commit -m "feat: add note and project context badges to agent task cards"
```

---

## Task 7: Fuzzy Matching - Add String Similarity Utility

**Files:**
- Create: `src/lib/cleanup/fuzzy-match.ts`

**Step 1: Create fuzzy matching utility**

Create new file `src/lib/cleanup/fuzzy-match.ts`:

```typescript
/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching when exact target string isn't found
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score between two strings (0 to 1)
 * 1 = identical, 0 = completely different
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

/**
 * Find the best matching substring in content for a target string
 * Returns null if no match above threshold
 */
export interface FuzzyMatch {
  match: string;
  similarity: number;
  index: number;
}

export function findBestMatch(
  content: string,
  target: string,
  threshold: number = 0.7
): FuzzyMatch | null {
  // First try exact match
  if (content.includes(target)) {
    return {
      match: target,
      similarity: 1.0,
      index: content.indexOf(target),
    };
  }

  // Try fuzzy matching on lines or headings
  const lines = content.split('\n');
  let bestMatch: FuzzyMatch | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const similarity = stringSimilarity(line.trim(), target.trim());

    if (similarity >= threshold) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        // Find the actual position in full content
        const precedingText = lines.slice(0, i).join('\n');
        const index = precedingText.length + (precedingText.length > 0 ? 1 : 0);

        bestMatch = {
          match: line,
          similarity,
          index,
        };
      }
    }
  }

  return bestMatch;
}
```

**Step 2: Commit**

```bash
git add src/lib/cleanup/fuzzy-match.ts
git commit -m "feat: add fuzzy string matching utility for AI cleanup"
```

---

## Task 8: Fuzzy Matching - Update Applier to Use Fuzzy Matching

**Files:**
- Modify: `src/lib/cleanup/applier.ts:1,71-80`
- Modify: `src/lib/cleanup/types.ts:3-13`

**Step 1: Add match result to CleanupSuggestion type**

In `src/lib/cleanup/types.ts`, update the `CleanupSuggestion` interface (lines 3-13):

```typescript
export interface CleanupSuggestion {
  id: string;
  type: 'structure' | 'duplicate' | 'task' | 'tag';
  action: 'replace' | 'insert' | 'extract' | 'add';
  target: string;
  before?: string;
  after?: string;
  content?: string;
  reasoning: string;
  confidence: number;
  matchConfidence?: number; // Added: fuzzy match confidence
  matchedTarget?: string;   // Added: actual matched string if fuzzy
}
```

**Step 2: Update insertAtTarget function**

In `src/lib/cleanup/applier.ts`, add import at top:

```typescript
import { findBestMatch } from './fuzzy-match';
```

Replace the `insertAtTarget` function (lines 71-80):

```typescript
function insertAtTarget(content: string, target: string, insertion: string): {
  content: string;
  matchConfidence?: number;
  matchedTarget?: string;
} {
  // Try exact match first
  if (target && content.includes(target)) {
    return {
      content: content.replace(target, target + '\n\n' + insertion),
      matchConfidence: 1.0,
      matchedTarget: target,
    };
  }

  // Try fuzzy match
  const fuzzyMatch = findBestMatch(content, target, 0.7);
  if (fuzzyMatch) {
    console.log(`Fuzzy match found for target "${target}": "${fuzzyMatch.match}" (similarity: ${fuzzyMatch.similarity})`);
    return {
      content: content.replace(fuzzyMatch.match, fuzzyMatch.match + '\n\n' + insertion),
      matchConfidence: fuzzyMatch.similarity,
      matchedTarget: fuzzyMatch.match,
    };
  }

  // No match found - log warning and skip insertion
  console.warn(`No match found for target "${target}" - skipping insertion to avoid appending at end`);
  return {
    content,
    matchConfidence: 0,
    matchedTarget: undefined,
  };
}
```

**Step 3: Update insert action handler**

In `src/lib/cleanup/applier.ts`, update the insert action (around line 28-30):

```typescript
} else if (suggestion.action === 'insert' && suggestion.after) {
  const result = insertAtTarget(content, suggestion.target, suggestion.after);
  content = result.content;
  // Note: matchConfidence could be logged or returned for UI feedback
}
```

**Step 4: Commit**

```bash
git add src/lib/cleanup/applier.ts src/lib/cleanup/types.ts
git commit -m "feat: implement fuzzy matching for AI cleanup target strings"
```

---

## Task 9: Testing - Manual Verification

**Step 1: Test task recommendations with project inheritance**

1. Create a note that belongs to a project
2. Add some actionable items to the note
3. Run AI cleanup on the note
4. Accept a task recommendation
5. Verify the created task has both `note_id` AND `project_id` set
6. Verify task list shows both note and project badges

**Step 2: Test context badges across all views**

1. Navigate to task recommendations - verify badges with icons
2. Navigate to tasks page - verify badges with icons
3. Navigate to agents page - verify badges with icons
4. Click note badge - verify it navigates to the note
5. Verify all badges have consistent styling

**Step 3: Test fuzzy matching**

1. Create a long note (>3000 chars) with clear sections
2. Run AI cleanup
3. Check console logs for fuzzy match messages
4. Verify content is inserted at correct sections, not appended at end
5. Try a note where targets might not match exactly

**Step 4: Document any issues**

If any issues are found, create follow-up tasks.

---

## Task 10: Final Commit and Documentation

**Step 1: Update CLAUDE.md if needed**

Check if any architectural changes need to be documented in `/home/daniel/PROJECTS/brain-portal/CLAUDE.md`.

**Step 2: Final verification**

```bash
npm run typecheck
npm run lint
npm run build
```

**Step 3: Final commit**

```bash
git add .
git commit -m "chore: final cleanup and verification for task context features"
```

---

## Success Criteria

- ✅ Task recommendations inherit project_id from source note
- ✅ All task views show note and project badges with icons
- ✅ Note badges are clickable links to the note
- ✅ Consistent visual design across all components
- ✅ AI cleanup uses fuzzy matching instead of appending
- ✅ Console logs show when fuzzy matches are used
- ✅ No TypeScript errors
- ✅ No lint errors
- ✅ Build succeeds
