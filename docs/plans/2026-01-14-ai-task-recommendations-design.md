# AI-Powered Task Recommendation System

**Date:** 2026-01-14
**Status:** Design Complete, Ready for Implementation
**Author:** Claude (with user collaboration)

## Overview

An intelligent task recommendation system that learns to identify actionable tasks from notes, daily notes, and captures using LLM analysis, vector embeddings, and user feedback. The system learns from thumbs-up/down feedback to recognize task-like patterns in writing, improving recommendations over time.

## Goals

1. **Automatic Task Discovery**: Scan notes to identify potential tasks automatically
2. **Pattern Learning**: Learn from user feedback to recognize what content should become tasks
3. **No Duplicates**: Never recommend tasks that already exist or were recently completed
4. **Non-Intrusive**: Work seamlessly with auto-save and user writing flow
5. **Mobile-First**: Responsive UI optimized for both desktop and mobile

## Architecture

### Database Schema

#### New Table: `task_recommendations`

```sql
CREATE TABLE IF NOT EXISTS task_recommendations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source information
  source_type TEXT NOT NULL CHECK (source_type IN ('note', 'daily_note', 'capture')),
  source_id TEXT NOT NULL,
  source_text TEXT NOT NULL, -- The text that triggered this recommendation

  -- Recommendation details
  recommended_task TEXT NOT NULL,
  confidence REAL DEFAULT 0.7,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  reasoning TEXT, -- Why the AI thought this was a task

  -- User feedback
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dismissed', 'expired')),
  user_feedback TEXT, -- 'accepted', 'rejected', null for pending/dismissed
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

#### Daily Notes Metadata Extension

Add to `daily_notes.metadata` JSON field:
```json
{
  "last_scan_at": "2026-01-14T10:30:00Z",
  "last_scan_content_hash": "abc123...",
  "last_scan_word_count": 450,
  "last_user_activity_at": "2026-01-14T10:35:00Z"
}
```

#### Processing Queue Extension

Add new operation type to `processing_queue`:
```sql
-- Update check constraint
ALTER TABLE processing_queue DROP CONSTRAINT IF EXISTS processing_queue_operation_check;
ALTER TABLE processing_queue ADD CONSTRAINT processing_queue_operation_check
  CHECK (operation IN (
    'generate_embedding', 'generate_summary', 'generate_tags',
    'find_connections', 'analyze_capture', 'recompute_all',
    'scan_for_tasks'  -- NEW
  ));
```

### Core Components

#### 1. Deduplication Engine

**Three-level duplicate detection:**

```typescript
async function isDuplicate(
  userId: string,
  taskText: string,
  embedding: number[]
): Promise<{ isDuplicate: boolean; reason?: string }> {

  const SIMILARITY_THRESHOLD = 0.85;
  const COMPLETED_TASK_WINDOW_DAYS = 30;
  const RECENT_RECOMMENDATION_WINDOW_DAYS = 7;

  // Level 1: Check existing tasks (pending, in_progress, recently completed)
  const existingTasks = await queryAll<Task & { embedding: string }>(
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
      const taskEmbedding = JSON.parse(task.embedding);
      const similarity = cosineSimilarity(embedding, taskEmbedding);

      if (similarity > SIMILARITY_THRESHOLD) {
        if (task.status === 'completed') {
          return { isDuplicate: true, reason: 'completed_recently' };
        } else {
          return { isDuplicate: true, reason: 'already_exists' };
        }
      }
    }
  }

  // Level 2: Check recent recommendations (pending/rejected)
  const recentRecs = await queryAll<TaskRecommendation & { embedding: string }>(
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
    }
  }

  // Level 3: Exact text match (fallback if embeddings fail)
  const normalizedText = taskText.toLowerCase().trim();
  const exactMatch = await queryOne(
    `SELECT id FROM tasks WHERE user_id = ? AND LOWER(TRIM(content)) = ? AND status != 'cancelled'`,
    [userId, normalizedText]
  );

  if (exactMatch) {
    return { isDuplicate: true, reason: 'exact_match' };
  }

  return { isDuplicate: false };
}
```

**Key Rules:**
- Similarity threshold: **0.85** (high confidence semantic match)
- Completed tasks: Block if within **30 days** (allows recurring tasks)
- Rejected recommendations: Block for **7 days** (user can change mind later)
- Pending recommendations: Block (don't re-suggest)

#### 2. Learning System (Few-Shot Prompting)

**Dynamic prompt construction with similar examples:**

```typescript
async function buildTaskRecommendationPrompt(
  candidateText: string,
  candidateEmbedding: number[],
  userId: string
): Promise<string> {

  // Fetch 5 most similar accepted recommendations
  const acceptedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'accepted',
    5
  );

  // Fetch 5 most similar rejected recommendations
  const rejectedExamples = await findSimilarRecommendations(
    userId,
    candidateEmbedding,
    'rejected',
    5
  );

  const prompt = `You are a task detection assistant that learns from user feedback. Analyze text to identify actionable tasks.

POSITIVE EXAMPLES (user accepted these as tasks):
${acceptedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Task: "${ex.recommended_task}"
   Why: ${ex.reasoning}
`).join('\n')}

