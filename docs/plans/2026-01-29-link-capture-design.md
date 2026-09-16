# Link/URL Capture Feature - Design Document

**Date:** 2026-01-29
**Status:** Approved
**Feature:** URL/link capture with metadata fetching, content scraping, and vector embedding integration

## Overview

Add ability to save URLs as captures with automatic metadata fetching (title, description, favicon) and optional full-page content scraping. Link captures will be included in vector embeddings for semantic search and will integrate seamlessly with the existing capture system.

## User Goals

- **Primary:** Quickly save URLs with automatic metadata extraction
- **Secondary:** Optionally scrape full page content for deeper context
- **Tertiary:** Search and find link captures using semantic search
- **Integration:** Link captured URLs to notes and tasks

## Critical Constraints

1. **No database deletions** - Only add columns, never delete existing data
2. **Use OpenRouter** - All AI operations must use existing OpenRouter client
3. **Work with existing system** - Integrate with current capture workflow and tiered AI processing
4. **Include in embeddings** - Scraped content must be vectorized for semantic search

## Design Decisions

### 1. Architecture & Data Model

**Database Schema Changes:**

Add 'link' to existing capture_type enum (no deletions):
```sql
-- Migration: Add 'link' to capture_type enum
-- Current: 'thought', 'idea', 'followup', 'task', 'quote', 'reference'
-- New: 'thought', 'idea', 'followup', 'task', 'quote', 'reference', 'link'
```

**LinkMetadata Interface:**
```typescript
interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  scrapedContent?: string;  // Full page content (Readability output)
  scrapedAt?: string;       // ISO timestamp
  statusCode?: number;      // HTTP response code
  error?: string;           // If fetch/scrape failed
}
```

**Storage Pattern:**
- Capture.content: User-provided title/notes + auto-fetched title as fallback
- Capture.metadata: JSON-serialized LinkMetadata
- Capture.capture_type: 'link'

**Type Safety:**
```typescript
// Extend existing Capture type
export interface LinkCapture extends Capture {
  capture_type: 'link';
  metadata: LinkMetadata;
}

// Type guard
export function isLinkCapture(capture: Capture): capture is LinkCapture {
  return capture.capture_type === 'link' && !!capture.metadata?.url;
}
```

### 2. Metadata Fetching & Scraping Services

**Two-Tier Approach:**

**Tier 1: Fast Metadata (Always)**
- Fetch HTML `<head>` only (up to 50KB)
- Parse Open Graph tags, Twitter Cards, standard meta tags
- Extract favicon (multiple fallback strategies)
- Cost: Free (no AI)
- Speed: < 2 seconds

**Tier 2: Full Scraping (Optional)**
- Fetch complete HTML
- Use Mozilla Readability algorithm
- Extract main content (article text, clean HTML)
- Generate vector embeddings via OpenRouter
- Cost: $0.02/M tokens (embedding tier)
- Speed: 5-10 seconds

**Service Architecture:**
```typescript
// src/lib/services/link-scraper.ts

interface MetadataResult {
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  statusCode: number;
  error?: string;
}

interface ScrapeResult extends MetadataResult {
  content: string;      // Cleaned article text
  wordCount: number;
  scrapedAt: string;
}

async function fetchMetadata(url: string): Promise<MetadataResult>
async function scrapeFullContent(url: string): Promise<ScrapeResult>
```

**Open Graph Parsing Strategy:**
```typescript
// Priority order for each field:
// 1. og:title / og:description / og:image
// 2. twitter:title / twitter:description / twitter:image
// 3. Standard <title> / <meta name="description">
// 4. Fallback: "Untitled" / domain name
```

**Favicon Strategy:**
```typescript
// Check in order:
// 1. <link rel="icon">
// 2. <link rel="shortcut icon">
// 3. /favicon.ico
// 4. Google Favicon Service: https://www.google.com/s2/favicons?domain={domain}
```

**Error Handling:**
- Timeout after 10 seconds
- Store error message in metadata.error
- Allow user to retry failed scrapes
- Handle CORS issues (use server-side fetch)

### 3. UI Components & Auto-Detection

**Enhanced CaptureCreateDialog:**

**URL Auto-Detection:**
```typescript
// Detect URLs in content field as user types
const urlRegex = /https?:\/\/[^\s]+/gi;

function detectUrl(content: string): string | null {
  const match = content.match(urlRegex);
  return match ? match[0] : null;
}

// When URL detected:
// 1. Show "Link detected" badge
// 2. Offer "Fetch metadata" button
// 3. Auto-switch capture_type to 'link'
```

