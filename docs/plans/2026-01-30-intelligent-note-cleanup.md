# Intelligent Note Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build AI-powered note cleanup system with safe, undoable suggestions for structure, duplicates, tasks, and tags.

**Architecture:** LLM analyzes notes (chunked if >3000 chars), returns structured JSON suggestions, user reviews in tabbed modal, approved changes applied with full version history in activity_log.

**Tech Stack:** Next.js 16, OpenRouter (fast_llm tier), TanStack Query, shadcn/ui (Dialog, Tabs), Turso DB

---

## Task 1: Chunking Service

**Files:**
- Create: `src/lib/cleanup/chunker.ts`
- Test: `tests/lib/cleanup/chunker.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/lib/cleanup/chunker.test.ts
import { describe, test, expect } from 'vitest';
import { chunkNote } from '@/lib/cleanup/chunker';

describe('chunkNote', () => {
  test('returns single chunk for short notes', () => {
    const content = 'Short note content';
    const chunks = chunkNote(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('full');
    expect(chunks[0].content).toBe(content);
    expect(chunks[0].precedingContext).toBeUndefined();
  });

  test('splits by headings for long notes', () => {
    const content = `# Title

Some intro text here.

## Section 1

Content for section 1 with enough text to make it long.
${'x'.repeat(3000)}

## Section 2

More content here.`;

    const chunks = chunkNote(content);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].heading).toContain('Title');
    expect(chunks[1].heading).toContain('Section 1');
    expect(chunks[1].precedingContext).toBeDefined();
  });

  test('preserves line number ranges', () => {
    const content = `## First

Content

## Second

More content`;

    const chunks = chunkNote(content);

    expect(chunks[0].startLine).toBe(0);
    expect(chunks[0].endLine).toBeGreaterThan(0);
    expect(chunks[1].startLine).toBeGreaterThan(chunks[0].endLine);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/lib/cleanup/chunker.test.ts`
Expected: FAIL with "Cannot find module '@/lib/cleanup/chunker'"

**Step 3: Write minimal implementation**

```typescript
// src/lib/cleanup/chunker.ts
export interface Chunk {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
  heading?: string;
  precedingContext?: string;
}

export function chunkNote(content: string): Chunk[] {
  // If small enough, return whole note
  if (content.length < 3000) {
    return [{
      id: 'full',
      content,
      startLine: 0,
      endLine: content.split('\n').length
    }];
  }

  // Split by markdown headings
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentHeading: string | undefined;
  let startLine = 0;

  lines.forEach((line, idx) => {
    const isHeading = /^#{1,3}\s/.test(line);

    if (isHeading && currentChunk.length > 0) {
      // Save previous chunk
      chunks.push({
        id: `chunk-${chunks.length}`,
        content: currentChunk.join('\n'),
        startLine,
        endLine: idx - 1,
        heading: currentHeading
      });
      currentChunk = [line];
      currentHeading = line;
      startLine = idx;
    } else {
      currentChunk.push(line);
      if (isHeading && !currentHeading) {
        currentHeading = line;
      }
    }
  });

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      id: `chunk-${chunks.length}`,
      content: currentChunk.join('\n'),
      startLine,
      endLine: lines.length - 1,
      heading: currentHeading
    });
  }

  // Add context to chunks (summary of previous content)
  return chunks.map((chunk, idx) => {
    if (idx === 0) return chunk;

    const previousHeadings = chunks
      .slice(0, idx)
      .map(c => c.heading)
      .filter(Boolean)
      .join(', ');

    return {
      ...chunk,
      precedingContext: `Previous sections: ${previousHeadings}`
    };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/lib/cleanup/chunker.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/lib/cleanup/chunker.ts tests/lib/cleanup/chunker.test.ts
git commit -m "feat(cleanup): add note chunking service

- Split notes >3000 chars by markdown headings
- Preserve line numbers for suggestion mapping
- Add context to subsequent chunks
"
```

---

## Task 2: Cleanup Analyzer Service

**Files:**
- Create: `src/lib/cleanup/analyzer.ts`
- Test: `tests/lib/cleanup/analyzer.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/lib/cleanup/analyzer.test.ts
import { describe, test, expect, vi } from 'vitest';
import { analyzeNote } from '@/lib/cleanup/analyzer';
import * as aiClient from '@/lib/ai/client';

vi.mock('@/lib/ai/client');

describe('analyzeNote', () => {
  test('returns suggestions for note cleanup', async () => {
    const mockResponse = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '## Old Heading',
        before: '## Old Heading',
        after: '## Improved Heading',
        reasoning: 'More descriptive',
        confidence: 0.85
      }
    ];

    vi.mocked(aiClient.completeJSON).mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', '## Old Heading\n\nSome content');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].type).toBe('structure');
    expect(result.suggestions[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('filters low confidence suggestions', async () => {
    const mockResponse = [
      {
        id: 'tag-1',
        type: 'tag',
        action: 'add',
        content: 'test',
        reasoning: 'Maybe relevant',
        confidence: 0.5
      }
    ];

    vi.mocked(aiClient.completeJSON).mockResolvedValue(mockResponse);

    const result = await analyzeNote('userId', 'Some content');

    expect(result.suggestions).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/lib/cleanup/analyzer.test.ts`