NEGATIVE EXAMPLES (user rejected these - NOT tasks):
${rejectedExamples.map((ex, i) => `
${i + 1}. Text: "${ex.source_text}"
   Why: ${ex.reasoning || 'User determined this was not actionable'}
`).join('\n')}

Now analyze this text and determine if it contains an actionable task:

Text: "${candidateText}"

Return JSON with:
{
  "isTask": boolean,
  "taskText": string | null,  // Concise task description if isTask=true
  "reasoning": string,        // Why you think this is/isn't a task
  "confidence": number,       // 0.0 to 1.0
  "priority": "low" | "medium" | "high" | "urgent"
}

Rules:
- Tasks have clear action verbs (review, contact, fix, create, send, etc.)
- Tasks should be specific and actionable, not vague contemplation
- Time-based language (today, tomorrow, this week) suggests tasks
- Past tense usually means not a task (already done)
- Questions are usually not tasks unless they imply follow-up action`;

  return prompt;
}

async function findSimilarRecommendations(
  userId: string,
  embedding: number[],
  status: 'accepted' | 'rejected',
  limit: number
): Promise<TaskRecommendation[]> {

  // Get all recommendations of this status with embeddings
  const recommendations = await queryAll<TaskRecommendation & { embedding: string }>(
    `SELECT tr.*, e.embedding
     FROM task_recommendations tr
     JOIN embeddings e ON tr.source_embedding_id = e.id
     WHERE tr.user_id = ? AND tr.user_feedback = ?
     ORDER BY tr.feedback_at DESC
     LIMIT 100`,
    [userId, status]
  );

  // Calculate similarity scores
  const withScores = recommendations.map(rec => ({
    ...rec,
    similarity: cosineSimilarity(embedding, JSON.parse(rec.embedding))
  }));

  // Sort by similarity and take top N
  return withScores
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
```

**Confidence Boosting:**

```typescript
function calculateFinalConfidence(
  llmConfidence: number,
  acceptedSimilarityMax: number,  // Highest similarity to accepted examples
  rejectedSimilarityMax: number,  // Highest similarity to rejected examples
  hasActionVerbs: boolean,
  hasTimeLanguage: boolean
): number {

  let confidence = llmConfidence;

  // Similar to accepted examples
  if (acceptedSimilarityMax > 0.8) confidence += 0.2;
  else if (acceptedSimilarityMax > 0.6) confidence += 0.1;

  // Similar to rejected examples (penalize)
  if (rejectedSimilarityMax > 0.8) confidence -= 0.3;
  else if (rejectedSimilarityMax > 0.6) confidence -= 0.15;

  // Action verbs detected
  if (hasActionVerbs) confidence += 0.1;

  // Time language detected
  if (hasTimeLanguage) confidence += 0.1;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, confidence));
}
```

#### 3. Smart Auto-Scan Triggers

**Debounced + Delta Detection:**