**UI Flow:**

**State 1: URL Detected**
```
┌────────────────────────────────────┐
│ [i] Link detected                  │
│ [Fetch metadata] button            │
└────────────────────────────────────┘
```

**State 2: Fetching Metadata**
```
┌────────────────────────────────────┐
│ [spinner] Fetching link details... │
└────────────────────────────────────┘
```

**State 3: Metadata Loaded**
```
┌────────────────────────────────────┐
│ ┌──────────────────────────────┐   │
│ │ [favicon] Title              │   │
│ │ Description text...          │   │
│ │ example.com                  │   │
│ └──────────────────────────────┘   │
│                                    │
│ ☐ Scrape full page content        │
│ [Save] [Cancel]                   │
└────────────────────────────────────┘
```

**Component Structure:**
```typescript
// Modify existing src/components/captures/capture-create-dialog.tsx

const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
const [linkMetadata, setLinkMetadata] = useState<LinkMetadata | null>(null);
const [isScrapingEnabled, setIsScrapingEnabled] = useState(false);
const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

// Watch content field
useEffect(() => {
  const url = detectUrl(content);
  if (url && url !== detectedUrl) {
    setDetectedUrl(url);
    setType('link'); // Auto-switch type
  }
}, [content]);

// Fetch metadata handler
async function handleFetchMetadata() {
  setIsFetchingMetadata(true);
  const metadata = await fetch('/api/captures/link/metadata', {
    method: 'POST',
    body: JSON.stringify({ url: detectedUrl })
  }).then(r => r.json());
  setLinkMetadata(metadata);
  setIsFetchingMetadata(false);
}
```

**Manual URL Entry:**
- User can also manually select 'link' type
- Show URL input field when type='link'
- Same metadata fetch flow

### 4. Link Capture Display & Preview Cards

**Captures List Enhancement:**

**Link Capture Card (Distinct from Other Captures):**
```typescript
// src/components/captures/link-capture-card.tsx

<article className="group rounded-lg border bg-card hover:shadow-md transition-all">
  {/* Visual indicator: colored left border */}
  <div className="border-l-4 border-blue-500 pl-4 pr-4 py-4">

    {/* Header: favicon + title */}
    <div className="flex items-start gap-3">
      {metadata.favicon && (
        <img
          src={metadata.favicon}
          alt=""
          className="w-5 h-5 mt-0.5 shrink-0"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold truncate">
          {metadata.title || 'Untitled Link'}
        </h3>
        <p className="text-sm text-muted-foreground truncate">
          {new URL(metadata.url).hostname}
        </p>
      </div>
      <ExternalLink className="w-4 h-4 text-muted-foreground" />
    </div>

    {/* Description (if available) */}
    {metadata.description && (
      <p className="text-sm text-muted-foreground line-clamp-2 mt-2">
        {metadata.description}
      </p>
    )}

    {/* OG Image preview (if available) */}
    {metadata.ogImage && (
      <img
        src={metadata.ogImage}
        alt=""
        className="w-full h-32 object-cover rounded mt-3"
        loading="lazy"
      />
    )}

    {/* Metadata footer */}
    <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
      <span>Saved {formatDistanceToNow(new Date(capture.created_at), { addSuffix: true })}</span>
      {metadata.scrapedContent && (
        <span className="flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {metadata.wordCount} words scraped
        </span>
      )}
    </div>

    {/* Actions */}
    <div className="flex gap-2 mt-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => window.open(metadata.url, '_blank')}
      >
        Visit Link
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleConvertToNote}
      >
        Convert to Note
      </Button>
    </div>
  </div>
</article>
```

**Conditional Rendering in Captures List:**
```typescript
// src/components/captures/captures-list.tsx

{captures.map(capture => (
  isLinkCapture(capture) ? (
    <LinkCaptureCard key={capture.id} capture={capture} />
  ) : (
    <CaptureCard key={capture.id} capture={capture} />
  )
))}
```

**Empty State Enhancement:**
```typescript
// When no link captures exist yet, show example in empty state:
"Try saving links from articles, tweets, GitHub repos, or any web content you want to remember."
```

### 5. Vector Embeddings & AI Processing

**Integration with Tiered AI System:**

