# Task Context & AI Cleanup Fixes - Design Document

**Date:** 2026-02-04
**Status:** Approved

## Overview

This design addresses two critical issues in the Brain Portal system:
1. AI cleanup appending content at the end instead of replacing targeted sections
2. Missing note/project context when AI extracts tasks from notes

## Problem 1: AI Cleanup Target Matching

### Current Behavior

When AI cleanup analyzes a note and suggests improvements:
- Large notes (>3000 chars) are chunked for analysis
- AI generates suggestions with target strings based on chunk context
- When applying suggestions, if the exact target string isn't found in the full note, the code silently appends content to the end instead of replacing the section
- This happens in `/src/lib/cleanup/applier.ts` line 71-79

### Root Cause

```typescript
function insertAtTarget(content: string, target: string, insertion: string): string {
  if (target && content.includes(target)) {
    return content.replace(target, target + '\n\n' + insertion);
  }
  // PROBLEM: Silently appends when target not found
  return content + '\n\n' + insertion;
}
```

**Why targets aren't found:**
- Notes are chunked with different context boundaries
- AI references sections that don't match exactly in the full document
- String matching is too strict (exact match only)

### Solution: Fuzzy Matching + Preview

**Implementation approach:**
1. **Fuzzy string matching** - Use string similarity to find close matches when exact target fails
2. **Logging warnings** - Log when targets aren't found exactly
3. **Preview before applying** - Show users where changes will be inserted
4. **Skip low-confidence matches** - Don't apply suggestions with very low similarity scores

**Files to modify:**
- `/src/lib/cleanup/applier.ts` - Add fuzzy matching logic
- `/src/lib/cleanup/types.ts` - Add types for match confidence
- `/src/components/notes/cleanup-modal.tsx` - Add preview UI

## Problem 2: Task Context Missing

### Current Behavior

When AI cleanup extracts tasks from notes:
1. ✅ `note_id` is stored in task_recommendations
2. ✅ When accepted, task is created with `note_id` set
3. ❌ Task does NOT inherit `project_id` from the source note
4. ❌ UI doesn't prominently show which note/project the task came from

**Example:**
- User works on a note in "Project X"
- AI extracts 3 tasks from the note
- Tasks are created with `note_id` but `project_id` is NULL
- User sees tasks but can't tell they belong to "Project X"

### Solution: Inherit Project & Show Context

#### Backend Changes

**File:** `/src/app/api/tasks/recommendations/[id]/feedback/route.ts` (lines 47-74)

When accepting a task recommendation:
```typescript
if (feedback === 'accepted') {
  // 1. Get source note to fetch its project_id
  let projectId = null;
  if (recommendation.source_type === 'note') {
    const sourceNote = await queryOne(
      'SELECT project_id FROM notes WHERE id = ?',
      [recommendation.source_id]
    );
    projectId = sourceNote?.project_id || null;
  }

  // 2. Create task with BOTH note_id AND project_id
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
}
```

#### Frontend Changes

**1. API Enhancement** - `/src/app/api/tasks/recommendations/route.ts`

Update query to JOIN with notes and projects:
```sql
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
```

**2. TypeScript Interface Updates**

Add to `TaskRecommendation` interface:
```typescript
interface TaskRecommendation {
  // ... existing fields
  note_title?: string;
  note_slug?: string;
  project_name?: string;
  project_id?: string;
}
```

**3. UI Components - Standardized Context Badges**

Create consistent badge format across all three components:

```tsx
import { FileText, FolderOpen } from 'lucide-react';

// Standardized context badges
<div className="flex flex-wrap items-center gap-1.5 text-xs">
  {/* Note badge with icon and link */}
  {note_title && note_slug && (
    <Link href={`/notes/${note_slug}`} onClick={(e) => e.stopPropagation()}>
      <Badge variant="outline" className="gap-1 hover:bg-muted cursor-pointer">
        <FileText className="h-3 w-3" />
        {note_title}
      </Badge>
    </Link>
  )}

  {/* Project badge with icon */}
  {project_name && (
    <Badge variant="outline" className="gap-1">
      <FolderOpen className="h-3 w-3" />
      {project_name}
    </Badge>
  )}
</div>
```

**Apply to three components:**

1. **Task Recommendations** - `/src/components/recommendations/recommendation-card.tsx`
   - Replace line 202-204 (current "From: note" text)
   - Add note and project badges with icons

2. **Tasks List** - `/src/app/(dashboard)/tasks/page.tsx`
   - Update lines 312-325 (current project badge + note link)
   - Use standardized badges with icons for both

3. **Agent Task Card** - `/src/components/agents/agent-task-card.tsx`
   - Add context badges after line 83 (currently missing)
   - Requires updating API to fetch note/project info for agent tasks

## Visual Design

### Badge Hierarchy

- **Note Badge**: `FileText` icon + note title + clickable link
- **Project Badge**: `FolderOpen` icon + project name
- **Styling**: Outline variant, compact size, gap between icon and text
- **Behavior**: Note badge navigates to note on click, project badge is informational

### Consistency

All task-related components will use the same visual language:
- Same icons across the app
- Same badge styling
- Same interaction patterns
- Clear visual hierarchy (icon → content)

## Implementation Order

1. **Backend: Inherit project from note**
   - Modify `/src/app/api/tasks/recommendations/[id]/feedback/route.ts`
   - Add project_id when creating tasks from recommendations

2. **API: JOIN with notes and projects**
   - Modify `/src/app/api/tasks/recommendations/route.ts`
   - Return note_title, note_slug, project_name, project_id

3. **UI: Task recommendations**
   - Update `recommendation-card.tsx` to show context badges

4. **UI: Tasks list**
   - Update `tasks/page.tsx` to use standardized badges

5. **UI: Agent task card**
   - Update agent tasks API to include note/project info
   - Add context badges to `agent-task-card.tsx`

6. **AI Cleanup: Fuzzy matching**
   - Implement fuzzy string matching in `applier.ts`
   - Add preview functionality to cleanup modal

## Testing Considerations

- Test with notes that have projects vs. notes without projects
- Test task recommendations from daily notes vs. regular notes
- Verify clicking note badge navigates correctly
- Test fuzzy matching with various note structures
- Verify no regression in existing task creation flows

## Success Metrics

- Users can immediately see which note/project a task came from
- AI cleanup applies changes to the correct sections
- No tasks are "orphaned" from their project context
- Consistent visual language across all task views
