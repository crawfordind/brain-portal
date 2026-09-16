# Note Cleanup Feature

**Status:** ✅ Complete (2026-01-30)

## Overview

The Note Cleanup feature provides AI-powered suggestions to improve note quality through intelligent analysis and automated content refinement. It helps users maintain high-quality, well-structured notes by identifying opportunities for improvement across four key dimensions.

## Core Capabilities

### 1. Analysis Types

The system analyzes notes for:

- **Structure Improvements** - Better headings, clearer organization, improved formatting
- **Duplicate Content** - Consolidate repetitive or redundant information
- **Task Extraction** - Identify and extract actionable items for task tracking
- **Tag Suggestions** - Recommend relevant tags based on content themes

### 2. Smart Chunking

For long notes (>4000 tokens), the analyzer automatically:
- Splits content into manageable chunks
- Preserves context across chunks
- Aggregates suggestions intelligently
- Deduplicates overlapping recommendations

### 3. Confidence Filtering

- Suggestions require ≥70% confidence to be presented
- Limited to top 10 suggestions per category
- Sorted by confidence score for review

## Architecture

### Components

```
src/lib/cleanup/
├── types.ts       # Shared TypeScript interfaces
├── chunker.ts     # Smart content chunking
├── analyzer.ts    # AI-powered analysis
└── applier.ts     # Suggestion application

src/app/api/notes/[id]/cleanup/
└── route.ts       # API endpoints (POST analyze, PATCH apply)

src/components/notes/
├── cleanup-modal.tsx      # Main UI component
└── suggestion-card.tsx    # Individual suggestion display
```

### API Endpoints

#### POST /api/notes/[id]/cleanup

Analyzes a note and returns suggestions.

**Response:**
```json
{
  "suggestions": [
    {
      "id": "unique-id",
      "type": "structure|duplicate|task|tag",
      "action": "replace|insert|extract|add",
      "target": "section identifier",
      "before": "original text (optional)",
      "after": "improved text (optional)",
      "content": "extracted content (optional)",
      "reasoning": "explanation",
      "confidence": 0.0-1.0
    }
  ],
  "chunked": false,
  "chunkCount": 1
}
```

**Edge Cases:**
- Returns empty suggestions for notes <100 characters
- Creates activity_log snapshot before analysis
- Handles AI service timeouts and rate limits gracefully

#### PATCH /api/notes/[id]/cleanup

Applies selected suggestions to the note.

**Request:**
```json
{
  "suggestions": [...]  // Array of approved suggestions
}
```

**Response:**
```json
{
  "note": {...},                    // Updated note
  "taskRecommendationsCreated": 2,  // Count of tasks created
  "suggestedTags": ["tag1", "tag2"] // Tags to consider
}
```

**Side Effects:**
- Updates note content
- Creates task_recommendations for extracted tasks
- Logs changes to activity_log
- Returns suggested tags (not auto-applied)

### UI Flow

1. User clicks "Cleanup Note" button in editor
2. Modal opens with "Analyzing..." state
3. API returns suggestions organized by category
4. User reviews suggestions in tabbed interface
5. User selects/deselects suggestions via checkboxes
6. User applies approved suggestions
7. Note content updates, tasks created, tags suggested

## AI Integration

### Model Configuration

- **Tier:** `fast_llm` (OpenRouter)
- **Model:** Configured via `OPENROUTER_MODEL` env var (default: `x-ai/grok-4.1-fast`)
- **Cost:** ~$0.30/M tokens
- **Cache:** 24-hour TTL in `ai_cache` table

### Prompt Strategy

The analyzer uses a conservative system prompt that:
- Emphasizes genuine improvements only
- Requires clear reasoning for each suggestion
- Enforces confidence scoring
- Prevents over-suggestion (quality over quantity)

## Data Flow

### Analysis Flow

```
Note → Chunker → AI Analyzer → Filter (≥0.7 confidence)
     → Deduplicate → Limit (10/category) → Return
```

### Application Flow