Expected: FAIL with "Cannot find module '@/lib/cleanup/analyzer'"

**Step 3: Write minimal implementation**

```typescript
// src/lib/cleanup/analyzer.ts
import { completeJSON } from '@/lib/ai/client';
import { getTierConfig } from '@/lib/ai/tiers';
import { chunkNote, type Chunk } from './chunker';

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
}

export interface AnalysisResult {
  suggestions: CleanupSuggestion[];
  chunked: boolean;
  chunkCount: number;
}

const CLEANUP_SYSTEM_PROMPT = `You are analyzing a note for cleanup opportunities. Provide structured suggestions.

Analyze for:
1. Structure improvements - better headings, reorganization, clarity
2. Duplicate content - consolidate repetitive points
3. Action items - extract tasks that should be tracked separately
4. Tags/categories - suggest relevant tags based on content

Return JSON array of suggestions. Each suggestion:
{
  "id": "unique-id",
  "type": "structure" | "duplicate" | "task" | "tag",
  "action": "replace" | "insert" | "extract" | "add",
  "target": "section identifier or line range",
  "before": "original text (if replacing)",
  "after": "improved text (if replacing/inserting)",
  "content": "extracted content (for tasks/tags)",
  "reasoning": "why this suggestion helps",
  "confidence": 0.0-1.0
}

