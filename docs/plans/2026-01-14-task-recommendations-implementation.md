# AI Task Recommendations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered task recommendation system that learns from user feedback to identify actionable tasks in notes.

**Architecture:** Three-tier system: (1) deduplication engine checks for existing/similar tasks, (2) few-shot learning system uses past feedback to train LLM prompts, (3) smart auto-scan triggers based on inactivity + content delta.

**Tech Stack:** TypeScript, Next.js App Router, Turso SQLite, OpenRouter LLM, existing embeddings infrastructure

---

## Phase 1: Database Foundation

### Task 1: Create task_recommendations table migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: Manual verification via migration script

**Step 1: Add task_recommendations table to schema**

In `src/lib/db/schema.ts`, add after the `tasks` table definition (around line 157):

```typescript
CREATE TABLE IF NOT EXISTS task_recommendations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source information
  source_type TEXT NOT NULL CHECK (source_type IN ('note', 'daily_note', 'capture')),
  source_id TEXT NOT NULL,
  source_text TEXT NOT NULL,

  -- Recommendation details
  recommended_task TEXT NOT NULL,
  confidence REAL DEFAULT 0.7,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  reasoning TEXT,

  -- User feedback
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dismissed', 'expired')),
  user_feedback TEXT,
  feedback_at TEXT,

  -- If accepted, link to created task
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

  -- Embedding for similarity search
  source_embedding_id TEXT REFERENCES embeddings(id) ON DELETE SET NULL,

  -- Expiration
  expires_at TEXT DEFAULT (datetime('now', '+30 days')),

  created_at TEXT DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_task_rec_user ON task_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_task_rec_status ON task_recommendations(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_task_rec_source ON task_recommendations(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_task_rec_feedback ON task_recommendations(user_id, user_feedback, created_at);
CREATE INDEX IF NOT EXISTS idx_task_rec_cleanup ON task_recommendations(status, created_at);
```

**Step 2: Update processing_queue operation constraint**

In the same file, find the `processing_queue` table (around line 345) and update the operation CHECK constraint:

```typescript
operation TEXT NOT NULL CHECK (operation IN (
  'generate_embedding', 'generate_summary', 'generate_tags',
  'find_connections', 'analyze_capture', 'recompute_all',
  'scan_for_tasks'  -- NEW
)),
```

**Step 3: Add TypeScript interface for TaskRecommendation**

At the end of `src/lib/db/schema.ts` (after line 576), add:

```typescript
export interface TaskRecommendation {
  id: string;
  user_id: string;
  source_type: 'note' | 'daily_note' | 'capture';
  source_id: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  reasoning: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'dismissed' | 'expired';
  user_feedback: string | null;
  feedback_at: string | null;
  task_id: string | null;
  source_embedding_id: string | null;
  expires_at: string;
  created_at: string;
  metadata: string;
}
```

**Step 4: Run migration**

```bash
npm run db:migrate
```

Expected: Migration runs successfully, table created

**Step 5: Verify table exists**

```bash
npx tsx -e "import { db } from './src/lib/db/client'; const result = await db.execute({ sql: 'SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"task_recommendations\"', args: [] }); console.log(result.rows);"
```

Expected: Outputs `[{ name: 'task_recommendations' }]`

**Step 6: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat: add task_recommendations table and update schema

- Add task_recommendations table with feedback tracking
- Update processing_queue to support scan_for_tasks operation
- Add TaskRecommendation TypeScript interface"
```

---

## Phase 2: Core Utilities

### Task 2: Create recommendations utility module

**Files:**
- Create: `src/lib/recommendations/utils.ts`
- Test: `tests/lib/recommendations/utils.test.ts`

**Step 1: Write test for candidate extraction**

Create `tests/lib/recommendations/utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractCandidates, hasActionIndicators } from '@/lib/recommendations/utils';

describe('extractCandidates', () => {
  it('should split content into sentences', () => {
    const content = 'First sentence. Second sentence! Third sentence?';
    const candidates = extractCandidates(content);

    expect(candidates).toHaveLength(3);
    expect(candidates[0].text).toBe('First sentence');
    expect(candidates[1].text).toBe('Second sentence');
  });

  it('should include context from surrounding sentences', () => {
    const content = 'Before. Target sentence here. After.';
    const candidates = extractCandidates(content);

    const targetCandidate = candidates.find(c => c.text === 'Target sentence here');
    expect(targetCandidate?.context).toContain('Before');
    expect(targetCandidate?.context).toContain('After');
  });

  it('should filter out very short sentences', () => {
    const content = 'Hi. This is a longer sentence that should be included.';
    const candidates = extractCandidates(content);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe('This is a longer sentence that should be included');
  });
});