```typescript
async function onDailyNoteAutoSave(dailyNoteId: string, userId: string, content: string) {
  const dailyNote = await queryOne<DailyNote>(
    'SELECT * FROM daily_notes WHERE id = ?',
    [dailyNoteId]
  );

  if (!dailyNote) return;

  const metadata = JSON.parse(dailyNote.metadata || '{}');
  const now = new Date();

  // Update last activity timestamp
  metadata.last_user_activity_at = now.toISOString();

  // Calculate inactivity duration
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

  // Trigger conditions
  const INACTIVITY_THRESHOLD_MINUTES = 5;
  const WORD_DELTA_THRESHOLD = 50;
  const SCAN_COOLDOWN_MINUTES = 10;

  const shouldScan =
    inactiveMinutes >= INACTIVITY_THRESHOLD_MINUTES &&
    wordsDelta >= WORD_DELTA_THRESHOLD &&
    minutesSinceLastScan >= SCAN_COOLDOWN_MINUTES;

  if (shouldScan) {
    // Check for existing pending scan job
    const existingJob = await queryOne(
      `SELECT id FROM processing_queue
       WHERE user_id = ? AND entity_type = 'daily_note' AND entity_id = ?
       AND operation = 'scan_for_tasks' AND status = 'pending'`,
      [userId, dailyNoteId]
    );

    if (!existingJob) {
      // Queue scan job
      await db.execute({
        sql: `INSERT INTO processing_queue
              (user_id, entity_type, entity_id, operation, tier, priority)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [userId, 'daily_note', dailyNoteId, 'scan_for_tasks', 'fast_llm', 5]
      });
    }

    // Update metadata
    metadata.last_scan_at = now.toISOString();
    metadata.last_scan_word_count = currentWordCount;
    metadata.last_scan_content_hash = hashContent(content);
  }

  // Always update metadata (at least activity timestamp)
  await db.execute({
    sql: 'UPDATE daily_notes SET metadata = ?, updated_at = datetime("now") WHERE id = ?',
    args: [JSON.stringify(metadata), dailyNoteId]
  });
}
```

**Trigger Rules:**
- **5 minutes** of inactivity (user stopped typing)
- **50+ words** added since last scan
- **10 minutes** cooldown between scans
- Manual "Scan for Tasks" button bypasses all rules

#### 4. Scan Processing

**Candidate Extraction:**

```typescript
async function scanForTasks(userId: string, sourceType: string, sourceId: string) {
  // 1. Load content
  const content = await loadSourceContent(sourceType, sourceId);

  // 2. Extract candidate sentences
  const candidates = extractCandidates(content);

  // 3. Filter using local processing (action verbs, etc.)
  const filtered = candidates.filter(c => hasActionIndicators(c));

  // 4. Process each candidate
  const recommendations: TaskRecommendation[] = [];

  for (const candidate of filtered.slice(0, 20)) { // Max 20 candidates
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

    // Call LLM (with caching)
    const cacheKey = generateCacheKey('task_recommendation', {
      text: candidate.text,
      userId: userId
    });

    let result = await getCached<TaskRecommendationResult>(userId, cacheKey);

    if (!result) {
      const response = await complete(prompt, {
        model: DEFAULT_MODEL,
        temperature: 0.3,
        maxTokens: 300
      });

      result = JSON.parse(response);

      await setCache(userId, cacheKey, result, {
        operation: 'task_recommendation',
        tier: 'fast_llm',
        ttlHours: 24
      });
    }

    // Only keep if LLM says it's a task
    if (result.isTask && result.confidence > 0.5) {
      recommendations.push({
        user_id: userId,
        source_type: sourceType,
        source_id: sourceId,
        source_text: candidate.text,
        recommended_task: result.taskText,
        confidence: result.confidence,
        priority: result.priority,
        reasoning: result.reasoning,
        source_embedding_id: embeddingId,
        status: 'pending'
      });
    }
  }

  // 5. Sort by confidence, keep top 10
  recommendations.sort((a, b) => b.confidence - a.confidence);
  const topRecommendations = recommendations.slice(0, 10);

  // 6. Store recommendations
  for (const rec of topRecommendations) {
    await storeRecommendation(rec);
  }

  return {
    scannedCount: filtered.length,
    recommendationCount: topRecommendations.length,
    recommendations: topRecommendations
  };
}

function extractCandidates(content: string): { text: string; context: string }[] {
  // Split by sentences
  const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);

  // Group into sliding windows (3 sentences for context)
  const candidates: { text: string; context: string }[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const context = sentences.slice(Math.max(0, i - 1), Math.min(sentences.length, i + 2)).join('. ');
    candidates.push({
      text: sentences[i],
      context: context
    });
  }

  return candidates;
}