**Processing Pipeline (Smart):**
```typescript
// When link capture is created:

if (isScrapingEnabled) {
  // 1. Fetch metadata (fast, free)
  const metadata = await fetchMetadata(url);

  // 2. Save capture immediately with metadata
  await createCapture({
    content: metadata.title || url,
    type: 'link',
    metadata
  });

  // 3. Queue full scraping + embedding in background
  await enqueueJob({
    type: 'link-scrape-and-embed',
    captureId: capture.id,
    url
  });
} else {
  // Just save with metadata (no scraping)
  const metadata = await fetchMetadata(url);
  await createCapture({
    content: metadata.title || url,
    type: 'link',
    metadata
  });
}
```

**Background Job Processing:**
```typescript
// scripts/process-queue.ts enhancement

case 'link-scrape-and-embed':
  // 1. Scrape full content
  const scraped = await scrapeFullContent(job.url);

  // 2. Update capture metadata
  await updateCapture(job.captureId, {
    metadata: { ...existingMetadata, ...scraped }
  });

  // 3. Generate embedding (via existing pipeline)
  const embeddingText = [
    scraped.title,
    scraped.description,
    scraped.content  // Main article content
  ].filter(Boolean).join('\n\n');

  await generateEmbedding({
    resourceType: 'capture',
    resourceId: job.captureId,
    content: embeddingText,
    tier: 'embedding'  // $0.02/M tokens
  });
```

**Embedding Content Strategy:**
```typescript
// For link captures, embedding includes:
// 1. Title (metadata.title)
// 2. Description (metadata.description)
// 3. Scraped content (metadata.scrapedContent) - if available
// 4. User notes (capture.content) - if different from title

// This allows semantic search like:
// "articles about Next.js performance" → finds relevant link captures
```

**Cache Strategy:**
```typescript
// Reuse existing ai_cache table:
// - Embeddings: 7-day cache (matches current pattern)
// - Scraping results: No cache (one-time operation)
// - Metadata: No cache (one-time operation)
```

### 6. OpenRouter Integration & API Implementation

**Use Existing OpenRouter Client:**
```typescript
// src/lib/ai/openrouter.ts (existing)
import { generateEmbedding } from '@/lib/ai/embeddings';

// Already handles:
// - API key management
// - Error handling
// - Rate limiting
// - Response parsing
```

**API Endpoints:**

**1. POST /api/captures/link/metadata**
```typescript
// Fast metadata fetch (no AI, no auth required for public URLs)

export async function POST(request: Request) {
  const { url } = await request.json();

  // Validate URL
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  // Fetch metadata (server-side, no CORS issues)
  const metadata = await fetchMetadata(url);

  return NextResponse.json(metadata);
}
```

**2. POST /api/captures/link/scrape**
```typescript
// Full content scraping (requires auth, queues embedding job)

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { url, captureId } = await request.json();

  // Scrape full content
  const scraped = await scrapeFullContent(url);

  // Queue embedding generation
  await enqueueJob({
    type: 'link-scrape-and-embed',
    captureId,
    url,
    userId: session.userId
  });

  return NextResponse.json(scraped);
}
```

**3. Enhanced POST /api/captures**
```typescript
// Modified to handle link captures

export async function POST(request: Request) {
  const session = await getSession(request);
  const { content, type, metadata, projectId, taskId } = await request.json();

  // For link captures, validate metadata
  if (type === 'link' && metadata?.url) {
    // Ensure URL is valid
    if (!isValidUrl(metadata.url)) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }
  }

  // Create capture
  const capture = await createCapture({
    user_id: session.userId,
    content,
    capture_type: type,
    metadata: metadata ? JSON.stringify(metadata) : null,
    project_id: projectId || null,
    task_id: taskId || null
  });

  // If link with scraping enabled, queue job
  if (type === 'link' && metadata?.scrapeEnabled) {
    await enqueueJob({
      type: 'link-scrape-and-embed',
      captureId: capture.id,
      url: metadata.url,
      userId: session.userId
    });
  }

  return NextResponse.json(capture);
}
```

**OpenRouter Embedding Configuration:**
```typescript
// Use existing embedding model from environment
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Cost: $0.02 per 1M tokens
// Speed: ~1-2 seconds per request
// Cache: 7 days (matches existing pattern)
```