```
Suggestions → Applier → Updated Content
                      ↓
                Task Recommendations → task_recommendations table
                      ↓
                Suggested Tags → Return to user
                      ↓
                Activity Log → activity_log table
```

## Testing

### Unit Tests

- `tests/lib/cleanup/chunker.test.ts` - Chunking logic
- `tests/lib/cleanup/applier.test.ts` - Suggestion application

### Integration Tests

- `tests/app/api/notes/cleanup.test.ts` - API endpoints
  - Authentication & authorization
  - Input validation
  - Note existence checks
  - Suggestion analysis
  - Application logic
  - Task creation
  - Activity logging

### Test Coverage

Run tests:
```bash
npm test                          # All tests
npm test cleanup                  # Cleanup-specific tests
npm run test:coverage             # Coverage report
```

## Activity Logging

All cleanup operations are logged for audit trails:

### cleanup_started
```json
{
  "snapshot": {
    "title": "...",
    "content": "...",
    "timestamp": "2026-01-30T..."
  }
}
```

### cleanup_applied
```json
{
  "appliedSuggestions": [...],
  "before": "...",
  "after": "...",
  "taskRecommendationsCreated": 2,
  "tagsAdded": ["tag1", "tag2"]
}
```

## User Experience

### Success States

- "No improvements needed!" - Note is already optimal
- "X suggestions found" - Actionable recommendations available
- "Cleanup applied successfully" - Changes saved

### Error States

- "Note too short for cleanup" - <100 characters
- "AI service rate limit reached" - 429 error, retry guidance
- "Analysis timed out" - 408 error, chunking suggestion
- "Failed to analyze" - Generic 500 fallback

### Loading States

- "Analyzing note..." - Initial analysis
- "Applying suggestions..." - Saving changes

## Best Practices

### For Users

1. **Review before applying** - Suggestions are recommendations, not requirements
2. **Start with structure** - Apply structural improvements first
3. **Extract tasks liberally** - Better in task system than buried in notes
4. **Consider suggested tags** - Tags improve discoverability

### For Developers

1. **Always test with long notes** - Verify chunking works correctly
2. **Monitor AI costs** - Cleanup uses fast_llm tier, check usage
3. **Preserve activity logs** - Critical for debugging and audit
4. **Handle AI errors gracefully** - Network issues, timeouts, rate limits

## Performance Considerations

### Cost Analysis

- Short note (<2000 tokens): ~$0.0006 per analysis
- Long note (>8000 tokens, 3 chunks): ~$0.0024 per analysis
- Cached results: $0 (24-hour cache)

### Response Times

- Analysis: 2-5 seconds (uncached)
- Application: <500ms (database only)
- Chunked analysis: +2-3s per additional chunk

### Rate Limits

The system handles OpenRouter rate limits:
- Returns 429 with retry guidance
- Preserves partial progress in activity_log
- No automatic retries (user-initiated)

## Future Enhancements

Potential improvements for future iterations:

1. **Batch Processing** - Analyze multiple notes in one request
2. **Custom Rules** - User-defined cleanup preferences
3. **Auto-apply** - Automatically apply high-confidence suggestions
4. **Diff View** - Side-by-side before/after preview
5. **Undo Stack** - Revert applied cleanups
6. **Learning** - Adapt suggestions based on user acceptance patterns

## Troubleshooting

### "No suggestions found"

- Note may already be well-structured
- Content too generic for meaningful suggestions
- Try adding more detail to prompt richer analysis

### "Analysis timed out"

- Note likely very long (>10,000 tokens)
- Break into smaller notes or sections
- Check AI service status

### "Task recommendations not created"

- Verify task_recommendations table exists (migration 007)
- Check application logs for insert errors
- Ensure task suggestions were in applied batch

## References

- Implementation Plan: `docs/plans/2026-01-30-intelligent-note-cleanup.md`
- Type Definitions: `src/lib/cleanup/types.ts`
- API Routes: `src/app/api/notes/[id]/cleanup/route.ts`
- UI Components: `src/components/notes/cleanup-modal.tsx`