function hasActionIndicators(text: string): boolean {
  const actionVerbs = [
    'need to', 'should', 'must', 'have to', 'going to',
    'review', 'check', 'contact', 'reach out', 'send', 'email',
    'create', 'build', 'fix', 'update', 'finish', 'complete',
    'schedule', 'plan', 'prepare', 'research', 'investigate'
  ];

  const lowerText = text.toLowerCase();
  return actionVerbs.some(verb => lowerText.includes(verb));
}
```

### API Endpoints

#### POST /api/tasks/recommendations/scan

Scan notes for task recommendations.

**Request:**
```json
{
  "sourceType": "note" | "daily_note" | "recent",
  "sourceId": "string (optional, required if sourceType != 'recent')",
  "daysBack": 7  // For 'recent' sourceType
}
```

**Response:**
```json
{
  "scannedCount": 45,
  "recommendationCount": 7,
  "recommendations": [
    {
      "id": "rec123",
      "sourceType": "daily_note",
      "sourceId": "daily456",
      "sourceText": "need to review the Q1 budget before Friday",
      "recommendedTask": "Review Q1 budget",
      "confidence": 0.89,
      "priority": "high",
      "reasoning": "Clear action verb with deadline",
      "status": "pending",
      "createdAt": "2026-01-14T10:30:00Z"
    }
  ]
}
```

#### GET /api/tasks/recommendations

List recommendations for current user.

**Query Parameters:**
- `status`: pending | accepted | rejected | dismissed (default: pending)
- `sourceType`: note | daily_note | capture (optional)
- `limit`: number (default: 20)

**Response:**
```json
{
  "recommendations": [
    {
      "id": "rec123",
      "recommendedTask": "Review Q1 budget",
      "confidence": 0.89,
      "sourceType": "daily_note",
      "sourceId": "daily456",
      "status": "pending",
      "createdAt": "2026-01-14T10:30:00Z"
    }
  ],
  "count": 3,
  "hasMore": false
}
```

#### POST /api/tasks/recommendations/[id]/feedback

Accept or reject a recommendation.

**Request:**
```json
{
  "feedback": "accepted" | "rejected",
  "editedTask": "Modified task text (optional, for accepted only)"
}
```

**Response (accepted):**
```json
{
  "recommendation": { /* updated recommendation */ },
  "task": {
    "id": "task789",
    "content": "Review Q1 budget",
    "status": "pending",
    "priority": "high"
  }
}
```

**Response (rejected):**
```json
{
  "recommendation": { /* updated recommendation with status='rejected' */ }
}
```

#### DELETE /api/tasks/recommendations/[id]

Dismiss a recommendation without feedback (neutral - doesn't train system).

**Response:**
```json
{
  "success": true,
  "recommendation": { /* updated recommendation with status='dismissed' */ }
}
```

### UI Components

#### 1. Inline Badges (Daily Notes Editor)

**Desktop Experience:**
- Subtle highlight on text that triggered recommendation (yellow tint, 10% opacity, 2px left border)
- Small badge icon (📋) appears in left margin on hover
- Click badge to show floating card positioned to the right
- Card has drop shadow, rounded corners, max-width 320px
- Non-intrusive: doesn't break typing flow

**Mobile Experience:**
- Highlighted text with badge icon (📋) in margin
- Tap to open bottom sheet (slides up from bottom)
- Bottom sheet: backdrop blur, drag handle, swipe-to-dismiss
- Actions: Full-width buttons (min 48px height)

**Recommendation Card Component:**

```tsx
<RecommendationCard>
  <Header>
    <Icon>📋</Icon>
    <Badge confidence={0.89}>High Confidence</Badge>
  </Header>

  <TaskInput
    defaultValue="Review Q1 budget"
    editable={true}
    placeholder="Edit task..."
  />

  <Metadata>
    <SourceLabel>From: Daily Note - Jan 14</SourceLabel>
    <ConfidenceBar value={0.89} />
  </Metadata>

  <Reasoning>
    "Clear action verb with deadline"
  </Reasoning>

  <Actions>
    <Button variant="primary" icon="👍">Accept</Button>
    <Button variant="secondary" icon="👎">Reject</Button>
    <Button variant="ghost">Dismiss</Button>
  </Actions>
