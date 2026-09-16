# Smart Project Suggestions

**Date:** 2026-01-30
**Status:** Design Complete

## Overview

Automatically suggest which project a note belongs to based on content analysis. Uses cost-effective keyword matching with embeddings fallback for ambiguous cases.

## User Experience

### Trigger
- Activates after user writes ~100 words
- Debounces 3 seconds after typing stops
- Only triggers once per note editing session
- Skipped if note already has project assigned

### UI
Toast notification (using existing Sonner):
```
💡 Looks like 'Work' project
85% match based on content
[Accept] [Dismiss]
```

- **Accept**: Assigns project, auto-saves
- **Dismiss**: Closes, won't suggest again
- **Ignore**: Auto-dismisses after 8 seconds
- **Manual selection**: If user picks project manually, cancels pending suggestion

## Architecture

### Components

**1. `useProjectSuggestion` Hook**
- Location: `src/hooks/use-project-suggestion.ts`
- Manages suggestion lifecycle
- Tracks word count, debouncing, shown state
- Returns: `{ suggestion, confidence, loading }`

**2. API Endpoint**
- Route: `POST /api/projects/suggest`
- Input: `{ title: string, content: string }` (first 500 chars)
- Output: `{ projectId, projectName, confidence, method }`
- Method: "keyword" | "embedding" | null

**3. Toast Integration**
- Hooks into existing Sonner toast system
- Custom action buttons
- 8 second auto-dismiss

## Matching Algorithm

### Phase 1: Keyword Matching (Fast & Free)

**Extract Keywords:**
- Tokenize title + first 500 chars of content
- Remove stop words (the, and, or, is, at, etc.)
- Extract both single words and 2-3 word phrases
- Weight title keywords 2x higher than body

**Score Each Project:**
Total score out of 100 points:
- **Project name match** (40 pts): Direct or partial keyword match
- **Project description match** (20 pts): Keywords in project description
- **Existing notes match** (40 pts): Average match against note titles in project

**Confidence Calculation:**
```
confidence = (topScore / 100) × 100
```

**Thresholds:**
- ≥70%: Show suggestion (keyword method)
- 50-69%: Fall back to embeddings
- <50%: No suggestion

### Phase 2: Embeddings Fallback (For Ambiguous Cases)

**When:** Keyword confidence is 50-69%

**Process:**
1. Generate embedding for new note (title + 500 chars)
2. For each project with ≥3 notes:
   - Fetch existing note embeddings from database
   - Calculate cosine similarity
   - Average top 3 most similar notes
3. Project with highest average wins
4. Boost confidence +10% if matches keyword suggestion

**Cost:** ~$0.02 per embedding (only 1 generated, reuses existing)

## Implementation Details

### Keyword Scoring Example

```typescript
interface ScoringResult {
  projectId: string;
  projectName: string;
  nameScore: number;      // 0-40
  descScore: number;      // 0-20
  notesScore: number;     // 0-40
  totalScore: number;     // 0-100
  confidence: number;     // percentage
}
```

### Stop Words List
```
the, and, or, is, are, was, were, be, been, being,
have, has, had, do, does, did, will, would, should,
could, may, might, must, can, a, an, at, in, on, for,
to, of, with, by, from, about, as, into, through
```

### Database Queries

**Fetch Projects for User:**
```sql
SELECT id, name, description
FROM projects
WHERE user_id = ? AND status = 'active'
ORDER BY updated_at DESC
LIMIT 20
```

**Fetch Project Notes (for keyword matching):**
```sql
SELECT title
FROM notes
WHERE project_id = ? AND user_id = ?
ORDER BY updated_at DESC
LIMIT 10
```

**Fetch Embeddings (for fallback):**
```sql
SELECT embedding, entity_id
FROM embeddings
WHERE user_id = ?
  AND entity_type = 'note'
  AND entity_id IN (
    SELECT id FROM notes WHERE project_id = ?
  )
```

## Edge Cases

| Case | Handling |
|------|----------|
| User has no projects | Skip suggestion entirely |
| All projects empty (no notes) | Keyword matching only |
| Note already has project | Skip suggestion |
| User changes project manually | Cancel pending suggestions |
| API timeout (>5s) | Fail silently, log error |
| Embeddings API failure | Show keyword result if >50% |
| Content deleted below 100 words | Reset state, can trigger again |

## Performance Optimizations

- Debounce API calls (3 seconds)
- One suggestion per editing session
- Reuse React Query project cache
- Reuse existing embeddings from DB
- Limit to 20 most recent projects
- Skip projects with <3 notes for embeddings

## Privacy & Security

- Only suggests user's own projects
- API requires authentication
- No external service calls (except embeddings API on fallback)
- No data logging or tracking

## Testing Strategy

**Unit Tests:**
- Keyword scoring algorithm
- Stop word filtering
- Confidence calculation

**Integration Tests:**
- API endpoint with mock data
- Hook debouncing behavior
- Toast trigger conditions

**Manual Testing:**
- Various note types (technical, personal, meeting notes)
- Edge cases (no projects, empty projects)
- Performance with many projects

## Success Metrics

- **Accuracy:** >80% of accepted suggestions are correct
- **Performance:** <500ms for keyword matching, <2s for embeddings
- **Cost:** <$0.05 per day for average user (most use keyword only)
- **Adoption:** >50% of users accept at least one suggestion per week
