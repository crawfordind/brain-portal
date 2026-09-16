# Intelligent Note Organization/Cleanup - Design Document

**Date:** 2026-01-30
**Status:** Approved
**Owner:** Brain Portal Team

## Overview

Build a system to clean up disorganized notes with SAFE, UNDOABLE changes. Users click a "Cleanup" button in the note editor, receive AI-powered suggestions for improvements, review them in a modal dialog, and selectively apply approved changes. All changes are tracked in version history for complete undo capability.

## Requirements

### Core Features
1. **Cleanup Button** - Trigger analysis of current note from editor toolbar
2. **AI Analysis** - LLM analyzes note and suggests improvements:
   - Better structure/headings
   - Consolidate duplicate points
   - Extract action items to task recommendations
   - Suggest tags/categories
3. **Diff-based Suggestions** - Show changes as diffs, not full replacements
4. **User Approval** - Review and approve/reject each suggestion individually
5. **Version History** - All changes create activity_log entries for full undo
6. **No Auto-replace** - Never modify content without user confirmation

### Technical Requirements
- Chunked processing for large notes (>3000 chars)
- Synchronous analysis with loading state
- Store all versions in activity_log
- Use existing task_recommendations system
- Fast LLM tier (~$0.30/M tokens)

## Architecture

### High-Level Data Flow

1. User clicks "Cleanup" button in note editor toolbar
2. CleanupModal opens with loading state
3. Frontend calls `POST /api/notes/[id]/cleanup` with current note content
4. API creates activity_log snapshot (action: "cleanup_started")
5. CleanupService checks content length:
   - **If < 3000 characters**: Process entire note as single unit
   - **If ≥ 3000 characters**: Chunk by markdown headings, analyze each with context
6. For each chunk (or whole note): Call OpenRouter with fast_llm tier
7. LLM returns structured JSON array of suggestions
8. API aggregates suggestions (if chunked), returns to frontend
9. CleanupModal renders suggestions grouped by type in tabs
10. User reviews and approves/rejects individual suggestions
11. On "Apply Changes": Call `PATCH /api/notes/[id]/cleanup/apply` with approved suggestions
12. API applies changes, creates activity_log entry (action: "cleanup_applied")
13. Note content updated, modal closes

### Component Structure

- **CleanupButton** (`/components/notes/cleanup-button.tsx`) - Toolbar button
- **CleanupModal** (`/components/notes/cleanup-modal.tsx`) - Main dialog with tabs
- **SuggestionCard** (`/components/notes/suggestion-card.tsx`) - Individual suggestion display
- **CleanupService** (`/lib/cleanup/analyzer.ts`) - Orchestrates analysis, chunking, LLM calls
- **ChunkingService** (`/lib/cleanup/chunker.ts`) - Smart content chunking
- **ApplyService** (`/lib/cleanup/applier.ts`) - Applies approved suggestions
- **API Routes**:
  - `POST /api/notes/[id]/cleanup` - Analyze note
  - `PATCH /api/notes/[id]/cleanup/apply` - Apply suggestions
  - `GET /api/notes/[id]/cleanup/history` - Get cleanup history (optional)

## LLM Integration

### Prompt Structure

```
You are analyzing a note for cleanup opportunities. Provide structured suggestions.

Note content:
{content}

{precedingContext} // Only for chunked analysis

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

Only suggest changes that genuinely improve the note. Be conservative.
```

### Response Format

```json
[
  {
    "id": "struct-1",
    "type": "structure",
    "action": "replace",
    "target": "## Project Ideas\n- Build app\n- Learn React",
    "before": "## Project Ideas\n- Build app\n- Learn React",
    "after": "## Project Ideas\n\n### App Development\n- Build mobile app\n\n### Learning Goals\n- Learn React fundamentals",
    "reasoning": "Split vague list into categorized sections with clearer headings",
    "confidence": 0.85
  },
  {
    "id": "task-1",
    "type": "task",
    "action": "extract",
    "target": "- Call Sarah tomorrow about project",
    "content": "Call Sarah tomorrow about project",
    "reasoning": "Time-sensitive action item should be tracked as task",
    "confidence": 0.95
  },
  {
    "id": "tag-1",
    "type": "tag",
    "action": "add",
    "content": "project-planning",
    "reasoning": "Note discusses planning multiple projects",
    "confidence": 0.80
  }
]
```