Only suggest changes that genuinely improve the note. Be conservative.`;

export async function analyzeNote(
  userId: string,
  content: string
): Promise<AnalysisResult> {
  const chunks = chunkNote(content);
  const config = getTierConfig('fast_llm');

  const allSuggestions: CleanupSuggestion[] = [];

  for (const chunk of chunks) {
    const prompt = buildPrompt(chunk);

    try {
      const suggestions = await completeJSON<CleanupSuggestion[]>(prompt, {
        system: CLEANUP_SYSTEM_PROMPT,
        model: config.model,
        maxTokens: 1500,
      });

      // Filter by confidence
      const filtered = suggestions.filter(s => s.confidence >= 0.7);
      allSuggestions.push(...filtered);
    } catch (error) {
      console.error('Failed to analyze chunk:', error);
      // Continue with other chunks
    }
  }

  // Deduplicate and limit suggestions
  const deduplicated = deduplicateSuggestions(allSuggestions);
  const limited = limitSuggestions(deduplicated);

  return {
    suggestions: limited,
    chunked: chunks.length > 1,
    chunkCount: chunks.length,
  };
}

function buildPrompt(chunk: Chunk): string {
  let prompt = 'Note content:\n\n';

  if (chunk.precedingContext) {
    prompt += `Context: ${chunk.precedingContext}\n\n`;
  }

  prompt += chunk.content;

  return prompt;
}

function deduplicateSuggestions(suggestions: CleanupSuggestion[]): CleanupSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter(s => {
    const key = `${s.type}-${s.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitSuggestions(suggestions: CleanupSuggestion[]): CleanupSuggestion[] {
  const byType: Record<string, CleanupSuggestion[]> = {
    structure: [],
    duplicate: [],
    task: [],
    tag: [],
  };

  suggestions.forEach(s => {
    byType[s.type].push(s);
  });

  // Limit to 10 per type, sorted by confidence
  const limited: CleanupSuggestion[] = [];
  for (const type of Object.keys(byType)) {
    const sorted = byType[type].sort((a, b) => b.confidence - a.confidence);
    limited.push(...sorted.slice(0, 10));
  }

  return limited;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/lib/cleanup/analyzer.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/lib/cleanup/analyzer.ts tests/lib/cleanup/analyzer.test.ts
git commit -m "feat(cleanup): add AI-powered note analyzer

- Call OpenRouter fast_llm tier for suggestions
- Filter by confidence threshold (0.7)
- Deduplicate and limit suggestions (10 per type)
"
```

---

## Task 3: Cleanup Applier Service

**Files:**
- Create: `src/lib/cleanup/applier.ts`
- Test: `tests/lib/cleanup/applier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/lib/cleanup/applier.test.ts
import { describe, test, expect } from 'vitest';
import { applySuggestions } from '@/lib/cleanup/applier';
import type { CleanupSuggestion } from '@/lib/cleanup/analyzer';

describe('applySuggestions', () => {
  test('applies structure replacements', () => {
    const content = '## Old Heading\n\nSome content';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'struct-1',
        type: 'structure',
        action: 'replace',
        target: '## Old Heading',
        before: '## Old Heading',
        after: '## Improved Heading',
        reasoning: 'Better',
        confidence: 0.9
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).toContain('## Improved Heading');
    expect(result.updatedContent).not.toContain('## Old Heading');
  });

  test('extracts tasks', () => {
    const content = 'Notes here\n- Call Sarah tomorrow\nMore notes';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'task-1',
        type: 'task',
        action: 'extract',
        target: '- Call Sarah tomorrow',
        content: 'Call Sarah tomorrow',
        reasoning: 'Action item',
        confidence: 0.95
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.taskRecommendations).toHaveLength(1);
    expect(result.taskRecommendations[0].recommended_task).toBe('Call Sarah tomorrow');
    expect(result.updatedContent).not.toContain('- Call Sarah tomorrow');
  });

  test('adds tags', () => {
    const content = 'Some content';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'tag-1',
        type: 'tag',
        action: 'add',
        content: 'project-planning',
        target: '',
        reasoning: 'Relevant tag',
        confidence: 0.8
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.suggestedTags).toContain('project-planning');
  });

  test('cleans up multiple newlines', () => {
    const content = 'Line 1\n- Task here\n\nLine 2';
    const suggestions: CleanupSuggestion[] = [
      {
        id: 'task-1',
        type: 'task',
        action: 'extract',
        target: '- Task here',
        content: 'Task here',
        reasoning: 'Extract',
        confidence: 0.9
      }
    ];

    const result = applySuggestions(content, suggestions);

    expect(result.updatedContent).not.toMatch(/\n{3,}/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/lib/cleanup/applier.test.ts`
Expected: FAIL with "Cannot find module '@/lib/cleanup/applier'"

**Step 3: Write minimal implementation**

```typescript
// src/lib/cleanup/applier.ts
import type { CleanupSuggestion } from './analyzer';

export interface TaskRecommendationInput {
  source_type: 'note';
  source_id: string;
  source_text: string;
  recommended_task: string;
  reasoning: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface ApplyResult {
  updatedContent: string;
  taskRecommendations: TaskRecommendationInput[];
  suggestedTags: string[];
}

export function applySuggestions(
  noteContent: string,
  suggestions: CleanupSuggestion[],
  noteId?: string
): ApplyResult {
  let content = noteContent;
  const taskRecommendations: TaskRecommendationInput[] = [];
  const suggestedTags: string[] = [];

  // Sort suggestions by type priority
  const sorted = suggestions.sort((a, b) => {
    const priority: Record<string, number> = { extract: 0, replace: 1, insert: 2, add: 3 };
    return priority[a.action] - priority[b.action];
  });

  for (const suggestion of sorted) {
    switch (suggestion.type) {
      case 'structure':
      case 'duplicate':
        if (suggestion.action === 'replace' && suggestion.before && suggestion.after) {
          // Find exact match of before text
          if (content.includes(suggestion.before)) {
            content = content.replace(suggestion.before, suggestion.after);
          }
        } else if (suggestion.action === 'insert' && suggestion.after) {
          // Insert at target location (simplified - would need more sophisticated placement)
          content = insertAtTarget(content, suggestion.target, suggestion.after);
        }
        break;

      case 'task':
        if (suggestion.action === 'extract' && suggestion.content) {
          // Create task recommendation
          taskRecommendations.push({
            source_type: 'note',
            source_id: noteId || '',
            source_text: suggestion.target || suggestion.content,
            recommended_task: suggestion.content,
            reasoning: suggestion.reasoning || 'Extracted during note cleanup',
            confidence: suggestion.confidence || 0.8,
            priority: 'medium',
          });

          // Remove the task line from note content
          if (suggestion.target && content.includes(suggestion.target)) {
            content = content.replace(suggestion.target, '');
          }
        }
        break;

      case 'tag':
        if (suggestion.action === 'add' && suggestion.content) {
          suggestedTags.push(suggestion.content);
        }
        break;
    }
  }

  // Clean up any double newlines created by removals
  content = content.replace(/\n{3,}/g, '\n\n');

  return {
    updatedContent: content.trim(),
    taskRecommendations,
    suggestedTags,
  };
}

function insertAtTarget(content: string, target: string, insertion: string): string {
  // Simplified insertion - just append for now
  // In production, would parse markdown and insert at appropriate location
  return content + '\n\n' + insertion;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/lib/cleanup/applier.test.ts`
Expected: PASS (all tests passing)

**Step 5: Commit**

```bash
git add src/lib/cleanup/applier.ts tests/lib/cleanup/applier.test.ts
git commit -m "feat(cleanup): add suggestion applier service

- Apply structure/duplicate replacements
- Extract tasks to recommendations
- Collect suggested tags
- Clean up formatting after changes
"
```

---

## Task 4: Cleanup API Route - Analyze

**Files:**
- Create: `src/app/api/notes/[id]/cleanup/route.ts`
- Modify: `src/lib/db/schema.ts` (verify activity_log exists)

**Step 1: Create API route file**

```typescript
// src/app/api/notes/[id]/cleanup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { analyzeNote } from '@/lib/cleanup/analyzer';
import type { Note } from '@/lib/db/schema';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/notes/[id]/cleanup - Analyze note for cleanup suggestions
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Fetch note
    const note = await queryOne<Note>(
      'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    // Check minimum length
    if (note.content.length < 100) {
      return NextResponse.json(
        { error: 'Note too short for cleanup suggestions', suggestions: [] },
        { status: 200 }
      );
    }

    // Create activity_log snapshot
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'cleanup_started',
        JSON.stringify({
          snapshot: {
            title: note.title,
            content: note.content,
            timestamp: new Date().toISOString(),
          },
        }),
      ],
    });

    // Analyze note
    const result = await analyzeNote(user.id, note.content);

    if (result.suggestions.length === 0) {
      return NextResponse.json({
        message: 'No improvements needed!',
        suggestions: [],
      });
    }

    return NextResponse.json({
      suggestions: result.suggestions,
      chunked: result.chunked,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    console.error('Cleanup analysis failed:', error);

    if (error instanceof Error) {
      if (error.message.includes('rate_limit')) {
        return NextResponse.json(
          { error: 'AI service rate limit reached. Please try again in a minute.' },
          { status: 429 }
        );
      }
      if (error.message.includes('timeout')) {
        return NextResponse.json(
          { error: 'Analysis timed out. Try again or break note into smaller sections.' },
          { status: 408 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Failed to analyze note. Please try again.' },
      { status: 500 }
    );
  }
}
```

**Step 2: Test API route manually**

Run: `npm run dev`
Test: `curl -X POST http://localhost:3000/api/notes/[note-id]/cleanup -H "Cookie: session=..."`
Expected: JSON response with suggestions or appropriate error

**Step 3: Commit**

```bash
git add src/app/api/notes/[id]/cleanup/route.ts
git commit -m "feat(cleanup): add analyze API endpoint

- POST /api/notes/[id]/cleanup
- Create activity_log snapshot before analysis
- Call analyzer service with error handling
- Return suggestions or appropriate errors
"
```

---

## Task 5: Cleanup API Route - Apply

**Files:**
- Modify: `src/app/api/notes/[id]/cleanup/route.ts`

**Step 1: Add PATCH handler to existing route file**

```typescript
// Add to src/app/api/notes/[id]/cleanup/route.ts

import { applySuggestions } from '@/lib/cleanup/applier';
import { mutate } from '@/lib/db/client';
import type { CleanupSuggestion } from '@/lib/cleanup/analyzer';

// PATCH /api/notes/[id]/cleanup/apply - Apply approved suggestions
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { suggestions } = body as { suggestions: CleanupSuggestion[] };

    if (!suggestions || !Array.isArray(suggestions)) {
      return NextResponse.json(
        { error: 'Invalid suggestions provided' },
        { status: 400 }
      );
    }

    // Fetch current note
    const note = await queryOne<Note>(
      'SELECT * FROM notes WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!note) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }

    const oldContent = note.content;

    // Apply suggestions
    const result = applySuggestions(note.content, suggestions, id);

    // Update note content
    const updatedNote = await mutate<Note>(
      `UPDATE notes SET content = ?, content_plain = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [result.updatedContent, result.updatedContent, id, user.id]
    );

    // Create task recommendations
    let taskRecsCreated = 0;
    for (const taskRec of result.taskRecommendations) {
      await db.execute({
        sql: `INSERT INTO task_recommendations
              (user_id, source_type, source_id, source_text, recommended_task, reasoning, confidence, priority)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          user.id,
          taskRec.source_type,
          taskRec.source_id,
          taskRec.source_text,
          taskRec.recommended_task,
          taskRec.reasoning,
          taskRec.confidence,
          taskRec.priority,
        ],
      });
      taskRecsCreated++;
    }

    // Create activity_log entry
    await db.execute({
      sql: `INSERT INTO activity_log (user_id, entity_type, entity_id, action, changes)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        user.id,
        'note',
        id,
        'cleanup_applied',
        JSON.stringify({
          appliedSuggestions: suggestions,
          before: oldContent,
          after: result.updatedContent,
          taskRecommendationsCreated: taskRecsCreated,
          tagsAdded: result.suggestedTags,
        }),
      ],
    });

    return NextResponse.json({
      note: updatedNote,
      taskRecommendationsCreated: taskRecsCreated,
      suggestedTags: result.suggestedTags,
    });
  } catch (error) {
    console.error('Failed to apply cleanup:', error);
    return NextResponse.json(
      { error: 'Failed to apply cleanup. Please try again.' },
      { status: 500 }
    );
  }
}
```

**Step 2: Test apply endpoint**

Run: `npm run dev`
Test: `curl -X PATCH http://localhost:3000/api/notes/[note-id]/cleanup -H "Content-Type: application/json" -d '{"suggestions": [...]}'`
Expected: Updated note with task recommendations created

**Step 3: Commit**

```bash
git add src/app/api/notes/[id]/cleanup/route.ts
git commit -m "feat(cleanup): add apply suggestions endpoint

- PATCH /api/notes/[id]/cleanup
- Apply approved suggestions to note
- Create task recommendations
- Log changes to activity_log
"
```

---

## Task 6: SuggestionCard Component

**Files:**
- Create: `src/components/notes/suggestion-card.tsx`

**Step 1: Create component file**

```tsx
// src/components/notes/suggestion-card.tsx
'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { CleanupSuggestion } from '@/lib/cleanup/analyzer';

interface SuggestionCardProps {
  suggestion: CleanupSuggestion;
  approved: boolean;
  onToggle: () => void;
}

export function SuggestionCard({ suggestion, approved, onToggle }: SuggestionCardProps) {
  const confidencePercent = Math.round(suggestion.confidence * 100);
  const isHighConfidence = suggestion.confidence > 0.85;

  return (
    <Card className="mb-3">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
        <Checkbox
          checked={approved}
          onCheckedChange={onToggle}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={isHighConfidence ? 'default' : 'secondary'}>
              {confidencePercent}% confident
            </Badge>
            <Badge variant="outline" className="capitalize">
              {suggestion.action}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{suggestion.reasoning}</p>
        </div>
      </CardHeader>

      <CardContent>
        {suggestion.action === 'replace' && suggestion.before && suggestion.after && (
          <div className="space-y-2">
            <div className="rounded-md bg-destructive/10 p-3 text-sm">
              <div className="text-xs font-medium text-destructive mb-1">Before:</div>
              <pre className="whitespace-pre-wrap font-mono text-xs">{suggestion.before}</pre>
            </div>
            <div className="rounded-md bg-green-500/10 p-3 text-sm">
              <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">After:</div>
              <pre className="whitespace-pre-wrap font-mono text-xs">{suggestion.after}</pre>
            </div>
          </div>
        )}

        {suggestion.action === 'extract' && suggestion.content && (
          <div className="rounded-md bg-blue-500/10 p-3">
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
              Task to extract:
            </div>
            <p className="text-sm">{suggestion.content}</p>
          </div>
        )}

        {suggestion.action === 'add' && suggestion.content && (
          <div className="rounded-md bg-purple-500/10 p-3">
            <div className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">
              Suggested tag:
            </div>
            <Badge variant="outline">{suggestion.content}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Verify component renders**

Run: `npm run dev`
Navigate to note editor (we'll add button in next task)
Expected: Component compiles without errors

**Step 3: Commit**

```bash
git add src/components/notes/suggestion-card.tsx
git commit -m "feat(cleanup): add suggestion card component

- Display suggestion with checkbox
- Show confidence badge
- Render before/after diffs
- Handle extract and add actions
"
```

---

## Task 7: CleanupModal Component

**Files:**
- Create: `src/components/notes/cleanup-modal.tsx`

**Step 1: Create modal component**

```tsx
// src/components/notes/cleanup-modal.tsx
'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SuggestionCard } from './suggestion-card';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CleanupSuggestion } from '@/lib/cleanup/analyzer';

interface CleanupModalProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function CleanupModal({ noteId, open, onOpenChange, onComplete }: CleanupModalProps) {
  const [suggestions, setSuggestions] = useState<CleanupSuggestion[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState('structure');

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${noteId}/cleanup`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Analysis failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setSuggestions(data.suggestions || []);

      // Auto-approve high confidence suggestions
      const autoApproved = new Set<string>();
      data.suggestions?.forEach((s: CleanupSuggestion) => {
        if (s.confidence > 0.85) {
          autoApproved.add(s.id);
        }
      });
      setApproved(autoApproved);

      if (data.suggestions?.length === 0) {
        toast.success('No improvements needed!');
        onOpenChange(false);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Apply mutation
  const applyMutation = useMutation({
    mutationFn: async () => {
      const approvedSuggestions = suggestions.filter(s => approved.has(s.id));

      const response = await fetch(`/api/notes/${noteId}/cleanup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestions: approvedSuggestions }),
      });

      if (!response.ok) {
        throw new Error('Failed to apply changes');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast.success('Cleanup applied successfully!');

      if (data.taskRecommendationsCreated > 0) {
        toast.info(`${data.taskRecommendationsCreated} task${data.taskRecommendationsCreated > 1 ? 's' : ''} extracted`);
      }

      onOpenChange(false);
      onComplete?.();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Start analysis when modal opens
  const handleOpenChange = (open: boolean) => {
    if (open && suggestions.length === 0) {
      analyzeMutation.mutate();
    }
    onOpenChange(open);
  };

  const toggleApproval = (id: string) => {
    setApproved(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const groupedSuggestions = {
    structure: suggestions.filter(s => s.type === 'structure'),
    duplicates: suggestions.filter(s => s.type === 'duplicate'),
    tasks: suggestions.filter(s => s.type === 'task'),
    tags: suggestions.filter(s => s.type === 'tag'),
  };

  const approvedCount = approved.size;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cleanup Suggestions</DialogTitle>
          <DialogDescription>
            Review AI-powered suggestions to improve your note
          </DialogDescription>
        </DialogHeader>

        {analyzeMutation.isPending && (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              Analyzing note for cleanup opportunities...
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              This may take 10-15 seconds
            </p>
          </div>
        )}

        {!analyzeMutation.isPending && suggestions.length > 0 && (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="structure">
                  Structure ({groupedSuggestions.structure.length})
                </TabsTrigger>
                <TabsTrigger value="duplicates">
                  Duplicates ({groupedSuggestions.duplicates.length})
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  Tasks ({groupedSuggestions.tasks.length})
                </TabsTrigger>
                <TabsTrigger value="tags">
                  Tags ({groupedSuggestions.tags.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="structure" className="mt-4">
                {groupedSuggestions.structure.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No structure improvements suggested
                  </p>
                ) : (
                  groupedSuggestions.structure.map(s => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      approved={approved.has(s.id)}
                      onToggle={() => toggleApproval(s.id)}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="duplicates" className="mt-4">
                {groupedSuggestions.duplicates.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No duplicate content found
                  </p>
                ) : (
                  groupedSuggestions.duplicates.map(s => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      approved={approved.has(s.id)}
                      onToggle={() => toggleApproval(s.id)}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="tasks" className="mt-4">
                {groupedSuggestions.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No tasks to extract
                  </p>
                ) : (
                  groupedSuggestions.tasks.map(s => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      approved={approved.has(s.id)}
                      onToggle={() => toggleApproval(s.id)}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="tags" className="mt-4">
                {groupedSuggestions.tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No tags suggested
                  </p>
                ) : (
                  groupedSuggestions.tags.map(s => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      approved={approved.has(s.id)}
                      onToggle={() => toggleApproval(s.id)}
                    />
                  ))
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={approvedCount === 0 || applyMutation.isPending}
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Applying...
                  </>
                ) : (
                  `Apply ${approvedCount} Change${approvedCount !== 1 ? 's' : ''}`
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify modal compiles**

Run: `npm run dev`
Expected: No compilation errors

**Step 3: Commit**

```bash
git add src/components/notes/cleanup-modal.tsx
git commit -m "feat(cleanup): add cleanup modal with tabs

- Tabbed interface for suggestion types
- Auto-trigger analysis on open
- Auto-approve high confidence suggestions
- Apply approved suggestions with loading state
"
```

---

## Task 8: Add Cleanup Button to Note Editor

**Files:**
- Modify: `src/app/(dashboard)/notes/[slug]/page.tsx`

**Step 1: Add cleanup button and modal to note editor**

```tsx
// Add to src/app/(dashboard)/notes/[slug]/page.tsx

// Add import at top
import { CleanupModal } from '@/components/notes/cleanup-modal';
import { Sparkles } from 'lucide-react';

// Add state in component (after other useState declarations)
const [showCleanupModal, setShowCleanupModal] = useState(false);

// Add button in the action buttons section (after VoiceInput, before Save button)
<Button
  onClick={() => setShowCleanupModal(true)}
  variant="outline"
  className="min-h-11 md:min-h-9"
  title="AI-powered cleanup suggestions"
>
  <Sparkles className="h-4 w-4 sm:mr-2" />
  <span className="hidden sm:inline">Cleanup</span>
</Button>

// Add modal before closing </div> tag at bottom
<CleanupModal
  noteId={note.id}
  open={showCleanupModal}
  onOpenChange={setShowCleanupModal}
  onComplete={() => {
    // Refresh note data after cleanup
    queryClient.invalidateQueries({ queryKey: ['note', slug] });
  }}
/>
```

**Step 2: Test the full flow**

Run: `npm run dev`
Steps:
1. Open a note in the editor
2. Click "Cleanup" button
3. Wait for analysis (loading state should show)
4. Review suggestions in tabs
5. Toggle some approvals
6. Click "Apply X Changes"
7. Verify note content updated
8. Verify task recommendations created (check tasks page)

Expected: Complete workflow functions end-to-end

**Step 3: Commit**

```bash
git add src/app/(dashboard)/notes/[slug]/page.tsx
git commit -m "feat(cleanup): add cleanup button to note editor

- Add Cleanup button next to Save in toolbar
- Integrate CleanupModal component
- Refresh note data after successful cleanup
"
```

---

## Task 9: Add TypeScript Types Export

**Files:**
- Create: `src/lib/cleanup/types.ts`
- Modify: `src/lib/cleanup/analyzer.ts`
- Modify: `src/lib/cleanup/applier.ts`

**Step 1: Extract shared types to dedicated file**

```typescript
// src/lib/cleanup/types.ts
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
}

export interface AnalysisResult {
  suggestions: CleanupSuggestion[];
  chunked: boolean;
  chunkCount: number;
}

export interface TaskRecommendationInput {
  source_type: 'note';
  source_id: string;
  source_text: string;
  recommended_task: string;
  reasoning: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface ApplyResult {
  updatedContent: string;
  taskRecommendations: TaskRecommendationInput[];
  suggestedTags: string[];
}
```

**Step 2: Update imports in analyzer and applier**

```typescript
// Update src/lib/cleanup/analyzer.ts
// Replace local interface definitions with:
import type { CleanupSuggestion, AnalysisResult } from './types';

// Update src/lib/cleanup/applier.ts
// Replace local interface definitions with:
import type { CleanupSuggestion, TaskRecommendationInput, ApplyResult } from './types';
```

**Step 3: Run type check**

Run: `npm run typecheck`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/lib/cleanup/types.ts src/lib/cleanup/analyzer.ts src/lib/cleanup/applier.ts
git commit -m "refactor(cleanup): extract shared types to dedicated file

- Create types.ts with all cleanup interfaces
- Update analyzer and applier to use shared types
"
```

---

## Task 10: Add Tests for API Routes

**Files:**
- Create: `tests/app/api/notes/cleanup.test.ts`

**Step 1: Write API integration tests**

```typescript
// tests/app/api/notes/cleanup.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { POST, PATCH } from '@/app/api/notes/[id]/cleanup/route';
import { NextRequest } from 'next/server';
import * as auth from '@/lib/auth';
import * as analyzer from '@/lib/cleanup/analyzer';

vi.mock('@/lib/auth');
vi.mock('@/lib/cleanup/analyzer');
vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  db: {
    execute: vi.fn(),
  },
}));

describe('POST /api/notes/[id]/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 401 when unauthorized', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/notes/123/cleanup', {
      method: 'POST',
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: '123' }),
    });

    expect(response.status).toBe(401);
  });

  test('returns suggestions when note has content', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
    });

    const mockNote = {
      id: '123',
      content: 'Some note content here with enough text',
      title: 'Test Note',
    };

    const { queryOne } = await import('@/lib/db/client');
    vi.mocked(queryOne).mockResolvedValue(mockNote);

    vi.mocked(analyzer.analyzeNote).mockResolvedValue({
      suggestions: [
        {
          id: 'struct-1',
          type: 'structure',
          action: 'replace',
          target: 'Test',
          before: 'Test',
          after: 'Better Test',
          reasoning: 'Improved',
          confidence: 0.9,
        },
      ],
      chunked: false,
      chunkCount: 1,
    });

    const req = new NextRequest('http://localhost/api/notes/123/cleanup', {
      method: 'POST',
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: '123' }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.suggestions).toHaveLength(1);
  });

  test('returns error for short notes', async () => {
    vi.mocked(auth.getCurrentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
    });

    const { queryOne } = await import('@/lib/db/client');
    vi.mocked(queryOne).mockResolvedValue({
      id: '123',
      content: 'Short',
      title: 'Test',
    });

    const req = new NextRequest('http://localhost/api/notes/123/cleanup', {
      method: 'POST',
    });

    const response = await POST(req, {
      params: Promise.resolve({ id: '123' }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.error).toContain('too short');
  });
});
```

**Step 2: Run tests**

Run: `npm test tests/app/api/notes/cleanup.test.ts`
Expected: PASS (all tests passing)

**Step 3: Commit**

```bash
git add tests/app/api/notes/cleanup.test.ts
git commit -m "test(cleanup): add API route integration tests

- Test authorization
- Test suggestion generation
- Test short note handling
"
```

---

## Task 11: Documentation and Final Testing

**Files:**
- Create: `docs/features/note-cleanup.md`

**Step 1: Create feature documentation**

```markdown
# Note Cleanup Feature

## Overview

AI-powered note cleanup system that analyzes notes and suggests improvements for structure, duplicate content, task extraction, and tags.

## User Guide

### Starting a Cleanup

1. Open any note in the editor
2. Click the "Cleanup" button in the toolbar (sparkles icon)
3. Wait 10-15 seconds for AI analysis
4. Review suggestions in the modal dialog

### Reviewing Suggestions

Suggestions are organized into four tabs:

- **Structure**: Improved headings, better organization
- **Duplicates**: Consolidated repetitive content
- **Tasks**: Action items to extract as task recommendations
- **Tags**: Suggested tags based on content

Each suggestion shows:
- Confidence level (0-100%)
- Before/after diff (for replacements)
- Reasoning for the suggestion
- Checkbox to approve/reject

High confidence suggestions (>85%) are pre-selected.

### Applying Changes

1. Toggle checkboxes to approve/reject individual suggestions
2. Click "Apply X Changes" button
3. Changes are applied immediately
4. Extracted tasks appear in task recommendations
5. All changes are logged for undo capability

### Undoing Changes

All cleanup operations are logged in activity history:
1. Changes can be reverted by restoring from activity log
2. Full before/after content is preserved
3. Undo functionality (coming soon)

## Technical Details

### Architecture

- **Chunking**: Notes >3000 chars split by markdown headings
- **AI Model**: OpenRouter fast_llm tier (Grok 4.1 Fast)
- **Caching**: Not currently cached (real-time analysis)
- **Cost**: ~$0.002-0.005 per analysis

### API Endpoints

#### POST /api/notes/[id]/cleanup
Analyze note for cleanup suggestions.

**Response:**
```json
{
  "suggestions": [...],
  "chunked": false,
  "chunkCount": 1
}
```

#### PATCH /api/notes/[id]/cleanup
Apply approved suggestions.

**Request:**
```json
{
  "suggestions": [...]
}
```

**Response:**
```json
{
  "note": {...},
  "taskRecommendationsCreated": 2,
  "suggestedTags": ["tag1", "tag2"]
}
```

### Database Schema

Activity log entries:
- `cleanup_started`: Snapshot before analysis
- `cleanup_applied`: Applied changes with full audit trail

Task recommendations:
- Extracted tasks stored in `task_recommendations` table
- Linked to source note via `source_id`

## Limitations

- Minimum note length: 100 characters
- Maximum suggestions per type: 10
- Confidence threshold: 0.7 (70%)
- Analysis timeout: Not currently enforced

## Future Enhancements

- Batch cleanup for multiple notes
- Custom confidence thresholds
- Cleanup presets and preferences
- Visual diff viewer improvements
- One-click undo from activity log
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests passing

**Step 3: Run type checking**

Run: `npm run typecheck`
Expected: No type errors

**Step 4: Manual end-to-end test**

1. Start dev server: `npm run dev`
2. Create a messy note with:
   - Poor heading structure
   - Duplicate content
   - Embedded action items
   - Relevant tags missing
3. Click Cleanup button
4. Review all four tabs
5. Approve some suggestions
6. Apply changes
7. Verify note updated
8. Check task recommendations page
9. Verify activity log entry created

**Step 5: Final commit**

```bash
git add docs/features/note-cleanup.md
git commit -m "docs: add note cleanup feature documentation

- User guide for cleanup workflow
- Technical architecture details
- API endpoint documentation
- Database schema reference
"
```

---

## Summary

This plan implements the intelligent note cleanup feature with:

1. **Chunking Service** - Smart content splitting for large notes
2. **Analyzer Service** - AI-powered suggestion generation
3. **Applier Service** - Safe application of approved changes
4. **API Routes** - RESTful endpoints for analyze and apply
5. **UI Components** - Modal dialog with tabbed suggestion review
6. **Integration** - Cleanup button in note editor toolbar
7. **Testing** - Unit and integration tests for all layers
8. **Documentation** - User and technical documentation

**Total Implementation Time**: ~3-4 hours for experienced developer

**Key Files Created**:
- `src/lib/cleanup/chunker.ts`
- `src/lib/cleanup/analyzer.ts`
- `src/lib/cleanup/applier.ts`
- `src/lib/cleanup/types.ts`
- `src/app/api/notes/[id]/cleanup/route.ts`
- `src/components/notes/suggestion-card.tsx`
- `src/components/notes/cleanup-modal.tsx`
- Tests and documentation

**Database Changes**: None (uses existing `activity_log` and `task_recommendations` tables)