</RecommendationCard>
```

**CSS Classes:**
```css
.task-recommendation-highlight {
  background: rgba(250, 204, 21, 0.1); /* Yellow tint */
  border-left: 2px solid rgb(250, 204, 21);
  padding-left: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.task-recommendation-highlight:hover {
  background: rgba(250, 204, 21, 0.2);
}

.recommendation-badge {
  position: absolute;
  left: -24px;
  opacity: 0;
  transition: opacity 0.2s;
}

.task-recommendation-highlight:hover .recommendation-badge {
  opacity: 1;
}

/* Mobile bottom sheet */
@media (max-width: 768px) {
  .recommendation-card {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 80vh;
    border-radius: 16px 16px 0 0;
    backdrop-filter: blur(10px);
  }
}
```

#### 2. Tasks Section Integration

**"Scan for Tasks" Button:**
- Located in tasks page header
- Shows badge if pending recommendations exist: "3 pending"
- Click opens side panel (desktop) or modal (mobile)
- Loading state while scanning
- Toast notification on completion

**Recommendations Panel:**
- List view of all pending recommendations
- Sort by confidence (high to low)
- Filter by source type
- Same card design as inline badges
- Bulk actions: "Accept All" / "Dismiss All"

#### 3. Notification System

**Scan Complete Notification:**
- Desktop: Toast in bottom-right: "Found 3 potential tasks in today's note"
- Mobile: Same toast, tappable to open recommendations
- Auto-dismiss after 5 seconds, or tap to open
- Badge appears on "Tasks" nav item

**Feedback Confirmation:**
- Accepted: Green toast "Task added to your list"
- Rejected: Subtle gray toast "Thanks for the feedback"
- Dismissed: No toast (silent)

### Integration with Existing Systems

#### Tiered AI Processing

**Task recommendations use `fast_llm` tier:**
- Model: `x-ai/grok-4.1-fast` (or configured model)
- Cost: ~$0.30/M tokens
- Cache TTL: 24 hours
- Max tokens: 300
- Temperature: 0.3 (deterministic)

**Why fast_llm?**
- More complex than tagging (needs reasoning)
- Simpler than full insights (focused task)
- Fast response needed for good UX
- Reasonable cost with caching

#### Background Processing Queue

**New operation: `scan_for_tasks`**
- Priority: 5 (medium)
- Max attempts: 3
- Timeout: 60 seconds
- Processed by: `scripts/process-queue.ts`

**Queue Integration:**
```typescript
// In scripts/process-queue.ts
case 'scan_for_tasks': {
  const result = await scanForTasks(
    job.user_id,
    job.entity_type,
    job.entity_id
  );

  // Notify user if recommendations found
  if (result.recommendationCount > 0) {
    await notifyUser(job.user_id, {
      type: 'task_recommendations',
      count: result.recommendationCount,
      sourceType: job.entity_type,
      sourceId: job.entity_id
    });
  }

  break;
}
```

#### Embeddings System

**Reuse existing embedding infrastructure:**
- Same `generateEmbedding()` function
- Store in `embeddings` table with `entity_type='task_candidate'`
- 1536-dim vectors (OpenAI text-embedding-3-small)
- 7-day cache (same as notes)
- Use `cosineSimilarity()` for duplicate detection and example matching

#### Caching Strategy

**Cache key structure:**
```typescript
const cacheKey = generateCacheKey('task_recommendation', {
  text: hashContent(candidateText),
  acceptedExamplesHash: hashExampleIds(acceptedExampleIds),
  rejectedExamplesHash: hashExampleIds(rejectedExampleIds)
});
```

**Cache invalidation:**
- TTL: 24 hours
- Invalidates automatically when user's feedback patterns change (different examples)
- Manual clear: Not needed (self-expiring)

### Error Handling

#### 1. Embedding Generation Failure

```typescript
try {
  embedding = await generateEmbedding(text);
} catch (error) {
  console.warn('Embedding generation failed, using text fallback:', error);
  // Fallback to text-based deduplication only
  const dupCheck = await isTextDuplicate(userId, text);
  if (dupCheck.isDuplicate) continue;

  // Continue without embedding (lower confidence)
  embedding = null;
  confidence *= 0.8; // Reduce confidence
}
```

#### 2. LLM API Failure

```typescript
let attempts = 0;
const MAX_ATTEMPTS = 3;

while (attempts < MAX_ATTEMPTS) {
  try {
    result = await complete(prompt, options);
    break;
  } catch (error) {
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      // Mark job as failed
      await markJobFailed(jobId, error.message);
      throw error;
    }
    // Exponential backoff
    await sleep(Math.pow(2, attempts) * 1000);
  }
}
```

#### 3. Too Many Recommendations

```typescript
// Keep only top 10 by confidence
if (recommendations.length > 10) {
  recommendations.sort((a, b) => b.confidence - a.confidence);
  const kept = recommendations.slice(0, 10);
  const dropped = recommendations.length - 10;

  console.log(`Keeping top 10 of ${recommendations.length} recommendations`);

  // Store metadata about dropped recommendations
  metadata.droppedCount = dropped;
  metadata.lowestKeptConfidence = kept[9].confidence;
}
```

#### 4. Concurrent Scan Requests

```typescript
// Check for existing pending scan job
const existingJob = await queryOne(
  `SELECT id, status FROM processing_queue
   WHERE user_id = ? AND entity_type = ? AND entity_id = ?
   AND operation = 'scan_for_tasks' AND status IN ('pending', 'processing')`,
  [userId, entityType, entityId]
);