### Validation & Filtering

- Minimum confidence threshold: 0.7
- Maximum suggestions per type: 10
- Deduplicate similar suggestions
- Sort by confidence within each type
- Validate JSON schema
- Filter out malformed suggestions

## Smart Chunking Implementation

### Algorithm

```typescript
function chunkNote(content: string): Chunk[] {
  // If small enough, return whole note
  if (content.length < 3000) {
    return [{
      id: 'full',
      content,
      startLine: 0,
      endLine: content.split('\n').length
    }];
  }

  // Split by markdown headings (##)
  // Each chunk includes:
  // - id: unique identifier
  // - content: section text
  // - startLine/endLine: for mapping suggestions back
  // - heading: section title
  // - precedingContext: summary of previous sections
}
```

### Context Preservation

- First chunk: No context needed
- Subsequent chunks: Include summary of previous section headings
- Helps LLM understand document structure
- Prevents duplicate suggestions across chunks
- Maps suggestions back to original line numbers

## UI Components

### CleanupModal States

**Loading State:**
```tsx
<Dialog>
  <DialogContent>
    <Loader2 className="animate-spin" />
    <p>Analyzing note for cleanup opportunities...</p>
    <p className="text-sm">This may take 10-15 seconds</p>
  </DialogContent>
</Dialog>
```

**Review State:**
```tsx
<Tabs defaultValue="structure">
  <TabsList>
    <TabsTrigger value="structure">Structure ({count})</TabsTrigger>
    <TabsTrigger value="duplicates">Duplicates ({count})</TabsTrigger>
    <TabsTrigger value="tasks">Tasks ({count})</TabsTrigger>
    <TabsTrigger value="tags">Tags ({count})</TabsTrigger>
  </TabsList>

  <TabsContent value="structure">
    {suggestions.map(s => <SuggestionCard key={s.id} {...s} />)}
  </TabsContent>
</Tabs>

<DialogFooter>
  <Button variant="outline" onClick={close}>Cancel</Button>
  <Button onClick={applySelected}>Apply {count} Changes</Button>
</DialogFooter>
```

### SuggestionCard

- Checkbox for approval (auto-checked if confidence > 0.85)
- Before/after diff view
- Reasoning explanation
- Confidence badge
- Individual approve/reject buttons

## Applying Suggestions

### Processing Order

1. Extract tasks (remove from content)
2. Replace structure/duplicates
3. Insert new content
4. Add tags

### Task Handling

- Create entries in `task_recommendations` table
- Fields:
  - `source_type: 'note'`
  - `source_id: noteId`
  - `source_text: original text`
  - `recommended_task: extracted task`
  - `reasoning: from suggestion`
  - `confidence: from suggestion`
  - `status: 'pending'`
- User sees in task recommendations UI
- Can accept/reject/dismiss each

### Tag Handling

- Add suggested tags to note via existing tag system
- Use `/api/notes/[id]` PATCH with tag IDs

### Safety

- All changes wrapped in transaction
- If any step fails, rollback to snapshot
- Activity log entry includes full audit trail

## Database Schema

### Activity Log Entries

**Before Analysis:**
```json
{
  "action": "cleanup_started",
  "entity_type": "note",
  "entity_id": "note-id",
  "changes": {
    "snapshot": {
      "title": "Original Title",
      "content": "Original content...",
      "timestamp": "2026-01-30T12:00:00Z"
    }
  }
}
```

**After Applying:**
```json
{
  "action": "cleanup_applied",
  "entity_type": "note",
  "entity_id": "note-id",
  "changes": {
    "appliedSuggestions": [...],
    "before": "old content",
    "after": "new content",
    "taskRecommendationsCreated": 3,
    "tagsAdded": ["project-planning", "ideas"]
  }
}
```

### Undo Implementation

```sql
-- Query last cleanup
SELECT * FROM activity_log
WHERE entity_id = ? AND action = 'cleanup_applied'
ORDER BY created_at DESC LIMIT 1;

-- Get previous snapshot
SELECT * FROM activity_log
WHERE entity_id = ? AND action = 'cleanup_started'
AND created_at < ?
ORDER BY created_at DESC LIMIT 1;
```