**Error Handling:**
```typescript
// All API endpoints follow existing error patterns:
// - 400: Bad request (invalid URL, missing params)
// - 401: Unauthorized (no session)
// - 429: Rate limit exceeded (OpenRouter)
// - 500: Server error (scraping failed, embedding failed)
// - 503: Service unavailable (OpenRouter down)

// Store errors in capture.metadata.error for user visibility
```

## Implementation Checklist

### Phase 1: Data Layer
- [ ] Create migration: Add 'link' to capture_type enum
- [ ] Add LinkMetadata TypeScript interface
- [ ] Add isLinkCapture type guard
- [ ] Test migration on local database

### Phase 2: Services
- [ ] Create `src/lib/services/link-scraper.ts`
- [ ] Implement fetchMetadata function (Open Graph + favicon)
- [ ] Implement scrapeFullContent function (Readability)
- [ ] Add URL validation utility
- [ ] Add error handling and timeouts
- [ ] Unit tests for metadata parsing

### Phase 3: API Endpoints
- [ ] Create `POST /api/captures/link/metadata`
- [ ] Create `POST /api/captures/link/scrape`
- [ ] Modify `POST /api/captures` for link type
- [ ] Test all endpoints with Postman/curl

### Phase 4: Background Processing
- [ ] Add 'link-scrape-and-embed' job type to queue processor
- [ ] Implement job handler in `scripts/process-queue.ts`
- [ ] Test embedding generation for scraped content
- [ ] Verify 7-day cache is used

### Phase 5: UI Components
- [ ] Enhance CaptureCreateDialog with URL detection
- [ ] Add metadata preview in dialog
- [ ] Add "Scrape full content" checkbox
- [ ] Create LinkCaptureCard component
- [ ] Update CapturesList to use conditional rendering
- [ ] Add loading states and error messages

### Phase 6: Integration
- [ ] Test full flow: detect URL → fetch metadata → save → scrape → embed
- [ ] Test without scraping (metadata only)
- [ ] Test error cases (invalid URL, timeout, scrape failure)
- [ ] Test semantic search with link captures
- [ ] Verify embeddings are generated correctly

### Phase 7: Polish
- [ ] Add loading skeletons for metadata fetch
- [ ] Add toast notifications for scraping progress
- [ ] Add retry button for failed scrapes
- [ ] Optimize OG image loading (lazy load)
- [ ] Add keyboard shortcuts (Cmd+V to paste URL)

### Phase 8: Testing
- [ ] Test with various URL types (articles, GitHub, Twitter, YouTube)
- [ ] Test with URLs that fail to scrape
- [ ] Test with URLs without Open Graph tags
- [ ] Test on mobile (touch interactions)
- [ ] Verify accessibility (screen reader, keyboard nav)
- [ ] Performance test: 100 link captures with embeddings

## Files Modified/Created

```
src/lib/services/link-scraper.ts                    (New)
src/components/captures/link-capture-card.tsx       (New)
src/app/api/captures/link/metadata/route.ts         (New)
src/app/api/captures/link/scrape/route.ts           (New)
src/app/api/captures/route.ts                       (Modified)
src/components/captures/capture-create-dialog.tsx   (Modified)
src/components/captures/captures-list.tsx           (Modified)
scripts/process-queue.ts                             (Modified)
src/lib/db/schema.ts                                (Modified - add type)
scripts/migrate.ts                                  (New migration)
```

## Success Metrics

- URLs are auto-detected in capture dialog
- Metadata fetches in < 2 seconds
- Full scraping completes in < 10 seconds
- Link captures display with rich preview cards
- Scraped content is searchable via semantic search
- Embeddings are cached for 7 days
- No database deletions or data loss
- All AI operations use OpenRouter
- Works seamlessly with existing capture workflow
- Fully accessible (keyboard + screen reader)
- No hydration warnings or console errors

## Future Enhancements (Out of Scope)

- Browser extension for one-click capture
- Automatic periodic re-scraping to detect dead links
- Archive.org integration for permanent backups
- PDF/video content extraction
- Social media preview cards (Twitter, YouTube embeds)
- Link collections (group related links)
- Automatic tagging based on scraped content

---

## Design Approved: 2026-01-29

All 6 design sections validated with user:
1. ✅ Architecture & Data Model
2. ✅ Metadata Fetching & Scraping Services
3. ✅ UI Components & Auto-Detection
4. ✅ Link Capture Display & Preview Cards
5. ✅ Vector Embeddings & AI Processing
6. ✅ OpenRouter Integration & API Implementation

**Ready for implementation.**