if (existingJob) {
  return {
    status: 'already_scanning',
    jobId: existingJob.id,
    message: 'Scan already in progress'
  };
}
```

#### 5. Deleted Source Content

```typescript
// In daily cleanup job
await db.execute({
  sql: `UPDATE task_recommendations
        SET status = 'expired'
        WHERE source_type = 'note'
        AND source_id NOT IN (SELECT id FROM notes)
        AND status = 'pending'
        AND created_at < datetime('now', '-24 hours')`
});
```

### Data Retention & Cleanup

**Daily Cleanup Job (`scripts/cleanup-recommendations.ts`):**

```typescript
async function cleanupRecommendations() {
  // Expire old pending recommendations (30 days)
  await db.execute({
    sql: `UPDATE task_recommendations
          SET status = 'expired'
          WHERE status = 'pending'
          AND created_at < datetime('now', '-30 days')`
  });

  // Delete old dismissed recommendations (90 days)
  await db.execute({
    sql: `DELETE FROM task_recommendations
          WHERE status = 'dismissed'
          AND created_at < datetime('now', '-90 days')`
  });

  // Delete expired recommendations (180 days)
  await db.execute({
    sql: `DELETE FROM task_recommendations
          WHERE status = 'expired'
          AND created_at < datetime('now', '-180 days')`
  });

  // Keep accepted/rejected forever (learning data)
  console.log('Recommendation cleanup complete');
}
```

**Retention Policy:**
- **Accepted**: Keep forever (valuable learning data)
- **Rejected**: Keep forever (valuable learning data)
- **Pending**: Expire after 30 days → Delete after 180 days
- **Dismissed**: Delete after 90 days (user not interested, no learning value)

### Performance Considerations

#### Rate Limiting

```typescript
// In API route
const rateLimits = {
  manual_scan: { requests: 3, window: 60 }, // 3 per minute
  feedback: { requests: 20, window: 60 }    // 20 per minute
};