describe('hasActionIndicators', () => {
  it('should detect action verbs', () => {
    expect(hasActionIndicators('need to review the budget')).toBe(true);
    expect(hasActionIndicators('should contact Sarah')).toBe(true);
    expect(hasActionIndicators('must fix the bug')).toBe(true);
  });

  it('should reject non-actionable text', () => {
    expect(hasActionIndicators('thinking about the project')).toBe(false);
    expect(hasActionIndicators('the meeting was good')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/lib/recommendations/utils.test.ts
```

Expected: FAIL - Module not found

**Step 3: Create utils module with implementations**

Create `src/lib/recommendations/utils.ts`:

```typescript
/**
 * Utility functions for task recommendation system
 */

export interface Candidate {
  text: string;
  context: string;
}

/**
 * Extract candidate sentences from content
 */
export function extractCandidates(content: string): Candidate[] {
  // Split by sentences (., !, ?)
  const sentences = content
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10); // Filter out very short sentences

  const candidates: Candidate[] = [];

  for (let i = 0; i < sentences.length; i++) {
    // Create context window (1 before, 1 after)
    const contextStart = Math.max(0, i - 1);
    const contextEnd = Math.min(sentences.length, i + 2);
    const context = sentences.slice(contextStart, contextEnd).join('. ');

    candidates.push({
      text: sentences[i],
      context: context
    });
  }

  return candidates;
}

/**
 * Check if text contains action indicators (verbs, time language)
 */
export function hasActionIndicators(text: string): boolean {
  const actionVerbs = [
    'need to', 'should', 'must', 'have to', 'going to',
    'review', 'check', 'contact', 'reach out', 'send', 'email',
    'create', 'build', 'fix', 'update', 'finish', 'complete',
    'schedule', 'plan', 'prepare', 'research', 'investigate'
  ];

  const lowerText = text.toLowerCase();
  return actionVerbs.some(verb => lowerText.includes(verb));
}

/**
 * Detect time-based language in text
 */
export function hasTimeLanguage(text: string): boolean {
  const timeWords = [
    'today', 'tomorrow', 'this week', 'next week', 'monday', 'tuesday',
    'wednesday', 'thursday', 'friday', 'by friday', 'before', 'deadline',
    'due', 'asap', 'urgent'
  ];

  const lowerText = text.toLowerCase();
  return timeWords.some(word => lowerText.includes(word));
}

/**
 * Count words in text
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test tests/lib/recommendations/utils.test.ts
```

Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/lib/recommendations/utils.ts tests/lib/recommendations/utils.test.ts
git commit -m "feat: add recommendation utility functions

- extractCandidates: split content into sentences with context
- hasActionIndicators: detect action verbs in text
- hasTimeLanguage: detect time-based language
- countWords: simple word counter"
```

---

### Task 3: Create deduplication engine

**Files:**
- Create: `src/lib/recommendations/deduplication.ts`
- Test: `tests/lib/recommendations/deduplication.test.ts`

**Step 1: Write test for isDuplicate function**

Create `tests/lib/recommendations/deduplication.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isDuplicate } from '@/lib/recommendations/deduplication';
import { cosineSimilarity } from '@/lib/ai/embeddings';

// Mock the database queries
vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn()
}));

vi.mock('@/lib/ai/embeddings', () => ({
  cosineSimilarity: vi.fn()
}));

describe('isDuplicate', () => {
  const userId = 'user123';
  const taskText = 'Review Q1 budget';
  const embedding = [0.1, 0.2, 0.3];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect duplicate active tasks with high similarity', async () => {
    const { queryAll, queryOne } = await import('@/lib/db/client');
    const mockCosineSimilarity = vi.mocked(cosineSimilarity);

    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: 'task1',
        content: 'Review Q1 budget',
        status: 'pending',
        embedding: JSON.stringify([0.15, 0.21, 0.29])
      }
    ]);

    mockCosineSimilarity.mockReturnValue(0.95); // High similarity

    vi.mocked(queryAll).mockResolvedValueOnce([]); // No recommendations
    vi.mocked(queryOne).mockResolvedValueOnce(null); // No exact match

    const result = await isDuplicate(userId, taskText, embedding);

    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toBe('already_exists');
  });

  it('should allow tasks if similarity is below threshold', async () => {
    const { queryAll, queryOne } = await import('@/lib/db/client');
    const mockCosineSimilarity = vi.mocked(cosineSimilarity);

    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        id: 'task1',
        content: 'Different task',
        status: 'pending',
        embedding: JSON.stringify([0.9, 0.8, 0.7])
      }
    ]);

    mockCosineSimilarity.mockReturnValue(0.3); // Low similarity

    vi.mocked(queryAll).mockResolvedValueOnce([]); // No recommendations
    vi.mocked(queryOne).mockResolvedValueOnce(null); // No exact match

    const result = await isDuplicate(userId, taskText, embedding);

    expect(result.isDuplicate).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/lib/recommendations/deduplication.test.ts
```

Expected: FAIL - Module not found

**Step 3: Implement deduplication engine**

Create `src/lib/recommendations/deduplication.ts`:

```typescript
import { queryAll, queryOne } from '@/lib/db/client';
import { cosineSimilarity } from '@/lib/ai/embeddings';
import { Task, TaskRecommendation } from '@/lib/db/schema';

const SIMILARITY_THRESHOLD = 0.85;
const COMPLETED_TASK_WINDOW_DAYS = 30;
const RECENT_RECOMMENDATION_WINDOW_DAYS = 7;

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason?: string;
}

/**
 * Check if a task is a duplicate of existing tasks or recommendations
 *
 * Three-level check:
 * 1. Existing tasks (pending, in_progress, recently completed)
 * 2. Recent recommendations (pending, rejected)
 * 3. Exact text match (fallback)
 */
export async function isDuplicate(
  userId: string,
  taskText: string,
  embedding: number[]
): Promise<DuplicateCheckResult> {

  // Level 1: Check existing tasks
  const existingTasks = await queryAll<Task & { embedding: string | null }>(
    `SELECT t.*, e.embedding
     FROM tasks t
     LEFT JOIN embeddings e ON e.entity_type = 'task' AND e.entity_id = t.id
     WHERE t.user_id = ? AND (
       t.status IN ('pending', 'in_progress')
       OR (t.status = 'completed' AND t.completed_at >= datetime('now', '-${COMPLETED_TASK_WINDOW_DAYS} days'))
     )`,
    [userId]
  );

  for (const task of existingTasks) {
    if (task.embedding) {
      try {
        const taskEmbedding = JSON.parse(task.embedding);
        const similarity = cosineSimilarity(embedding, taskEmbedding);

        if (similarity > SIMILARITY_THRESHOLD) {
          if (task.status === 'completed') {
            return { isDuplicate: true, reason: 'completed_recently' };
          } else {
            return { isDuplicate: true, reason: 'already_exists' };
          }
        }
      } catch (error) {
        console.warn('Failed to parse task embedding:', error);
        // Continue checking other tasks
      }
    }
  }

  // Level 2: Check recent recommendations
  const recentRecs = await queryAll<TaskRecommendation & { embedding: string | null }>(
    `SELECT tr.*, e.embedding
     FROM task_recommendations tr
     LEFT JOIN embeddings e ON tr.source_embedding_id = e.id
     WHERE tr.user_id = ?
     AND tr.created_at >= datetime('now', '-${RECENT_RECOMMENDATION_WINDOW_DAYS} days')
     AND tr.status IN ('pending', 'rejected')`,
    [userId]
  );

  for (const rec of recentRecs) {
    if (rec.embedding) {
      try {
        const recEmbedding = JSON.parse(rec.embedding);
        const similarity = cosineSimilarity(embedding, recEmbedding);

        if (similarity > SIMILARITY_THRESHOLD) {
          if (rec.status === 'rejected') {
            return { isDuplicate: true, reason: 'previously_rejected' };
          }
          if (rec.status === 'pending') {
            return { isDuplicate: true, reason: 'already_recommended' };
          }
        }
      } catch (error) {
        console.warn('Failed to parse recommendation embedding:', error);
        // Continue checking other recommendations
      }
    }
  }

  // Level 3: Exact text match (fallback if embeddings fail)
  const normalizedText = taskText.toLowerCase().trim();
  const exactMatch = await queryOne(
    `SELECT id FROM tasks
     WHERE user_id = ? AND LOWER(TRIM(content)) = ? AND status != 'cancelled'`,
    [userId, normalizedText]
  );

  if (exactMatch) {
    return { isDuplicate: true, reason: 'exact_match' };
  }

  return { isDuplicate: false };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test tests/lib/recommendations/deduplication.test.ts
```

Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/lib/recommendations/deduplication.ts tests/lib/recommendations/deduplication.test.ts
git commit -m "feat: add deduplication engine for task recommendations

Three-level duplicate detection:
- Check existing tasks with semantic similarity (0.85 threshold)
- Check recent recommendations (7-day window)
- Fallback to exact text match

Blocks duplicates from completed tasks within 30 days"
```

---

### Task 4: Create learning system (few-shot prompting)

**Files:**
- Create: `src/lib/recommendations/learning.ts`
- Test: `tests/lib/recommendations/learning.test.ts`

**Step 1: Write test for findSimilarRecommendations**

Create `tests/lib/recommendations/learning.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { findSimilarRecommendations, buildTaskRecommendationPrompt } from '@/lib/recommendations/learning';

vi.mock('@/lib/db/client', () => ({
  queryAll: vi.fn()
}));

vi.mock('@/lib/ai/embeddings', () => ({
  cosineSimilarity: vi.fn()
}));

describe('findSimilarRecommendations', () => {
  it('should find and rank similar recommendations by similarity score', async () => {
    const { queryAll } = await import('@/lib/db/client');
    const { cosineSimilarity } = await import('@/lib/ai/embeddings');

    const mockRecommendations = [
      {
        id: 'rec1',
        source_text: 'need to review budget',
        recommended_task: 'Review budget',
        reasoning: 'Action verb',
        embedding: JSON.stringify([0.1, 0.2, 0.3])
      },
      {
        id: 'rec2',
        source_text: 'should contact client',
        recommended_task: 'Contact client',
        reasoning: 'Action verb',
        embedding: JSON.stringify([0.4, 0.5, 0.6])
      }
    ];

    vi.mocked(queryAll).mockResolvedValue(mockRecommendations);
    vi.mocked(cosineSimilarity)
      .mockReturnValueOnce(0.9)  // rec1 - high similarity
      .mockReturnValueOnce(0.3); // rec2 - low similarity

    const results = await findSimilarRecommendations(
      'user123',
      [0.1, 0.2, 0.3],
      'accepted',
      5
    );

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('rec1'); // Higher similarity first
    expect(results[0].similarity).toBe(0.9);
  });
});

describe('buildTaskRecommendationPrompt', () => {
  it('should include accepted and rejected examples in prompt', async () => {
    const { queryAll } = await import('@/lib/db/client');
    const { cosineSimilarity } = await import('@/lib/ai/embeddings');

    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        {
          source_text: 'need to review',
          recommended_task: 'Review',
          reasoning: 'Action',
          embedding: JSON.stringify([0.1, 0.2])
        }
      ])
      .mockResolvedValueOnce([
        {
          source_text: 'thinking about it',
          recommended_task: '',
          reasoning: 'Not actionable',
          embedding: JSON.stringify([0.3, 0.4])
        }
      ]);

    vi.mocked(cosineSimilarity).mockReturnValue(0.5);

    const prompt = await buildTaskRecommendationPrompt(
      'should contact Sarah',
      [0.5, 0.5],
      'user123'
    );

    expect(prompt).toContain('POSITIVE EXAMPLES');
    expect(prompt).toContain('need to review');
    expect(prompt).toContain('NEGATIVE EXAMPLES');
    expect(prompt).toContain('thinking about it');
    expect(prompt).toContain('should contact Sarah');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/lib/recommendations/learning.test.ts
```

Expected: FAIL - Module not found

**Step 3: Implement learning system**

Create `src/lib/recommendations/learning.ts`:

```typescript
import { queryAll } from '@/lib/db/client';
import { cosineSimilarity } from '@/lib/ai/embeddings';
import { TaskRecommendation } from '@/lib/db/schema';

export interface TaskRecommendationWithSimilarity extends TaskRecommendation {
  embedding?: string;
  similarity?: number;
}

/**
 * Find similar recommendations by embedding similarity
 * Used for few-shot learning examples
 */
export async function findSimilarRecommendations(
  userId: string,
  embedding: number[],
  feedback: 'accepted' | 'rejected',
  limit: number
): Promise<TaskRecommendationWithSimilarity[]> {

  // Get all recommendations with this feedback status
  const recommendations = await queryAll<TaskRecommendation & { embedding: string | null }>(
    `SELECT tr.*, e.embedding
     FROM task_recommendations tr
     LEFT JOIN embeddings e ON tr.source_embedding_id = e.id
     WHERE tr.user_id = ? AND tr.user_feedback = ?
     ORDER BY tr.feedback_at DESC
     LIMIT 100`,
    [userId, feedback]
  );

  // Calculate similarity scores
  const withScores = recommendations
    .filter(rec => rec.embedding !== null)
    .map(rec => {
      try {
        const recEmbedding = JSON.parse(rec.embedding!);
        return {
          ...rec,
          similarity: cosineSimilarity(embedding, recEmbedding)
        };
      } catch (error) {
        console.warn('Failed to parse embedding:', error);
        return null;
      }
    })
    .filter((rec): rec is TaskRecommendationWithSimilarity => rec !== null);

  // Sort by similarity descending and take top N
  return withScores
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);
}

/**
 * Build a prompt with few-shot examples for task recommendation
 */
export async function buildTaskRecommendationPrompt(
  candidateText: string,
  candidateEmbedding: number[],
  userId: string
): Promise<string> {

  // Fetch similar accepted examples
  const acceptedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'accepted',
    5
  );

  // Fetch similar rejected examples
  const rejectedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'rejected',
    5
  );

  const positiveExamples = acceptedExamples.length > 0
    ? acceptedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Task: "${ex.recommended_task}"
   Why: ${ex.reasoning || 'User accepted this as actionable'}
`).join('\n')
    : '\n(No examples yet - learning from your first feedback)\n';

  const negativeExamples = rejectedExamples.length > 0
    ? rejectedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Why: ${ex.reasoning || 'User determined this was not actionable'}
`).join('\n')
    : '\n(No examples yet - learning from your first feedback)\n';

  return `You are a task detection assistant that learns from user feedback. Analyze text to identify actionable tasks.

POSITIVE EXAMPLES (user accepted these as tasks):${positiveExamples}

NEGATIVE EXAMPLES (user rejected these - NOT tasks):${negativeExamples}

Now analyze this text and determine if it contains an actionable task:

Text: "${candidateText}"

Return JSON with:
{
  "isTask": boolean,
  "taskText": string | null,
  "reasoning": string,
  "confidence": number,
  "priority": "low" | "medium" | "high" | "urgent"
}

Rules:
- Tasks have clear action verbs (review, contact, fix, create, send, etc.)
- Tasks should be specific and actionable, not vague contemplation
- Time-based language (today, tomorrow, this week) suggests tasks
- Past tense usually means not a task (already done)
- Questions are usually not tasks unless they imply follow-up action`;
}

/**
 * Calculate final confidence score with boosting/penalties
 */
export function calculateFinalConfidence(
  llmConfidence: number,
  acceptedSimilarityMax: number,
  rejectedSimilarityMax: number,
  hasActionVerbs: boolean,
  hasTimeLanguage: boolean
): number {

  let confidence = llmConfidence;

  // Boost for similarity to accepted examples
  if (acceptedSimilarityMax > 0.8) confidence += 0.2;
  else if (acceptedSimilarityMax > 0.6) confidence += 0.1;

  // Penalty for similarity to rejected examples
  if (rejectedSimilarityMax > 0.8) confidence -= 0.3;
  else if (rejectedSimilarityMax > 0.6) confidence -= 0.15;

  // Boost for action indicators
  if (hasActionVerbs) confidence += 0.1;
  if (hasTimeLanguage) confidence += 0.1;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, confidence));
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test tests/lib/recommendations/learning.test.ts
```

Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/lib/recommendations/learning.ts tests/lib/recommendations/learning.test.ts
git commit -m "feat: add few-shot learning system for task recommendations

- findSimilarRecommendations: find top N similar examples by embedding
- buildTaskRecommendationPrompt: construct prompt with positive/negative examples
- calculateFinalConfidence: boost/penalize confidence based on similarity

System learns from user feedback to improve recommendations"
```

---

## Phase 3: Scan Engine

### Task 5: Create main scan function

**Files:**
- Create: `src/lib/recommendations/scanner.ts`
- Test: `tests/lib/recommendations/scanner.test.ts`

**Step 1: Write test for scanForTasks**

Create `tests/lib/recommendations/scanner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanForTasks } from '@/lib/recommendations/scanner';

vi.mock('@/lib/db/client');
vi.mock('@/lib/ai/embeddings');
vi.mock('@/lib/ai/client');
vi.mock('@/lib/processing/cache');
vi.mock('@/lib/recommendations/deduplication');
vi.mock('@/lib/recommendations/learning');

describe('scanForTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract candidates and generate recommendations', async () => {
    const { queryOne, db } = await import('@/lib/db/client');
    const { generateEmbedding } = await import('@/lib/ai/embeddings');
    const { complete } = await import('@/lib/ai/client');
    const { getCached } = await import('@/lib/processing/cache');
    const { isDuplicate } = await import('@/lib/recommendations/deduplication');
    const { buildTaskRecommendationPrompt } = await import('@/lib/recommendations/learning');

    // Mock note content
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'note1',
      content: 'Need to review the Q1 budget. Should contact Sarah about it.'
    });

    // Mock embeddings
    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

    // Mock deduplication (allow all)
    vi.mocked(isDuplicate).mockResolvedValue({ isDuplicate: false });

    // Mock learning system
    vi.mocked(buildTaskRecommendationPrompt).mockResolvedValue('Mock prompt');

    // Mock cache (no cached results)
    vi.mocked(getCached).mockResolvedValue(null);

    // Mock LLM response
    vi.mocked(complete).mockResolvedValue(JSON.stringify({
      isTask: true,
      taskText: 'Review Q1 budget',
      reasoning: 'Action verb with clear subject',
      confidence: 0.85,
      priority: 'medium'
    }));

    // Mock database insert
    vi.mocked(db.execute).mockResolvedValue({ rows: [], rowsAffected: 1, lastInsertRowid: 1 });

    const result = await scanForTasks('user123', 'note', 'note1');

    expect(result.recommendationCount).toBeGreaterThan(0);
    expect(result.recommendations[0].recommended_task).toBe('Review Q1 budget');
  });

  it('should skip duplicates', async () => {
    const { queryOne } = await import('@/lib/db/client');
    const { generateEmbedding } = await import('@/lib/ai/embeddings');
    const { isDuplicate } = await import('@/lib/recommendations/deduplication');

    vi.mocked(queryOne).mockResolvedValueOnce({
      id: 'note1',
      content: 'Need to review the budget.'
    });

    vi.mocked(generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

    // Mock deduplication (mark as duplicate)
    vi.mocked(isDuplicate).mockResolvedValue({
      isDuplicate: true,
      reason: 'already_exists'
    });

    const result = await scanForTasks('user123', 'note', 'note1');

    expect(result.recommendationCount).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test tests/lib/recommendations/scanner.test.ts
```

Expected: FAIL - Module not found

**Step 3: Implement scanner**

Create `src/lib/recommendations/scanner.ts`:

```typescript
import { queryOne, queryAll, db } from '@/lib/db/client';
import { generateEmbedding } from '@/lib/ai/embeddings';
import { complete } from '@/lib/ai/client';
import { getCached, setCache, generateCacheKey, hashContent } from '@/lib/processing/cache';
import { isDuplicate } from './deduplication';
import { buildTaskRecommendationPrompt, calculateFinalConfidence } from './learning';
import { extractCandidates, hasActionIndicators, hasTimeLanguage } from './utils';
import { Note, DailyNote, Capture, TaskRecommendation } from '@/lib/db/schema';

interface ScanResult {
  scannedCount: number;
  recommendationCount: number;
  recommendations: TaskRecommendation[];
}

interface LLMTaskResult {
  isTask: boolean;
  taskText: string | null;
  reasoning: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * Load source content based on type
 */
async function loadSourceContent(
  sourceType: string,
  sourceId: string
): Promise<string> {
  if (sourceType === 'note') {
    const note = await queryOne<Note>(
      'SELECT content FROM notes WHERE id = ?',
      [sourceId]
    );
    return note?.content || '';
  } else if (sourceType === 'daily_note') {
    const dailyNote = await queryOne<{ content: string }>(
      `SELECT n.content FROM daily_notes dn
       JOIN notes n ON dn.note_id = n.id
       WHERE dn.id = ?`,
      [sourceId]
    );
    return dailyNote?.content || '';
  } else if (sourceType === 'capture') {
    const capture = await queryOne<Capture>(
      'SELECT content FROM captures WHERE id = ?',
      [sourceId]
    );
    return capture?.content || '';
  }
  return '';
}

/**
 * Store embedding for task candidate
 */
async function storeEmbedding(
  userId: string,
  entityType: string,
  entityId: string | null,
  embedding: number[]
): Promise<string> {
  const embeddingJson = JSON.stringify(embedding);
  const contentHash = hashContent(embeddingJson);

  await db.execute({
    sql: `INSERT INTO embeddings (user_id, entity_type, entity_id, embedding, content_hash)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userId, entityType, entityId, embeddingJson, contentHash]
  });

  const result = await queryOne<{ id: string }>(
    'SELECT id FROM embeddings WHERE user_id = ? AND content_hash = ? ORDER BY created_at DESC LIMIT 1',
    [userId, contentHash]
  );

  return result?.id || '';
}

/**
 * Store a task recommendation
 */
async function storeRecommendation(rec: Omit<TaskRecommendation, 'id' | 'created_at' | 'expires_at' | 'metadata'>): Promise<string> {
  await db.execute({
    sql: `INSERT INTO task_recommendations
          (user_id, source_type, source_id, source_text, recommended_task,
           confidence, priority, reasoning, status, source_embedding_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      rec.user_id,
      rec.source_type,
      rec.source_id,
      rec.source_text,
      rec.recommended_task,
      rec.confidence,
      rec.priority,
      rec.reasoning,
      rec.status,
      rec.source_embedding_id
    ]
  });

  const result = await queryOne<{ id: string }>(
    'SELECT id FROM task_recommendations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [rec.user_id]
  );

  return result?.id || '';
}

/**
 * Main scan function - extracts candidates and generates recommendations
 */
export async function scanForTasks(
  userId: string,
  sourceType: string,
  sourceId: string
): Promise<ScanResult> {

  // 1. Load content
  const content = await loadSourceContent(sourceType, sourceId);

  if (!content || content.trim().length === 0) {
    return {
      scannedCount: 0,
      recommendationCount: 0,
      recommendations: []
    };
  }

  // 2. Extract candidate sentences
  const candidates = extractCandidates(content);

  // 3. Filter using local processing
  const filtered = candidates.filter(c => hasActionIndicators(c.text));

  // 4. Process each candidate (max 20)
  const recommendations: TaskRecommendation[] = [];

  for (const candidate of filtered.slice(0, 20)) {
    try {
      // Generate embedding
      const embedding = await generateEmbedding(candidate.text);

      // Check for duplicates
      const dupCheck = await isDuplicate(userId, candidate.text, embedding);
      if (dupCheck.isDuplicate) {
        console.log(`Skipping duplicate: ${dupCheck.reason}`);
        continue;
      }

      // Store embedding
      const embeddingId = await storeEmbedding(userId, 'task_candidate', null, embedding);

      // Build prompt with learning examples
      const prompt = await buildTaskRecommendationPrompt(candidate.text, embedding, userId);

      // Check cache
      const cacheKey = generateCacheKey('task_recommendation', {
        text: hashContent(candidate.text),
        userId: userId
      });

      let result = await getCached<LLMTaskResult>(userId, cacheKey);

      if (!result) {
        // Call LLM
        const response = await complete(prompt, {
          temperature: 0.3,
          maxTokens: 300
        });

        try {
          result = JSON.parse(response);
        } catch (error) {
          console.warn('Failed to parse LLM response:', error);
          continue;
        }

        // Cache result
        await setCache(userId, cacheKey, result, {
          operation: 'task_recommendation',
          tier: 'fast_llm',
          ttlHours: 24
        });
      }

      // Apply confidence boosting
      const hasAction = hasActionIndicators(candidate.text);
      const hasTime = hasTimeLanguage(candidate.text);
      const finalConfidence = calculateFinalConfidence(
        result.confidence,
        0, // TODO: Get max similarity to accepted examples
        0, // TODO: Get max similarity to rejected examples
        hasAction,
        hasTime
      );

      // Only keep if LLM says it's a task and confidence > 0.5
      if (result.isTask && finalConfidence > 0.5) {
        const recId = await storeRecommendation({
          user_id: userId,
          source_type: sourceType as 'note' | 'daily_note' | 'capture',
          source_id: sourceId,
          source_text: candidate.text,
          recommended_task: result.taskText || candidate.text,
          confidence: finalConfidence,
          priority: result.priority,
          reasoning: result.reasoning,
          status: 'pending',
          source_embedding_id: embeddingId,
          user_feedback: null,
          feedback_at: null,
          task_id: null
        });

        const stored = await queryOne<TaskRecommendation>(
          'SELECT * FROM task_recommendations WHERE id = ?',
          [recId]
        );

        if (stored) {
          recommendations.push(stored);
        }
      }
    } catch (error) {
      console.error('Error processing candidate:', error);
      // Continue with next candidate
    }
  }

  // 5. Sort by confidence and keep top 10
  recommendations.sort((a, b) => b.confidence - a.confidence);
  const topRecommendations = recommendations.slice(0, 10);

  return {
    scannedCount: filtered.length,
    recommendationCount: topRecommendations.length,
    recommendations: topRecommendations
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test tests/lib/recommendations/scanner.test.ts
```

Expected: PASS - All tests green

**Step 5: Commit**

```bash
git add src/lib/recommendations/scanner.ts tests/lib/recommendations/scanner.test.ts
git commit -m "feat: add main task scanning engine

- scanForTasks: extract candidates, check duplicates, call LLM
- loadSourceContent: load from note/daily_note/capture
- storeEmbedding/storeRecommendation: persist to database
- Applies confidence boosting and filters by threshold"
```

---

## Phase 4: API Endpoints

### Task 6: Create scan API endpoint

**Files:**
- Create: `src/app/api/tasks/recommendations/scan/route.ts`
- Test: Manual testing via curl/Postman

**Step 1: Create scan endpoint**

Create `src/app/api/tasks/recommendations/scan/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { scanForTasks } from '@/lib/recommendations/scanner';
import { queryOne, queryAll, db } from '@/lib/db/client';

// POST /api/tasks/recommendations/scan
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sourceType, sourceId, daysBack = 7 } = body;

    // Validate sourceType
    if (!['note', 'daily_note', 'capture', 'recent'].includes(sourceType)) {
      return NextResponse.json(
        { error: 'Invalid sourceType. Must be: note, daily_note, capture, or recent' },
        { status: 400 }
      );
    }

    // Check for existing pending scan job
    if (sourceType !== 'recent' && sourceId) {
      const existingJob = await queryOne(
        `SELECT id, status FROM processing_queue
         WHERE user_id = ? AND entity_type = ? AND entity_id = ?
         AND operation = 'scan_for_tasks' AND status IN ('pending', 'processing')`,
        [user.id, sourceType, sourceId]
      );

      if (existingJob) {
        return NextResponse.json({
          status: 'already_scanning',
          jobId: existingJob.id,
          message: 'Scan already in progress'
        });
      }
    }

    // Handle 'recent' sourceType - scan recent notes
    if (sourceType === 'recent') {
      const recentNotes = await queryAll<{ id: string; note_type: string }>(
        `SELECT id, note_type FROM notes
         WHERE user_id = ? AND updated_at >= datetime('now', '-${daysBack} days')
         AND is_archived = FALSE
         ORDER BY updated_at DESC
         LIMIT 10`,
        [user.id]
      );

      let totalScanned = 0;
      let totalRecommendations = 0;
      const allRecommendations = [];

      for (const note of recentNotes) {
        const result = await scanForTasks(user.id, 'note', note.id);
        totalScanned += result.scannedCount;
        totalRecommendations += result.recommendationCount;
        allRecommendations.push(...result.recommendations);
      }

      return NextResponse.json({
        scannedCount: totalScanned,
        recommendationCount: totalRecommendations,
        recommendations: allRecommendations.slice(0, 10) // Top 10 overall
      });
    }

    // Single source scan
    if (!sourceId) {
      return NextResponse.json(
        { error: 'sourceId required when sourceType is not "recent"' },
        { status: 400 }
      );
    }

    const result = await scanForTasks(user.id, sourceType, sourceId);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Scan error:', error);
    return NextResponse.json(
      { error: 'Failed to scan for tasks' },
      { status: 500 }
    );
  }
}
```

**Step 2: Test endpoint manually**

```bash
# Start dev server
npm run dev

# In another terminal, test the endpoint
curl -X POST http://localhost:3000/api/tasks/recommendations/scan \
  -H "Content-Type: application/json" \
  -d '{"sourceType": "recent", "daysBack": 7}' \
  -H "Cookie: session=YOUR_SESSION_TOKEN"
```

Expected: Returns JSON with scannedCount and recommendations

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/scan/route.ts
git commit -m "feat: add task recommendation scan API endpoint

POST /api/tasks/recommendations/scan
- Supports sourceType: note, daily_note, capture, recent
- Prevents duplicate scans (checks processing queue)
- Returns recommendations sorted by confidence"
```

---

### Task 7: Create recommendations list endpoint

**Files:**
- Create: `src/app/api/tasks/recommendations/route.ts`

**Step 1: Create list endpoint**

Create `src/app/api/tasks/recommendations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryAll } from '@/lib/db/client';
import { TaskRecommendation } from '@/lib/db/schema';

// GET /api/tasks/recommendations
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status') || 'pending';
  const sourceType = searchParams.get('sourceType');
  const limit = parseInt(searchParams.get('limit') || '20');

  let query = `
    SELECT * FROM task_recommendations
    WHERE user_id = ? AND status = ?
  `;
  const args: (string | number)[] = [user.id, status];

  if (sourceType) {
    query += ' AND source_type = ?';
    args.push(sourceType);
  }

  query += ' ORDER BY confidence DESC, created_at DESC LIMIT ?';
  args.push(limit);

  const recommendations = await queryAll<TaskRecommendation>(query, args);

  // Check if there are more
  const countQuery = `
    SELECT COUNT(*) as count FROM task_recommendations
    WHERE user_id = ? AND status = ?
    ${sourceType ? 'AND source_type = ?' : ''}
  `;
  const countArgs = sourceType ? [user.id, status, sourceType] : [user.id, status];
  const countResult = await queryAll<{ count: number }>(countQuery, countArgs);
  const totalCount = countResult[0]?.count || 0;

  return NextResponse.json({
    recommendations,
    count: recommendations.length,
    hasMore: totalCount > limit
  });
}
```

**Step 2: Test endpoint**

```bash
curl http://localhost:3000/api/tasks/recommendations?status=pending \
  -H "Cookie: session=YOUR_SESSION_TOKEN"
```

Expected: Returns list of pending recommendations

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/route.ts
git commit -m "feat: add recommendations list API endpoint

GET /api/tasks/recommendations
- Filter by status (pending/accepted/rejected/dismissed)
- Filter by sourceType (optional)
- Pagination with limit parameter"
```

---

### Task 8: Create feedback endpoint

**Files:**
- Create: `src/app/api/tasks/recommendations/[id]/feedback/route.ts`

**Step 1: Create feedback endpoint**

Create `src/app/api/tasks/recommendations/[id]/feedback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { TaskRecommendation, Task } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/tasks/recommendations/[id]/feedback
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const { feedback, editedTask } = body;

    if (!['accepted', 'rejected'].includes(feedback)) {
      return NextResponse.json(
        { error: 'feedback must be "accepted" or "rejected"' },
        { status: 400 }
      );
    }

    // Get the recommendation
    const recommendation = await queryOne<TaskRecommendation>(
      'SELECT * FROM task_recommendations WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!recommendation) {
      return NextResponse.json(
        { error: 'Recommendation not found' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    if (feedback === 'accepted') {
      // Create the task
      const taskContent = editedTask || recommendation.recommended_task;

      await db.execute({
        sql: `INSERT INTO tasks (user_id, content, status, priority, note_id)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          user.id,
          taskContent,
          'pending',
          recommendation.priority,
          recommendation.source_type === 'note' ? recommendation.source_id : null
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
        args: ['accepted', 'accepted', now, task?.id, id]
      });

      const updatedRec = await queryOne<TaskRecommendation>(
        'SELECT * FROM task_recommendations WHERE id = ?',
        [id]
      );

      return NextResponse.json({
        recommendation: updatedRec,
        task: task
      });
    } else {
      // Rejected
      await db.execute({
        sql: `UPDATE task_recommendations
              SET status = ?, user_feedback = ?, feedback_at = ?
              WHERE id = ?`,
        args: ['rejected', 'rejected', now, id]
      });

      const updatedRec = await queryOne<TaskRecommendation>(
        'SELECT * FROM task_recommendations WHERE id = ?',
        [id]
      );

      return NextResponse.json({
        recommendation: updatedRec
      });
    }
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json(
      { error: 'Failed to process feedback' },
      { status: 500 }
    );
  }
}
```

**Step 2: Test endpoint**

```bash
# Accept a recommendation
curl -X POST http://localhost:3000/api/tasks/recommendations/rec123/feedback \
  -H "Content-Type: application/json" \
  -d '{"feedback": "accepted"}' \
  -H "Cookie: session=YOUR_SESSION_TOKEN"

# Reject a recommendation
curl -X POST http://localhost:3000/api/tasks/recommendations/rec456/feedback \
  -H "Content-Type: application/json" \
  -d '{"feedback": "rejected"}' \
  -H "Cookie: session=YOUR_SESSION_TOKEN"
```

Expected: Returns updated recommendation and task (if accepted)

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/[id]/feedback/route.ts
git commit -m "feat: add recommendation feedback API endpoint

POST /api/tasks/recommendations/[id]/feedback
- Accept: creates task and links to recommendation
- Reject: marks recommendation as rejected
- Both update user_feedback and feedback_at for learning"
```

---

### Task 9: Create dismiss endpoint

**Files:**
- Create: `src/app/api/tasks/recommendations/[id]/route.ts`

**Step 1: Create dismiss endpoint**

Create `src/app/api/tasks/recommendations/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { queryOne, db } from '@/lib/db/client';
import { TaskRecommendation } from '@/lib/db/schema';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// DELETE /api/tasks/recommendations/[id] - Dismiss recommendation
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;

    // Get the recommendation
    const recommendation = await queryOne<TaskRecommendation>(
      'SELECT * FROM task_recommendations WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!recommendation) {
      return NextResponse.json(
        { error: 'Recommendation not found' },
        { status: 404 }
      );
    }

    // Update to dismissed (doesn't provide feedback for learning)
    await db.execute({
      sql: `UPDATE task_recommendations SET status = ? WHERE id = ?`,
      args: ['dismissed', id]
    });

    const updatedRec = await queryOne<TaskRecommendation>(
      'SELECT * FROM task_recommendations WHERE id = ?',
      [id]
    );

    return NextResponse.json({
      success: true,
      recommendation: updatedRec
    });
  } catch (error) {
    console.error('Dismiss error:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss recommendation' },
      { status: 500 }
    );
  }
}
```

**Step 2: Test endpoint**

```bash
curl -X DELETE http://localhost:3000/api/tasks/recommendations/rec123 \
  -H "Cookie: session=YOUR_SESSION_TOKEN"
```

Expected: Returns success with updated recommendation

**Step 3: Commit**

```bash
git add src/app/api/tasks/recommendations/[id]/route.ts
git commit -m "feat: add recommendation dismiss API endpoint

DELETE /api/tasks/recommendations/[id]
- Sets status to 'dismissed' (neutral, no learning feedback)
- User not interested but doesn't want to train system"
```

---

## Phase 5: Background Integration

### Task 10: Add scan_for_tasks to processing queue

**Files:**
- Modify: `scripts/process-queue.ts`

**Step 1: Add scan_for_tasks case to queue processor**

In `scripts/process-queue.ts`, find the switch statement for operation types and add:

```typescript
case 'scan_for_tasks': {
  const { scanForTasks } = await import('./src/lib/recommendations/scanner');

  const result = await scanForTasks(
    job.user_id,
    job.entity_type,
    job.entity_id
  );

  console.log(`Scanned ${job.entity_type}:${job.entity_id} - Found ${result.recommendationCount} recommendations`);

  // TODO: Notify user if recommendations found
  // This would integrate with your notification system

  break;
}
```

**Step 2: Test queue processing**

```bash
# Queue a scan job
npx tsx -e "
import { db } from './src/lib/db/client';
await db.execute({
  sql: 'INSERT INTO processing_queue (user_id, entity_type, entity_id, operation, tier, priority) VALUES (?, ?, ?, ?, ?, ?)',
  args: ['user123', 'note', 'note123', 'scan_for_tasks', 'fast_llm', 5]
});
console.log('Job queued');
"

# Run queue processor
npm run process-queue
```

Expected: Job processes successfully, recommendations created

**Step 3: Commit**

```bash
git add scripts/process-queue.ts
git commit -m "feat: add scan_for_tasks operation to queue processor

Integrates task scanning into background processing queue
Priority 5 (medium), uses fast_llm tier"
```

---

## Phase 6: Daily Notes Auto-Scan

### Task 11: Add auto-scan trigger to daily notes

**Files:**
- Modify: `src/app/api/daily/route.ts` (or wherever daily notes are saved)
- Test: Manual testing by editing daily note

**Step 1: Add helper function for scan trigger logic**

Create `src/lib/recommendations/auto-scan.ts`:

```typescript
import { queryOne, db } from '@/lib/db/client';
import { DailyNote } from '@/lib/db/schema';
import { countWords } from './utils';
import { hashContent } from '@/lib/processing/cache';

const INACTIVITY_THRESHOLD_MINUTES = 5;
const WORD_DELTA_THRESHOLD = 50;
const SCAN_COOLDOWN_MINUTES = 10;

export interface ScanTriggerResult {
  shouldScan: boolean;
  reason?: string;
}

/**
 * Check if auto-scan should be triggered for a daily note
 */
export async function shouldTriggerAutoScan(
  dailyNoteId: string,
  userId: string,
  content: string
): Promise<ScanTriggerResult> {

  const dailyNote = await queryOne<DailyNote>(
    'SELECT * FROM daily_notes WHERE id = ?',
    [dailyNoteId]
  );

  if (!dailyNote) {
    return { shouldScan: false, reason: 'Daily note not found' };
  }

  const metadata = JSON.parse(dailyNote.metadata || '{}');
  const now = new Date();

  // Calculate inactivity
  const lastActivity = metadata.last_user_activity_at
    ? new Date(metadata.last_user_activity_at)
    : now;
  const inactiveMinutes = (now.getTime() - lastActivity.getTime()) / 1000 / 60;

  // Calculate content delta
  const currentWordCount = countWords(content);
  const lastScanWordCount = metadata.last_scan_word_count || 0;
  const wordsDelta = currentWordCount - lastScanWordCount;

  // Check last scan time
  const lastScan = metadata.last_scan_at ? new Date(metadata.last_scan_at) : null;
  const minutesSinceLastScan = lastScan
    ? (now.getTime() - lastScan.getTime()) / 1000 / 60
    : 999;

  // Check conditions
  if (inactiveMinutes < INACTIVITY_THRESHOLD_MINUTES) {
    return { shouldScan: false, reason: 'User still active' };
  }

  if (wordsDelta < WORD_DELTA_THRESHOLD) {
    return { shouldScan: false, reason: 'Not enough new content' };
  }

  if (minutesSinceLastScan < SCAN_COOLDOWN_MINUTES) {
    return { shouldScan: false, reason: 'Scan cooldown period' };
  }

  return { shouldScan: true };
}

/**
 * Update daily note metadata after scan trigger check
 */
export async function updateScanMetadata(
  dailyNoteId: string,
  content: string,
  scanTriggered: boolean
): Promise<void> {

  const dailyNote = await queryOne<DailyNote>(
    'SELECT * FROM daily_notes WHERE id = ?',
    [dailyNoteId]
  );

  if (!dailyNote) return;

  const metadata = JSON.parse(dailyNote.metadata || '{}');
  const now = new Date();

  // Always update activity timestamp
  metadata.last_user_activity_at = now.toISOString();

  if (scanTriggered) {
    // Update scan metadata
    metadata.last_scan_at = now.toISOString();
    metadata.last_scan_word_count = countWords(content);
    metadata.last_scan_content_hash = hashContent(content);
  }

  await db.execute({
    sql: 'UPDATE daily_notes SET metadata = ?, updated_at = datetime("now") WHERE id = ?',
    args: [JSON.stringify(metadata), dailyNoteId]
  });
}
```

**Step 2: Run basic test**

Create `tests/lib/recommendations/auto-scan.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldTriggerAutoScan } from '@/lib/recommendations/auto-scan';

vi.mock('@/lib/db/client');

describe('shouldTriggerAutoScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should trigger when conditions are met', async () => {
    const { queryOne } = await import('@/lib/db/client');

    const fiveMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    vi.mocked(queryOne).mockResolvedValue({
      id: 'daily1',
      metadata: JSON.stringify({
        last_user_activity_at: fiveMinutesAgo,
        last_scan_at: fifteenMinutesAgo,
        last_scan_word_count: 100
      })
    });

    const content = 'A'.repeat(300); // ~60 words
    const result = await shouldTriggerAutoScan('daily1', 'user1', content);

    expect(result.shouldScan).toBe(true);
  });

  it('should not trigger if user recently active', async () => {
    const { queryOne } = await import('@/lib/db/client');

    const nowISO = new Date().toISOString();

    vi.mocked(queryOne).mockResolvedValue({
      id: 'daily1',
      metadata: JSON.stringify({
        last_user_activity_at: nowISO,
        last_scan_word_count: 100
      })
    });

    const content = 'A'.repeat(300);
    const result = await shouldTriggerAutoScan('daily1', 'user1', content);

    expect(result.shouldScan).toBe(false);
    expect(result.reason).toContain('active');
  });
});
```

**Step 3: Run tests**

```bash
npm test tests/lib/recommendations/auto-scan.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/recommendations/auto-scan.ts tests/lib/recommendations/auto-scan.test.ts
git commit -m "feat: add auto-scan trigger logic for daily notes

- shouldTriggerAutoScan: check conditions (5min inactivity, 50 words, 10min cooldown)
- updateScanMetadata: track scan state in daily_notes.metadata
- Prevents scan spam during auto-save"
```

---

## Phase 7: UI Components (Next Steps)

**Note:** UI implementation would continue with:
- Task 12: Create RecommendationCard component
- Task 13: Add inline highlights to markdown editor
- Task 14: Create "Scan for Tasks" button in tasks page
- Task 15: Add toast notifications
- Task 16: Mobile responsive bottom sheets

These tasks would follow similar TDD patterns with React Testing Library tests.

---

## Execution Notes

**Testing Strategy:**
- Write tests first (TDD)
- Run tests to verify failure
- Implement minimal code
- Run tests to verify success
- Commit immediately

**Commit Frequency:**
- After every completed task
- Keep commits atomic and focused
- Use conventional commit format: `feat:`, `fix:`, `test:`

**Next Steps After This Plan:**
1. Execute tasks 1-11 (database, core logic, APIs, background jobs)
2. Manual testing of complete flow
3. Then move to UI implementation (tasks 12-16)
4. Integration testing
5. Polish and deploy

---

**Plan saved to:** `docs/plans/2026-01-14-task-recommendations-implementation.md`