## API Routes

### POST /api/notes/[id]/cleanup

**Request:**
```json
{
  "content": "note content..."
}
```

**Response:**
```json
{
  "suggestions": [
    {
      "id": "struct-1",
      "type": "structure",
      "action": "replace",
      "target": "...",
      "before": "...",
      "after": "...",
      "reasoning": "...",
      "confidence": 0.85
    }
  ]
}
```

**Errors:**
- 401: Unauthorized
- 404: Note not found
- 408: Analysis timeout
- 429: Rate limit exceeded
- 500: Server error

### PATCH /api/notes/[id]/cleanup/apply

**Request:**
```json
{
  "suggestions": [
    {
      "id": "struct-1",
      "type": "structure",
      "action": "replace",
      "before": "...",
      "after": "..."
    }
  ]
}
```

**Response:**
```json
{
  "note": { /* updated note */ },
  "taskRecommendationsCreated": 3,
  "tagsAdded": ["tag1", "tag2"]
}
```

### GET /api/notes/[id]/cleanup/history (Optional)

**Response:**
```json
{
  "history": [
    {
      "timestamp": "2026-01-30T12:00:00Z",
      "suggestionsApplied": 5,
      "tasksCreated": 2,
      "tagsAdded": 1
    }
  ]
}
```

## Error Handling

### API Errors

- **Rate limit (429)**: "AI service rate limit reached. Please try again in a minute."
- **Timeout (408)**: "Analysis timed out. Try again or break note into smaller sections."
- **Server error (500)**: "Failed to analyze note. Please try again."

### Edge Cases

1. **Empty/short notes** (<100 chars) - "Note too short for cleanup suggestions"
2. **Well-structured notes** - LLM returns empty array, show "No improvements needed!"
3. **Concurrent edits** - Check note.updated_at before applying, warn if changed
4. **Failed LLM parsing** - Validate JSON, filter malformed suggestions
5. **Network failures** - Show retry button, preserve modal state
6. **Very large notes** (>10k chars) - Warning about analysis time

## Testing Strategy

### Unit Tests

```typescript
// Chunking
test('returns single chunk for notes < 3000 chars');
test('splits by headings for large notes');
test('preserves context between chunks');

// Applying
test('applies structure replacements correctly');
test('extracts tasks as recommendations');
test('handles missing target text gracefully');
test('creates activity_log entries');
```

### Integration Tests

```typescript
describe('POST /api/notes/[id]/cleanup', () => {
  test('analyzes note and returns suggestions');
  test('creates activity_log snapshot');
  test('handles auth errors');
});

describe('PATCH /api/notes/[id]/cleanup/apply', () => {
  test('applies approved suggestions');
  test('creates task recommendations');
  test('updates note content');
  test('can undo changes');
});
```

### E2E Tests

```typescript
test('full cleanup workflow', async () => {
  // Create messy note
  // Click cleanup button
  // Review suggestions in modal
  // Approve some, reject others
  // Apply changes
  // Verify note updated
  // Verify tasks appear in recommendations
});
```

## Cost Estimates

- **Tier**: fast_llm (~$0.30/M tokens)
- **Per analysis**: $0.001-0.005
- **Typical note** (500-2000 chars): ~$0.002
- **Large note** (5000+ chars, chunked): ~$0.004

## Future Enhancements

1. **Batch cleanup** - Analyze multiple notes at once
2. **Cleanup presets** - Save preferred suggestion types
3. **Auto-cleanup** - Opt-in automatic application of high-confidence suggestions
4. **Cleanup insights** - Track most common improvements across all notes
5. **Collaborative cleanup** - Suggest improvements based on other users' patterns
6. **Custom rules** - User-defined cleanup patterns (e.g., always extract TODO items)
7. **Diff viewer** - Enhanced side-by-side comparison
8. **Keyboard shortcuts** - Quick approve/reject navigation
9. **Undo history UI** - Browse and restore from multiple cleanup sessions

## Success Metrics

- User adoption: % of notes that use cleanup feature
- Suggestion acceptance rate: % of suggestions users approve
- Time saved: Reduction in manual editing time
- Note quality: Improvement in structure/organization scores
- Task extraction: # of tasks successfully identified and tracked