await checkRateLimit(userId, 'manual_scan', rateLimits.manual_scan);
```

#### Optimization Strategies

1. **Batch Embedding Generation**: Generate embeddings for all candidates in parallel
2. **Similarity Search Indexing**: Use approximate nearest neighbor for large feedback datasets (future)
3. **Limit Candidate Extraction**: Max 20 candidates per scan
4. **Limit Inline Badges**: Max 5 visible per note (link to "View All")
5. **Lazy Load Recommendations**: Don't load recommendation cards until user hovers/clicks

#### Monitoring Metrics

Track these metrics for system health:

```typescript
interface RecommendationMetrics {
  scansPerDay: number;
  recommendationsGenerated: number;
  acceptanceRate: number;      // accepted / (accepted + rejected)
  averageConfidence: number;
  duplicatesBlocked: number;
  avgResponseTime: number;      // LLM call latency
  cacheHitRate: number;
}
```

## Implementation Plan

### Phase 1: Database & Core Logic (Week 1)

1. Create `task_recommendations` table migration
2. Update `processing_queue` operation constraint
3. Implement `isDuplicate()` deduplication logic
4. Implement `buildTaskRecommendationPrompt()` learning system
5. Write tests for deduplication and prompt building

### Phase 2: Scan Engine (Week 1-2)

1. Implement `scanForTasks()` main function
2. Implement `extractCandidates()` and `hasActionIndicators()`
3. Add `scan_for_tasks` operation to processing queue handler
4. Implement smart auto-scan triggers for daily notes
5. Write tests for scan logic

### Phase 3: API Endpoints (Week 2)

1. POST `/api/tasks/recommendations/scan`
2. GET `/api/tasks/recommendations`
3. POST `/api/tasks/recommendations/[id]/feedback`
4. DELETE `/api/tasks/recommendations/[id]`
5. Write API integration tests

### Phase 4: UI Components (Week 2-3)

1. Inline badge highlights in editor
2. Floating/bottom-sheet recommendation cards
3. Tasks section "Scan for Tasks" button
4. Recommendations panel/modal
5. Toast notifications
6. Mobile responsive testing

### Phase 5: Background Jobs & Polish (Week 3)

1. Daily cleanup job
2. Rate limiting implementation
3. Error handling improvements
4. Performance optimization
5. Monitoring/logging setup

### Phase 6: Testing & Iteration (Week 4)

1. End-to-end testing
2. User feedback collection
3. Confidence scoring tuning
4. UI/UX refinements
5. Documentation updates

## Success Metrics

### Product Metrics

- **Adoption Rate**: % of users who try "Scan for Tasks" feature
- **Engagement**: Average scans per active user per week
- **Acceptance Rate**: % of recommendations accepted (target: >30%)
- **Time Saved**: Estimated tasks discovered vs manually created
- **Learning Curve**: Acceptance rate improvement over first 30 days

### Technical Metrics

- **Scan Performance**: Average scan time <5 seconds
- **Duplicate Prevention**: % of blocked duplicates (should be >90%)
- **Cache Hit Rate**: % of cached LLM calls (target: >50%)
- **API Response Time**: p95 <2 seconds
- **Error Rate**: <1% of scans fail

### Learning System Metrics

- **Feedback Volume**: Total accepted + rejected recommendations
- **Confidence Calibration**: Accepted rate at confidence >0.8 should be >80%
- **Pattern Recognition**: Acceptance rate should improve with more feedback

## Future Enhancements

### Short-term (3-6 months)

1. **Project Context**: Consider project goals when recommending tasks
2. **Due Date Suggestions**: Infer due dates from time language ("by Friday")
3. **Task Relationships**: Link related tasks ("blocking", "follows")
4. **Batch Actions**: "Accept all high-confidence" button

### Long-term (6-12 months)

1. **Personalized Models**: Fine-tune small models per user (expensive but powerful)
2. **Cross-Note Connections**: Recommend tasks based on patterns across multiple notes
3. **Proactive Suggestions**: "You haven't reviewed X in 2 weeks, add a task?"
4. **Voice Input**: "Add task: review budget" while taking notes
5. **Integration with Calendar**: Sync tasks with time blocks

## Open Questions

1. Should we support bulk import of recommendations to existing task management systems?
2. How do we handle recommendations for shared/collaborative notes (future feature)?
3. Should confidence threshold for display be user-configurable?
4. Do we need a "training mode" where users explicitly mark text as task/not-task?

## Conclusion

This design provides a complete, production-ready AI task recommendation system that:
- ✅ Learns from user feedback through few-shot prompting
- ✅ Never duplicates existing or recently completed tasks
- ✅ Works seamlessly with auto-save and user workflow
- ✅ Provides intuitive, mobile-optimized UI
- ✅ Integrates cleanly with existing infrastructure
- ✅ Scales efficiently with caching and background processing

The system starts working immediately and gets smarter over time as users provide feedback, creating a personalized task detection engine that understands each user's unique patterns and preferences.
