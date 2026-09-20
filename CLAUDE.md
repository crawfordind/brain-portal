# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev          # Start development server on port 3000
npm run build        # Production build
npm run lint         # Run ESLint
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run db:migrate   # Run database migrations (tsx scripts/migrate.ts)
npm run user:create  # Create an account (signups are closed by default)
npm run migrate:chat-item-context  # Allow 'item' as a chat context type
npm run migrate:provenance         # Record who wrote each row, and which run

# MCP Server
npm run mcp:start    # Start MCP server (requires env vars)
npm run mcp:migrate  # Create mcp_api_keys table
npm run mcp:keygen   # Generate API key: npx tsx scripts/generate-mcp-key.ts <email>

# Testing
npm test             # Run tests once
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
```

## Key Features

### Command-First Interface
- **UnifiedSearch** (Cmd+K): Primary interaction point for all actions
  - Search notes, tasks, projects, captures
  - Run commands (create, navigate, actions)
  - Keyboard shortcuts: Cmd+Shift+C (Quick Capture), Cmd+Shift+D (Daily Note)
  - Quick Actions: Shown by default when search is empty for discoverability
  - Mobile-optimized: 56px touch targets, full-screen overlay

### Dashboard (`/` → `StreamPage`)

Five bands, ordered so the page answers *"anything for me?"* before *"what have
I got?"*, and **three of them render nothing when they have nothing to say**:

| Band | Component | Renders when |
|------|-----------|--------------|
| Greeting | `stream-page.tsx` | always (one line: greeting, date, "N done") |
| Brain Bar | `brain-bar.tsx` | always — the universal input |
| **Needs you** | `needs-you.tsx` | any of overdue / to review / contacts to sort / follow-ups due / due today / unread notifications is non-zero |
| **People** | `crm-pulse-card.tsx` | the user has contacts; a card when something is pending, one quiet line when not |
| Stream | `stream-feed.tsx` | always |

- **One place announces that something is waiting.** `NeedsYou` is it. The feed
  used to carry its own "N awaiting review" banner counted from the 30 items it
  happened to have loaded, so it disagreed with the sidebar's server-side count.
- **Server-sourced counts.** `getStreamStats` (`src/lib/stream/stats.ts`) and
  `getCrmPulse` (`src/lib/crm/pulse.ts`) run in parallel in the page's server
  component. Stats returns only counters that represent *pending work*; it used
  to return seven, of which the page rendered one. The bell's unread count is
  the sole client fetch, because it changes while the page is open.
- **Filter chips are earned.** A chip renders only for a type the user actually
  has items of, four show at a time, the rest fold behind "+N", and an active
  filter always stays visible. Nine always-on chips was a scrolling wall above
  the content.
- **The legacy dashboard is gone.** `src/components/dashboard/` (hero section,
  conditional sections, insight feeds, widgets — 17 components) was replaced by
  the Stream and had no importer left in the app.

#### Reading the stream: density and time buckets

The feed is a list of short rows at a density the viewer chooses, grouped by
when things happened. One flat chronological list of identical 88px cards showed
about seven items on a 1080p screen and four on a phone.

- **Density** (`src/lib/stream/density.ts`, `useStreamDensity`): `compact`
  (one line) / `cozy` (plus a preview line) / `comfortable` (the original card).
  Rows get shorter by *removing* elements — never by type below 12px or a touch
  target below 44px. At compact the 44px action buttons overflow the 40px row
  through negative margin, so the target is full size while the row stays short.
  Actions are always visible; they used to be `md:group-hover:opacity-100`,
  which made every capability a hover-only secret on the one device that hovers.
- **Buckets** (`src/lib/stream/grouping.ts`, pure and unit-tested): Now (<1h) /
  Earlier today / Yesterday / This week / Earlier, with sticky headings.
  Calendar days, not rolling 24-hour windows — except that recency wins, so
  something written at 23:50 and read at 00:10 is "Now", not "Yesterday".
- **`parseDbTimestamp` is how stream timestamps must be read.** SQLite's
  `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` with no zone marker and is UTC
  by definition; `new Date()` reads that shape as *local*, skewing every
  timestamp by the viewer's offset. Use this, not the `Date` constructor.
- **"Since you were last here"** is a divider drawn at the one point where new
  meets old, and only when both exist. `users` has no `last_seen_at`, so the
  anchor is `localStorage`, read once per page load and immediately overwritten
  — re-reading it while the page is open would make the boundary creep upward
  under the reader.
- **Density and last-visit are `localStorage`, deliberately.** Density is a
  property of the screen, not the account; syncing it would make a phone and a
  desktop fight. Both read through `useSyncExternalStore`, so neither needs a
  `setState` in an effect.
- **`contentWidthClass`** (`src/lib/navigation.ts`) gives the dashboard route
  `max-w-6xl` while prose keeps the `max-w-4xl` reading measure. The global cap
  was discarding ~41% of a 1920px display on the one page that is a list, not
  prose.

#### Acting on a stream row

The feed's row actions are optimistic React Query mutations that roll back and
toast on failure, then invalidate `["stream"]` on settle — the filter chips read
a server-computed `counts` that an optimistic patch cannot keep honest. Paging
is `useInfiniteQuery`; the hand-rolled version closed over its own `offset`, so
two quick "Load more" clicks could append the same page twice.

- **Archive routes through `PATCH /api/stream/[id]`**, not through the source
  table's own endpoint. A stream id is only unique *within* its table and the
  feed does not know which table a row came from, so the route attempts all five
  candidates (`captures`, `tasks`, `notes`, `reminders`, `insights`) in one
  `db.batch` and decides on summed `rowsAffected`. It previously judged success
  from `mutate()` — which returns `rows[0] ?? null`, and an `UPDATE` without
  `RETURNING` has no rows — so it answered `{success:true}` to every id,
  including ids that did not exist.
- **`agent_tasks` is deliberately not archivable.** Archiving agent output would
  mean rejecting it, which is a review decision with its own endpoint and side
  effects; the Archive item is hidden on `agent_output` rows and the route 404s
  rather than pretending.
- **Reminders dismiss via `PATCH /api/reminders/[id]`** (`status: "dismissed"`,
  which also stamps `dismissed_at`). Archive reaches the same state.

Design and the rest of the roadmap: `docs/plans/2026-09-14-stream-dashboard-v2-design.md`.

### Navigation

Both surfaces name the same destinations the same way, and both badge the same
two queues (`useReviewCount`, `useCrmAttentionCount` — shared hooks, so the
counts can never disagree).

- **Desktop** (`agentic-sidebar.tsx`), two groups: *Today* — Stream, Tasks,
  Review, Contacts (the ones that carry badges); *Library* — Notes, Journal,
  Projects. Then Settings and pinned notes.
- **Mobile** (`agentic-bottom-nav.tsx`): Tasks | Stream | Notes | More. The
  "More" sheet holds Review, **Contacts**, Journal, Projects, Settings, Sign
  Out, and the More button carries a dot when either queue is non-empty. The
  CRM previously had no mobile entry point at all. "Notifications" was dropped
  from the sheet: it pointed at `/settings#notifications`, one row below
  Settings, while the real bell is in the header on mobile too.
- `GET /api/crm/pulse` exists so those client badges can read the same summary
  the dashboard renders server-side.

### Editor
- **Centered Cursor**: Keeps cursor visible while typing (like VS Code)
- **Markdown Support**: TipTap editor with markdown shortcuts
- **Sticky Toolbar**: Always accessible on mobile
- **Sketch & Handwriting**: PenTool toolbar button opens a OneNote-style drawing pad

### Hand Drawing & Handwriting Recognition
A canvas-based sketch pad with OneNote-style tools plus AI handwriting transcription ("ink to text").

- **Tools** (`src/components/sketch/sketch-pad.tsx`): pen (pressure-sensitive via PointerEvents),
  highlighter, stroke-eraser, line/rectangle/ellipse shapes, color palette + custom color,
  stroke-size slider, undo/redo, clear, and blank/grid/ruled backgrounds. High-DPI aware.
- **Dialog** (`src/components/sketch/sketch-dialog.tsx`): wraps the pad, calls recognition,
  and on save uploads the sketch + inserts it into the note (optionally with the transcription).
- **Recognition** (`src/lib/ai/handwriting.ts`): `recognizeHandwriting()` sends the rasterized
  PNG to an OpenRouter vision model (`OPENROUTER_VISION_MODEL`, defaults to `OPENROUTER_MODEL`)
  and returns `{ hasText, text, markdown, description, confidence }`.
- **API** (`POST /api/ink/recognize`): body `{ image: dataURL, recognize?, persist?, strokes?, noteId?, projectId? }`.
  Recognizes synchronously; when `persist` is true, stores the sketch as an **image attachment**
  with `extracted_text` = transcription and `metadata.ink` = vector strokes (re-editable), then
  enqueues an embedding so sketches are semantically searchable. No new DB table — reuses `attachments`.
- **Editor integration**: the PenTool button inserts a `<figure>` (image) plus, optionally, the
  transcription as editable markdown below it.

## Architecture Overview

This is a Next.js 16 (App Router) personal knowledge management system with AI features, using Turso (SQLite edge database) and OpenRouter for LLM/embeddings.

### Core Directory Structure

- `src/app/` - Next.js App Router pages and API routes
  - `src/app/(dashboard)/` - Protected dashboard routes (grouped layout)
  - `src/app/api/` - API endpoints for notes, captures, projects, tasks, AI operations
  - `src/app/auth/` - Public authentication pages (magic link flow)
- `src/components/` - React components
  - `src/components/ui/` - shadcn/ui primitives (Radix-based)
  - `src/components/editor/` - TipTap markdown editor
- `src/lib/` - Business logic organized by domain
  - `src/lib/db/` - Turso client (lazy-loaded) and schema
  - `src/lib/ai/` - OpenRouter client, embeddings, tiered processing
  - `src/lib/auth/` - Magic link authentication and sessions
  - `src/lib/processing/` - Background job queue, caching, local parsing
- `scripts/` - CLI utilities (migrations, imports, queue processing)
- `tests/` - Vitest test files

### Key Architectural Patterns

**Tiered AI Processing** (`src/lib/ai/tiers.ts`): Routes AI operations by cost:
- `local`: Free - link extraction, word count, structure analysis
- `embedding`: $0.02/M tokens - vector embeddings with 7-day cache
- `fast_llm`: $0.30/M tokens - summaries, tags, capture classification with 24h cache
- `full_llm`: $1.50/M tokens - insights, weekly reviews with 48h cache

**Database** (`src/lib/db/schema.ts`): 13 core tables + FTS5 search:
- Auth: `users`, `sessions`, `magic_links`
- Content: `notes`, `daily_notes`, `weekly_reviews`, `captures`, `tasks`, `projects`, `tags`
- AI: `embeddings` (1536-dim vectors), `insights`, `note_connections`, `ai_cache`, `processing_queue`

**Authentication**: Magic link flow via SMTP. Sessions stored in HTTP-only cookies.

**Background Processing**: Jobs enqueued to `processing_queue`, drained in production by
`/api/cron/process-queue`; `scripts/process-queue.ts` is the manual/CLI equivalent and the
only thing that runs attachment media jobs. See *Content Processing Queue*.

### API Route Patterns

API routes follow RESTful conventions:
- `GET/POST /api/[resource]` - List/create
- `GET/PATCH/DELETE /api/[resource]/[id]` - CRUD operations
- AI operations: `/api/embeddings`, `/api/insights/generate`, `/api/weekly/generate`, `/api/search`

## Environment Variables

Required for development (see `.env.example`):
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` - Database
- `OPENROUTER_API_KEY` - AI provider key
- `OPENROUTER_MODEL`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_EMBEDDING_MODEL` -
  optional per-slot overrides. A choice saved in Settings outranks these, and
  any id the live catalog no longer lists is skipped. See *Model Selection*.
- `SMTP_*` - Email for magic links
- `NEXT_PUBLIC_APP_URL`, `SESSION_SECRET` - App config
- `CRON_SECRET` - **Required in production.** Guards every `/api/cron/*` route.
  Unset, `verifyCronSecret` 401s every scheduled request, so the agent queue is
  never drained and delegated work sits in `queued` with no error to show for
  it. See *Background Failure Visibility* below.
- `SIGNUP_MODE` / `ALLOWED_EMAILS` - who may have an account created. Defaults
  to `closed`. See *Who Can Sign Up*.
- `ADMIN_EMAILS` - comma-separated. Fails closed: unset means nobody is admin.
- `TRUST_PROXY_HEADERS` - set `false` when Node is directly internet-facing.
- `BRAIN_SERVICE_TOKEN` / `BRAIN_SERVICE_EMAIL` - both required to enable
  `/api/brain`, which is otherwise 503. There is **no default account**.

## Who Can Sign Up

`verifyMagicLink` creates a user for any address that verifies, so an instance
with SMTP configured and no policy is an open signup: anyone who can receive
email gets a workspace and a share of the operator's OpenRouter budget.

`src/lib/auth/signup-policy.ts` gates account *creation* only — an existing
user can always sign in, whatever the mode.

- `closed` (**default**) — only known addresses. Bootstrap with
  `npm run user:create you@example.com`.
- `allowlist` — `ALLOWED_EMAILS` entries, either a full address or `@domain`.
- `open` — anyone.

`POST /api/auth/login` checks the policy *before* sending mail, so the route
cannot be used as a relay to arbitrary addresses, and returns the identical
"check your email" response either way so it cannot enumerate accounts.

## Fetching User-Supplied URLs

**Never call `fetch` on a URL that came from a user.** Use `safeFetch`
(`src/lib/utils/safe-fetch.ts`).

`isPublicUrl` is necessary but not sufficient, and both of its gaps were live:

1. It reads the hostname as a *string*, so a name with an A record pointing at
   `169.254.169.254` sailed through. `safeFetch` resolves the name itself (via
   `src/lib/utils/dns.ts`, kept separate so tests can choose the answer) and
   rejects if **any** returned address is private — not just the first, or the
   attacker retries until a split-horizon record lands.
2. `fetch` follows redirects and validates nothing en route, so a public URL
   that 302s to the metadata service walked straight in. `safeFetch` uses
   `redirect: 'manual'` and re-validates each hop.

It also caps the body, because the callers write the result into a row the user
reads back. `scrapeFullContent` previously fetched the page and then called
`fetchMetadata(url)`, which fetched *the same page again*; it now extracts
metadata from the HTML it already holds.

The residual DNS-rebinding window is documented in that file rather than papered
over.

## Uploads

`validateFile` checks the declared MIME type against the allowlist **and** the
file's magic bytes (`file-type`), because the declared type is a client claim,
not a fact — and it is what gets written to R2 as the object's Content-Type.
`image/svg+xml` is deliberately not accepted: an SVG is a script-bearing
document, and served from the attachment host it executes in that origin.

## Testing

Tests use Vitest with path alias `@/` → `./src/`. Coverage excludes `db/client.ts` and `auth/`.

`tests/setup.ts` installs placeholder env vars so modules that read config at
import time do not throw. It deliberately does **not** set
`NEXT_PUBLIC_APP_URL`: several routes fall back to the request origin when it is
absent, and that fallback is behaviour worth testing.

Two helpers exist to stop whole classes of brittle failure:

- **`tests/helpers/db-mock.ts`** — `createDbClientMock()` returns the *complete*
  `@/lib/db/client` surface. Hand-rolled partial mocks meant adding a `queryOne`
  to a route broke unrelated suites with "No 'queryOne' export is defined".
- **`tests/helpers/render.tsx`** — `renderWithProviders()` wraps a component in
  a real `QueryClientProvider`. Tests used to `vi.mock` react-query to dodge
  "No QueryClient set", which then broke whenever the component used a second
  hook from that module.

Run a single test file:
```bash
npx vitest run tests/lib/ai/embeddings.test.ts
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, test and build on every PR,
plus a `--audit-level=high` dependency audit. It needs **no secrets**:
`scripts/migrate.ts` skips itself when `CI=true` or `SKIP_MIGRATIONS=true`
rather than failing the `prebuild` for want of a database.

Lint policy (`eslint.config.mjs`): errors mean something is broken and gate the
build; `no-unused-vars`, `no-explicit-any` and the
`react-hooks/set-state-in-effect` backlog are warnings, so a first contribution
is not an unrelated type sweep.

## Asking About an Item (the chat)

Getting AI help on one thing — a note, a captured thought, a task, a reminder,
an insight — is a conversation, not a work order.

**"Ask about this"** (`useAskAbout`, `src/hooks/use-ask-about.ts`) pins the chat
to the item and opens it. The answer streams back immediately, the follow-up is
the next message, and the one action worth a button is keeping the answer.

### What this replaced

Before, the same intent went through *delegation*: a dialog offering a roster of
17 named personas plus an auto-router readout, an instructions textarea
prefilled with a four-point boilerplate prompt glued to the item's own text,
priority and output-format selects, and a linked-notes multi-select. Submitting
enqueued an `agent_task`, returned nothing, and waited for a cron worker; the
output appeared minutes later in a review screen the user had to go find and
then approve, revise (up to 5) or reject.

Two of those three review verbs already had conversational equivalents —
revising is the next message, rejecting is closing the sheet — and the app
already had a **streaming, context-aware chat** doing the same job better. So
the interactive path folded into it.

### How it works

- **`item` chat context.** `chat_conversations.context_type` gained `'item'`,
  with `context_id` holding a composite `"<type>:<id>"`. The vocabulary and its
  parser live in `src/lib/chat/item-types.ts`, which imports **nothing** — kept
  apart from `item-context.ts` for the same reason `system-health/types.ts` is
  kept apart from its index, since the loader reaches for the DB client and for
  `embeddings`, which constructs an OpenAI client at import time.
- **Resolution** (`src/lib/chat/item-context.ts`): loads the item, its project,
  its **annotations** and its semantically related notes into the system prompt.
  Several types are genuinely ambiguous — the stream labels a capture whose
  `capture_type` is `task`/`followup` as a `task` item, and a `reminder` may be
  a `reminders` row or a dated task — so each type carries a **list** of
  candidate tables tried in order. The old delegation endpoint assumed one table
  per type and simply failed to find those items.
- **Annotations survive.** They are read from the raw body, never
  `content_plain`, which has already stripped the highlight markup. See
  *Semantic Highlights*.
- **Suggestions** (`src/lib/chat/item-suggestions.ts`): pure, per-type opening
  chips ("Give me feedback", "How do I start?", "Push back"). One tap replaces
  editing a prefilled blob.
- **Keeping an answer** (`POST /api/chat/save`): `{ content, as: "note" | "task" }`
  plus the pinned item, which supplies the title and a provenance footer built
  server-side. Saved notes are enqueued for embedding so the answer is findable
  later, not just readable now.
- **Route context is remembered** (`chat-store`): pinning to an item overrides
  the route's own context, and "new chat" falls back to the route rather than
  leaving a stale item pinned.
- **Migration**: `npm run migrate:chat-item-context` widens the `context_type`
  CHECK. SQLite cannot alter a CHECK in place, so the table is rebuilt. It is
  the *new* table that gets renamed onto the real name, never the old one onto
  a temp name — that would rewrite `chat_messages`' FK, and the pragma that
  suppresses it (`legacy_alter_table`) is **rejected by Turso**
  (`SQL_PARSE_ERROR: SQL not allowed statement`), which is what made an earlier
  version of this migration abort halfway and leave the CHECK un-widened. The
  swap runs under `foreign_keys=OFF` so dropping the old table does not
  cascade-delete every message, but that is session state on a pooled HTTP
  connection, so `chat_messages` is also copied to a backup table and any
  cascaded rows are restored and count-checked before the backup is dropped.
  Idempotent.

### Entry points

Stream card (quick action + menu), stream detail panel, note page menu, task
list row, task detail, kanban and calendar. The calendar and kanban hooks were
previously `// TODO` / `console.log` stubs and now work.

## Background Agent Work

Delegation did not disappear; it stopped being something the user drives by
hand. What remains runs out of band:

- **Heartbeat** rules (`action_type: "delegate_to_agent"`)
- **The `delegate_to_agent` skill**
- **The `delegate_to_agent` MCP tool**

These insert into `agent_tasks`, `executeAgentTask()` runs them, and the output
lands in `/review` (`ReviewView` → `AgentQueue` → `AgentReviewFocusPanel`) where
approve / revise / reject still apply — because nobody was sitting in front of
that work when it ran.

### Supported source types

| Source Type | AI Behavior | Original Preserved |
|-------------|-------------|-------------------|
| **Task** | Complete the task | Yes |
| **Note** | Feedback, suggestions, alternative perspectives, next steps | Yes |
| **Capture/Thought** | Expand and complete the thought | Yes |
| **Reminder** | Prepare context, action items, relevant info | Yes |
| **Insight** | Deeper analysis, practical applications | Yes |

**IMPORTANT**: the original content is NEVER deleted. AI outputs are linked
alongside the original.

### Agent types

The 17 specialist types still exist as `agent_configs` rows and a background
caller may name one. They are no longer a roster the user picks from:
`AGENT_ROLES` (`src/lib/agents/constants.ts`) names the *job* ("Code",
"Research") wherever a label is rendered, because a badge reading "Alex" told
the user nothing about what ran.

`agent_type: "auto"` now means **`general`**. The keyword/LLM router that used
to choose among 17 existed to spare the user a 17-way choice in a dialog that no
longer exists; `src/lib/agents/router.ts`, `POST /api/agents/route` and the
`agent_routing_log` audit table are gone with it.

### Nothing fires behind the user's back

`POST /api/stream` used to delegate automatically whenever the classifier
suggested an agent, and the Brain Bar carried its own 17-agent picker. Capturing
a thought therefore started background work nobody asked for, which piled up in
a review queue nobody visited. The classifier still *names* a suggestion; only
an explicit `delegatedTo` from the caller acts on it.

### Database Tables

- `agent_configs` - Agent definitions with system prompts
- `agent_tasks` - Delegated tasks (with `source_type` / `source_id` for any entity)
- `agent_task_outputs` - Versioned outputs
- `agent_task_feedback` - User review feedback

### API Routes

- `GET/POST /api/agent-tasks` - List/create agent tasks.
  `?sourceType=&sourceId=` answers "what background work exists against this
  entity?", which is what the note page asks. That used to be `GET
  /api/delegate`; the endpoint went with the delegation UI, the question did not.
- `GET/DELETE /api/agent-tasks/[id]` - Task details/deletion
- `POST /api/agent-tasks/[id]/approve|revise|reject` - Review actions
- `GET /api/agent-tasks/stats` - Aggregate stats
- `GET /api/agents`, `GET /api/agents/[type]` - Agent configs

### Key Services

- `src/lib/agents/context.ts` - Build task context from notes/embeddings
- `src/lib/agents/executor.ts` - Execute agent tasks with type-specific prompts
- `src/lib/agents/status-sync.ts` - Sync statuses (task entities only)

### Status Sync

For task entities, agent_task and task statuses are synchronized:
- `queued/processing/revision_requested` → `in_progress`
- `awaiting_review` → `in_progress`
- `approved` → `completed`
- `rejected/failed` → `pending`

For non-task entities, only the agent_task status is tracked.

### Execution & Queue Reliability

Delegation entry points kick off `executeAgentTask()` fire-and-forget, and
`/api/cron/process-agent-queue` (every minute) is the safety net. Both can reach
the same task, so execution is built around a single invariant:

- **Atomic claim.** `executeAgentTask()` starts with a conditional
  `UPDATE … SET status='processing' WHERE id=? AND status IN ('queued',
  'revision_requested','failed')`. `rowsAffected === 0` means another worker owns
  the task and this one returns without calling the model. Without the claim,
  two workers produce the same `version_number` and the loser trips
  `UNIQUE(agent_task_id, version_number)` — failing a task that actually
  succeeded.
- **Version numbers come from SQL** (`COALESCE(MAX(version_number),0)+1`), never
  from the in-memory `current_version` read at the start of the run.
- **Empty output is a failure, not a result.** `completeWithMeta()` surfaces
  `finish_reason`; a blank body with `finish_reason: "length"` is retried once at
  double the token budget (reasoning models can spend the whole budget on hidden
  tokens), and anything still blank throws instead of being stored as output.
- **Transient upstream errors retry.** 429/5xx/network failures get bounded
  exponential backoff inside `completeWithMeta`; other errors fail fast.
- **The cron recovers three states**: tasks stuck in `processing` past the
  timeout, revisions abandoned in `revision_requested`, and `failed` tasks that
  still have `retry_count < max_retries`. `retry_count` resets to 0 on success.
- **Only configured agents are dispatched.** A caller can name any of the 17
  agent types, but delegation falls back to a seeded agent when the named one
  has no `agent_configs` row — the executor hard-fails on a missing config.

The cron declares `maxDuration = 300` and stops starting new work near that
ceiling, so a run is never killed mid-task with a batch half-processed.

**Migrations**: `npx tsx scripts/migrate-add-new-agents.ts` adds the 10
professional agent types (legal, finance, hr, product, sales, operations,
security, data_eng, educator, strategy).

## Model Selection

Which model runs which job is configuration, not a constant in this repo. Before
this, ids lived in `DEFAULT_MODEL` / `MINIMAX_MODEL` and in bare string literals
across a dozen files; when a provider retired one, the only symptom was a
subsystem quietly not working, and the fix was a code change and a redeploy.

- **Slots** (`src/lib/ai/models/slots.ts`): jobs, not models — `fast`
  (summaries, tags, capture triage, task parsing, agent routing), `deep`
  (insights, weekly reviews, project health), `agent` (delegated work),
  `vision` (handwriting, image and audio), `embedding` (search index). Each
  carries an ordered candidate list, a recommendation reason, and whether the
  Auto Router may stand in for it.
- **Live catalog** (`catalog.ts`): `GET https://openrouter.ai/api/v1/models` is
  public and always current, which makes it — not a checked-in list — the
  source of truth for "does this model still exist?". Cached in-process for an
  hour (not `ai_cache`, whose `user_id` is a FK while the catalog is global).
  Prices are converted from USD-per-token to per-million for display.
- **Resolution** (`resolve.ts`, pure and unit-tested): user's saved choice →
  env override → slot candidates → `openrouter/auto`. **Any id absent from the
  live catalog is skipped**, including the user's own — that is what makes a
  retired model self-heal, and `retiredSelection` is reported so Settings can
  say which id disappeared. A catalog that *failed to fetch* is treated as
  unknown (`availableIds: null`) rather than empty, so losing the network never
  demotes a working deployment.
- **Never failing** (`client.ts`): every chat request carries OpenRouter's
  `models: [...]` array so failover happens server-side within the one request,
  and the chain ends at `openrouter/auto`, which cannot 404. A client-side hop
  fires only for `isModelUnavailableError` — a *retired id*, which no retry can
  fix. Transient errors (429/5xx) keep the original retry-then-give-up
  contract, because OpenRouter has already failed those over internally and
  hopping again would just double the spend. Embeddings never fall back to the
  Auto Router: a text model cannot produce a 1536-dim vector, and silently
  swapping one would make new vectors incomparable with every stored one.
- **API**: `GET /api/models` (catalog + per-slot resolution + recommendations;
  `?refresh=true` forces a re-fetch), `PUT /api/models` with
  `{ models: { <slot>: <id|null> } }`. Saves are validated against the live
  catalog, so a typo is caught at save time rather than as a failed background
  job days later. `null` clears a slot back to the recommended default.
- **UI**: Settings → AI Models. Each row names a job, shows what breaks if it
  breaks, and lists live models with context window, per-million pricing, and
  image support, recommended first.
- **Storage**: `users.preferences` JSON under a `models` key. No migration.
- **Agent overrides**: a model pinned on an `agent_configs` row still wins, but
  it is now the *head of a chain* rather than the only option, so a config
  pinned to a retired id degrades instead of failing every task.

## Provenance & Run Collapsing

One agent run wrote a few hundred rows, and because the feed orders everything
by `updated_at`, all of it landed on top of the work the user came back to deal
with. The rows were not wrong and the user had asked for them. They were
rendered as two hundred unrelated thoughts instead of as the one job they were.

Two things were missing, and they are different things:

- **Who wrote a row.** Nothing recorded it. `notes`, `captures`, `tasks` and
  `reminders` had no author column, and the `sourceType` on a stream row was
  synthesised in SQL at read time — the literal `'manual'` for every capture,
  note and reminder, whoever wrote it. A note written by an MCP key was
  byte-identical to one the user typed. The information was always available:
  `validateApiKey` returns `keyId` and `keyName` on every call, and every tool
  handler used `userId` and dropped the rest.
- **Which operation produced it.** This is the one that actually hurt. The
  problem was never "an agent wrote things"; it was *one job* arriving as N
  rows. Author alone does not fix that.

### The columns

Four nullable columns on `notes`, `captures`, `tasks`, `reminders`, indexed as
`(user_id, source_run_id)`:

| Column | Holds |
|--------|-------|
| `source_actor` | `human` / `mcp_key` / `agent` / `skill` / `import` |
| `source_key_id` | `mcp_api_keys.id`, **without** a foreign key |
| `source_label` | the writer's name *at write time* |
| `source_run_id` | the one operation this row came out of |

- **NULL means "the user, typing".** Every row predating these columns has NULL
  in all four, and nearly all of them were typed. Reading NULL as `human`
  (`normalizeActor`) is both the correct default and what makes the migration
  backfill-free. Session-cookie API routes deliberately leave the columns unset
  for the same reason — same meaning, far smaller diff than writing `'human'`
  into every insert site in the app.
- **No FK on `source_key_id`, on purpose.** Revoking a key must not cascade
  away the history of everything it ever wrote, and `source_label` is
  denormalised so a revoked key's rows still read "Claude Desktop" rather than
  a dead id.
- `src/lib/provenance/types.ts` imports **nothing** — it is shared by the MCP
  tools (which run outside Next.js against their own libsql client), the API
  routes and the browser, so it must not reach for a DB client. Same reasoning
  as `chat/item-types.ts`.
- **Migration**: `npm run migrate:provenance`, or `npm run db:migrate`. No
  backfill, idempotent.

### Where a run id comes from

One id per *request* is useless over the HTTP MCP transport, which is stateless
— one request is one tool call, so every row would get its own run. So the
default is derived server-side: **writes from one key continue the same run
while the gap between them stays under 30 minutes** (`createRunTracker`). It
needs no client cooperation and works with every integration that already
exists, which is the point — the clients that matter most are the ones nobody
configured.

- **The window slides**, so a job writing steadily for four hours is one run.
  `DEFAULT_MAX_RUN_MS` (6h) stops that becoming unbounded for a key that writes
  every few minutes forever.
- **A client may group its own job** by sending `X-Brain-Run-Id`. The id is
  *adopted* as the key's current run, so later writes join it even if the
  client stops sending the header.
- **State is in-process**, exactly as `src/mcp/rate-limit.ts` keeps its token
  buckets. A cold start or a second serverless instance splits one job into two
  runs, which shows two collapsed rows instead of one — it degrades toward
  today's behaviour, never toward anything wrong.
- Other subsystems already know their own operation, so the same column means
  the same thing everywhere: `agentStamp` uses the agent task, `skillStamp` the
  skill execution, `importStamp` the import job.

### Collapsing in the feed

`collapseRuns` (`src/lib/stream/runs.ts`, pure and unit-tested) folds each run
into one entry, and runs **before** `groupStream` so a run takes one slot in its
time bucket rather than filling the bucket with its members. Its entries carry
`updatedAt`, so that function buckets them unchanged.

> **Claude Desktop** wrote 23 notes and 4 tasks · 2:14pm – 2:41pm

- **The entry sits where the run's *newest* write sits**, so the feed's overall
  ordering is exactly what it was. Positioning it at the run's start would sort
  a batch that began this morning below everything written since.
- **Runs under `MIN_RUN_SIZE` (3) stay expanded.** "Claude Desktop wrote 2
  notes" costs a click and says less than the two rows it replaced.
- **A human's writes are never collapsed**, even if something stamped a run id
  on them. The user does not need their own typing summarised back to them.
- **Nothing is hidden and nothing moved.** `StreamRunCard` expands to the rows
  themselves, at the viewer's chosen density and with their usual actions, and
  one archive clears the batch — chunked 8 at a time, because `/api/stream/[id]`
  resolves each id against five candidate tables.
- **Counts are a lower bound while paging.** The feed loads 30 at a time, so a
  run reaching the oldest loaded row is flagged `mayExtend` and renders "23+"
  rather than claiming a total it cannot know.

### Deliberately not done

Origin as a **filter** ("Just me" / "Just agents") and **per-key write routing**
(send this key's output to a project, or to `/review`, instead of the stream)
were designed alongside this and deliberately left out. Run-collapsing addresses
the actual complaint; whether a filter is still wanted is worth finding out by
using this first, rather than by building four knobs nobody reaches for.

## Content Processing Queue

`processing_queue` holds the work that makes a note usable: its embedding
(search indexing), summary, auto-tags, connections, and task scanning.
`/api/cron/process-queue` (every 5 minutes) is what drains it in production.

The handlers live in `src/lib/processing/processors.ts` so the route can run
them. Before that they existed **only** in `scripts/process-queue.ts`, a CLI
with its own libsql client — so in production the jobs were enqueued and
nothing ever ran them. The cron route knew about exactly one operation,
`link-scrape-and-embed`, and its query ordered by a `created_at` column that
`processing_queue` does not have (it has `scheduled_at`), so every run 500'd
before doing any work at all.

Two properties keep that from recurring:

- **A job failure is a job failure, not a run failure.** Each job is wrapped
  individually; the error is recorded on the row via `error_message` and the
  batch continues. Only an error outside the per-job loop can 500 the run.
- **Atomic claim.** A job is taken with a conditional
  `UPDATE … SET status='processing' WHERE id=? AND status='pending'`;
  `rowsAffected === 0` means an overlapping run owns it. `attempts` is
  incremented at claim time and nowhere else, so a job that reliably kills its
  worker still exhausts `max_attempts` instead of looping forever. Jobs left in
  `processing` by a killed run are reset to `pending` after 15 minutes.

`maxDuration = 300`, and the run stops claiming new jobs 45s short of that
ceiling so it is never terminated mid-job.

**Not handled by the cron** (`SERVERLESS_OPERATIONS` lists what is): attachment
media jobs — `extract_metadata`, `generate_thumbnail`, `extract_text`,
`generate_description` — because they pull sharp, pdf-parse, xlsx and the S3
client, none of which are declared as `serverExternalPackages` in
`next.config.ts`. Attachment *embeddings* are excluded for a separate reason:
the `embeddings` table's CHECK constraint permits only `note`, `capture` and
`task_candidate`, so an attachment vector has nowhere to be stored. Both stay
with `npx tsx scripts/process-queue.ts` until those are addressed.

## Background Failure Visibility

Background work (agent delegation, the embedding queue, heartbeat, skills) runs
out of band, so when it broke the user's only signal was that nothing ever came
back. A red alert appears in the header **only** when something is actually
wrong, and it explains why in language a user can forward to an admin.

- **Diagnosis** (`src/lib/system-health/diagnose.ts`): pure `diagnoseError(raw)`
  maps provider jargon (`401 No auth credentials found`, `402 Insufficient
  credits`, `Agent config not found for legal`) onto a stable `DiagnosisCode`
  plus a title, a plain-language explanation, an `adminHint`, and whether a
  retry could plausibly help. `redactSecrets` strips key-shaped text before any
  raw error reaches the client. Unit-tested against the exact strings the
  executor throws.
- **Aggregation** (`src/lib/system-health/index.ts`): `getSystemHealth(userId)`
  probes four subsystems plus server configuration and returns a short,
  deduplicated issue list. It reports three classes of problem:
  1. things that failed and said why (agent tasks, queue jobs, skills, heartbeat);
  2. **things that never ran at all** — work stalled in `queued` for 20+ minutes,
     or stuck in `processing` for 15+ — which produce no error row and were
     therefore completely invisible before;
  3. things that cannot possibly work (no `OPENROUTER_API_KEY`, no `CRON_SECRET`
     in production so every `/api/cron/*` call is 401'd, no rows in
     `agent_configs`).
  Every probe is wrapped so a missing optional table can't break the endpoint.
- **Client-safe types** (`src/lib/system-health/types.ts`): types plus
  `formatAdminReport`, kept apart from `index.ts` so the panel can import them
  without pulling the DB client into the browser bundle.
- **API**: `GET /api/system-health` (scoped to the caller; config checks report
  *presence* of env vars, never values), `POST /api/system-health` with
  `{ action: "retry_agent_tasks", agentTaskId? }` to re-queue failed work
  (capped at 10 per request; the executor's atomic claim keeps it safe next to
  the cron worker).
- **UI**: `SystemHealthIndicator` renders nothing when healthy; otherwise a
  red/amber `AlertTriangle` with a count sits beside the notification bell.
  `SystemHealthPanel` is a sheet matching the notification panel, with a
  per-issue "Details for your admin" disclosure and a **Copy report** button
  producing plain text to paste into chat or an issue. Dismissals are
  local-only (`localStorage`, 7-day TTL) and keyed so a *newer* occurrence
  resurfaces — the only real way to clear an issue is to fix its cause.
- **No new tables, no migration.**

Related fixes in the same area:

- `agent_failed` notifications now carry the *diagnosis* rather than the raw
  provider string, and link to `/agents`.
- The agent scan windows widened from 30 minutes to 12 hours (with matching
  dedup windows), so a failure that happened while the user was away is still
  surfaced when they come back.
- `scanBackgroundHealth` emits `system` notifications for blocking problems that
  produce no error row at all, deduped per `kind:code` every 6 hours.
- `/api/cron/process-notifications` was missing from `vercel.json` and is now
  scheduled every 15 minutes — without it the scan only ever ran client-side
  while the app was open.

## Share to Brain Portal (Web Share Target)

Brain Portal registers as an OS share target, so a link or a block of text can
be sent to it from any app's share sheet instead of being copied, pasted, and
lost. Primary target is Android Chrome (installed PWA); the same entry point
works for iOS Shortcuts, desktop bookmarklets, and external agents.

- **Manifest** (`src/app/manifest.ts`): `share_target` with `method: "GET"` →
  `/share`. GET on purpose — a GET target is a plain navigation to a normal
  page, so it needs no service-worker interception and no POST-redirect dance.
  The trade-off is that **files cannot ride along**; file sharing would require
  a POST target and is not wired up. A `shortcuts` entry also exposes "Save
  something" from the app's launcher icon.
- **Payload normalization** (`src/lib/share/parse.ts`): pure and unit-tested,
  because Android apps disagree about which field carries the link — Chrome
  fills `url`, Twitter/Reddit bury it inside `text`, some sheets send the bare
  URL and nothing else. `parseSharedPayload` picks the URL out of whichever
  field has it, promotes a first line to a title only when that leaves a real
  body behind, and never stores the same string twice. Parsing is idempotent, so
  the page's parse and the API's re-parse agree (there is a test for exactly
  that round trip).
- **Page** (`src/app/share/page.tsx` + `src/components/share/share-capture-form.tsx`):
  a focused card rendered outside the dashboard layout. Destination defaults to
  **Capture**; Note and Task are one tap away. 56px touch targets, Cmd/Ctrl+Enter
  to save.
- **API** (`POST /api/share`): `{ url?, text?, title?, target?, projectId?,
  tags?, comment? }`. Authenticates by session cookie **or** an
  `Authorization: Bearer bp_mcp_...` MCP key (scope-checked per destination:
  `captures:write` / `notes:write` / `tasks:write`) — which is what makes an iOS
  Shortcut or an external automation a first-class caller. Shared links are
  enqueued for `link-scrape-and-embed` so the page's contents become
  semantically searchable, not just its URL.
- **Middleware**: the login redirect now preserves the query string, so a share
  payload survives being bounced through auth.

## Semantic Highlights (highlight-to-instruct)

Highlighting a passage in a note is an *instruction*, not decoration. The colour
says what the user wants done with that passage, and every LLM that later reads
the note is handed the same meanings — so a review responds to the markup
without the user writing a sentence of instruction.

| Colour | Intent | Means |
|--------|--------|-------|
| Green | `approve` | Keep as is — don't touch it |
| Yellow | `edit` | Rework this |
| Blue | `expand` | Say more here |
| Purple | `condense` | Too long, tighten it |
| Red | `cut` | Remove this / I disagree |
| Orange | `verify` | Fact-check this |
| Pink | `question` | I don't follow — explain it |

- **Vocabulary** (`src/lib/annotations/intents.ts`): the single source of truth —
  each intent carries a user-facing `meaning`, the `directive` handed to the
  model, a swatch, and a shortcut (`Mod-Alt-1`…`7`, `Mod-Alt-0` clears). Pure, so
  the editor, the sanitizer and the server prompt builders all share it.
- **Mark** (`src/components/editor/extensions/annotation.ts`): renders
  `<mark data-intent="expand" class="bp-annotation bp-annotation-expand">`. Both
  carriers are deliberate — the data attribute is what the prompt builder reads,
  the class is what survives `ALLOW_DATA_ATTR: false`, so a shared or exported
  view never loses the colour. `data-note` holds an optional per-highlight
  comment. The mark is `inclusive: false` so typing at a highlight's edge doesn't
  silently extend it.
- **UI** (`src/components/editor/annotation-menu.tsx`): a toolbar dropdown that
  spells out what each colour means (the discoverable path, works on mobile) and
  a selection bubble menu of swatches (the fast path). Both label by meaning, not
  by colour.
- **Reading them back** (`src/lib/annotations/extract.ts`, pure and unit-tested):
  `extractAnnotations` parses the marks out of note HTML with regex — it runs
  server-side where there is no DOM — merging marks the editor split, ignoring
  plain `<mark>`s that carry no meaning. `formatAnnotationsForPrompt` renders the
  prompt block, explaining **only the intents actually used** and telling the
  model that the markings outrank the general instructions.
- **Why HTML, not `content_plain`**: `content_plain` has every tag stripped, so by
  the time a note reaches a prompt the highlights are gone. Annotations are always
  read from `notes.content`, and fetched *independently* of the source body — they
  still apply when the body is already in the prompt as the task description.
- **Wired into**: the agent executor (an `<annotations>` block in both the initial
  and revision prompts — `annotations` is in `PROMPT_STRUCTURAL_TAGS` so injected
  content can't forge one), note analysis (`src/lib/analysis/analyzer.ts`, where
  markings steer findings vs. open questions vs. action items), the **item chat
  context** (`src/lib/chat/item-context.ts`, read from the raw body because
  `content_plain` has already stripped the markup — see *Asking About an Item*),
  and markdown export (`==[expand] text==` — markdown has no colour, so the
  intent is written out).
- **No new tables, no migration.** Highlights live in the note HTML.

## Insight Quality Pipeline

Insight generation runs a quality wrapper before anything is persisted, so the
engine stops re-deriving the same idea and starts learning the user's taste.

- **Pure core** (`src/lib/ai/insight-quality.ts`): `dedupeInsights` (cosine
  similarity ≥ threshold → suppress), `applyDiversityBudget` (cap per type),
  `computeTypeFeedbackBias` + `rankInsights` (bias ranking by up/down history).
  Vector math lives in `src/lib/ai/vector.ts` (client-free, unit-testable).
- **Wiring** (`POST /api/insights/generate`): embeds each candidate, dedups it
  against recent stored insight embeddings (kept in `insights.metadata.embedding`)
  and against the batch, applies the diversity budget, then ranks by feedback.
- **Feedback loop**: `PUT /api/insights` accepts `upvote` / `downvote` /
  `clear_feedback`; the `insights.feedback` column feeds ranking, and the list
  endpoint sinks downvoted / floats upvoted insights.
- **Migration**: `npx tsx scripts/migrate-add-insight-quality.ts` (or
  `npm run migrate:insight-quality`).

## Entity / Knowledge Layer

A canonical entity graph beneath the note graph — so the app reasons about the
*entity*, not the string (e.g. "Northwind" fragmented across many notes becomes
one node with many mentions).

- **Tables**: `entities` (canonical people/orgs/places/projects/inputs),
  `entity_aliases` (surface variants), `entity_mentions` (timeline source rows),
  `entity_edges` (typed relationships: `supplies`, `funds`, `depends_on`,
  `blocks`, `located_in`, `works_with`, `same_as`, `part_of`, `related`).
- **Resolution** (`src/lib/entities/resolve.ts`): pure `normalizeEntityKey`
  (suffix-stripping + alphanumeric key collapses "Northwind Farms"→"Northwind" and
  "FieldTechAI"→"Field tech ai"), `resolveEntity`, `dedupeExtractedEntities`,
  `buildCoOccurrencePairs`. Unit-tested.
- **Extraction & store** (`src/lib/entities/extractor.ts`, `store.ts`): LLM
  extraction + idempotent ingestion (upsert entity → record mention → build
  co-occurrence edges). Re-ingesting a source never double-counts.
- **API**: `GET /api/entities` (list, filter by type/search), `GET
  /api/entities/[id]` (entity + mention timeline + typed-edge neighbors), `POST
  /api/entities/extract` (run over recent notes).
- **Migration**: `npx tsx scripts/migrate-add-entity-layer.ts` (or
  `npm run migrate:entity-layer`).

## CRM Layer (Phase 0)

A contact layer built **on** the entity graph rather than beside it, so contacts
are populated by notes the user already wrote instead of by data entry. Design
and reasoning: `docs/plans/2026-09-13-crm-phase-0-design.md`.

- **Tables**: `contact_channels` (how to reach an entity, and the inbound
  resolver — UNIQUE per user/kind/value, so one address maps to exactly one
  contact), `interactions` (a *touch*, as opposed to an `entity_mention`, which
  is only a reference in something the user wrote).
- **Ventures, products, projects** (`src/lib/crm/structure.ts`): a venture is an
  `org` entity with `metadata.is_venture`; a product is a `product` entity held
  by a swappable `part_of` edge; a project stays in the `projects` table with a
  `venture_id` column. One interface over two storages, so callers never branch.
- **History never moves with the product.** `interactions.venture_id` is a
  snapshot written at insert time and never resolved by walking the current
  edge. Moving a product between ventures must not rewrite the venture that past
  touches, revenue and compliance context belong to. There is a named test.
- **Merge gate** (`assessMerge` in `src/lib/entities/resolve.ts`):
  `normalizeEntityKey` strips business suffixes, so "Northwind Farms",
  "Northwind Holdings" and "Northwind & Sons" collapse to one key and collide
  irreversibly under `UNIQUE(user_id, normalized_key)`. Rules 1-4 reproduce the
  previous behavior exactly; rule 5 catches the manufactured match and creates a
  flagged row instead of fusing. `metadata.name_locked` stops an offhand note
  renaming an entity whose name is on an invoice.
- **Acting on the queue** (`src/lib/crm/merge.ts`): `mergeEntities` moves
  mentions, touches, channels and edges, records the loser's name as an alias so
  the merge leaves a trace, and never touches `interactions.venture_id`.
  `resolveContact` names or merges an unresolved event capture.
- **Compartments** are advisory in Phase 0: stored, displayed, filterable,
  nothing blocked. Enforcement lands with intake in Phase 1.
- **Pure, unit-tested cores**: `channels.ts` (normalization; plus-tags are
  deliberately preserved), `dedup.ts` (interaction natural key, bucketed by day),
  `metadata.ts` (conventions whose defaults all avoid a backfill).
- **Surfaces**: `/crm` (`?tab=unresolved` opens the review tab directly, so the
  dashboard can link at a decision rather than at the page containing it),
  `/crm/[entityId]`, `/crm/ventures`, `/crm/ventures/[id]`; `/api/crm/*`; the
  dashboard's People band and the Contacts entry in both menus (see
  *Dashboard* and *Navigation*); and 16 MCP tools.
- **Roles** attach a contact to a venture (`setContactRole`, and
  `POST /api/crm/contacts/[id]/roles`). A contact may hold several roles at
  several ventures — that is the point of one Rolodex across seven businesses.
  Only these deliberate role edges count toward a venture's contact total;
  `related` edges are written automatically by co-occurrence and counting them
  would report every co-mentioned entity as a contact.
- **Seeding is optional and ships empty.** `seedVentures` reads
  `ventures.seed.json` from the project root (gitignored; copy
  `ventures.seed.example.json`) and does nothing when it is absent. It used to
  hold a hardcoded list of the author's own businesses, which every clone of
  the repository would then create in a stranger's database.
- **Migration**: `npm run migrate:crm-phase-0`, then optionally
  `npm run seed:ventures`. Run `npm run audit:merge-candidates` first — it is
  read-only and reports how many existing pairs the gate will flag.

**Not in Phase 0**: deals and pipelines, intake (BCC dropbox, calendar, contact
scraping), compliance enforcement, and semantic search over interaction bodies
(the `embeddings` CHECK permits only `note`, `capture`, `task_candidate`).

## Skills Architecture

A modular, registry-driven capability system that allows agent behaviors to be invoked uniformly by heartbeat, agents, users, or API. Skills wrap existing system capabilities into discoverable, validated, rate-limited, and fully audited units.

### Core Concepts

- **Skill Registry** (`src/lib/skills/registry.ts`): In-memory registry of skill definitions and handlers
- **Skill Executor** (`src/lib/skills/executor.ts`): Executes skills with validation, rate limiting, and audit logging
- **Built-in Skills** (`src/lib/skills/builtins.ts`): Pre-registered skills wrapping existing capabilities

### Built-in Skills

| Skill ID | Category | Description | Cost Tier |
|----------|----------|-------------|-----------|
| `send_notification` | notification | Create in-app notifications | free |
| `delegate_to_agent` | delegation | Dispatch work to AI agents | high |
| `summarize_content` | analysis | AI-powered text summarization | low |
| `find_related_notes` | analysis | Semantic search for related notes | low |
| `enqueue_processing` | processing | Add items to background queue | low |
| `generate_insights` | analysis | AI pattern/connection analysis | medium |
| `daily_digest` | content | Compile daily activity summary | low |
| `auto_triage_captures` | processing | Auto-classify & convert unprocessed captures | medium |

### Database Tables

- `skills` - Skill definitions with input schemas, versioning, rate limits
- `skill_executions` - Full audit log of every skill invocation

### API Routes

- `GET /api/skills` - List all registered skills (with optional `?category=` filter)
- `POST /api/skills/execute` - Execute a skill: `{ skill_id, params }`
- `GET /api/skills/executions` - Execution history (with optional `?skill_id=`, `?status=`, `?limit=`)

### Heartbeat Integration

Heartbeat tasks can use `action_type: "execute_skill"` with `action_params`:
```json
{
  "skill_id": "generate_insights",
  "skill_params": { "scope": "recent", "days": 7 }
}
```

### Adding New Skills

Register in `src/lib/skills/builtins.ts` or dynamically via the registry:
```typescript
import { registerSkill } from "@/lib/skills";
registerSkill(definition, handler);
```

Each skill defines: `skillId`, `inputSchema` (typed params with validation), `category`, `costTier`, `rateLimitPerHour`, and a handler function.

## MCP Server (Model Context Protocol)

A full-featured MCP server that exposes Brain Portal's capabilities to Claude Code and other MCP-compatible clients via stdio transport.

### Architecture

- `src/mcp/server.ts` - Main entry point (stdio transport, auth, registration)
- `src/mcp/auth.ts` - API key authentication (SHA-256 hashed keys, scoped to users)
- `src/mcp/db.ts` - Standalone Turso client (runs outside Next.js)
- `src/mcp/tools/` - MCP tool implementations (38 tools; `index.ts` is the single
  registration point both transports and the catalog test use)
- `src/mcp/resources/` - MCP resource providers (7 resources)
- `src/mcp/prompts/` - MCP prompt templates (4 prompts)

### Tools (38 total)

| Tool | Description |
|------|-------------|
| `list_notes` | List notes with filtering by project, type, search |
| `get_note` | Get note with full content, tags, connections |
| `create_note` | Create a new note |
| `update_note` | Update note title, content, metadata |
| `delete_note` | Delete a note |
| `list_tasks` | List tasks with status/priority/date filtering |
| `create_task` | Create a task with priority and due date |
| `update_task` | Update task status, priority, content |
| `delete_task` | Delete a task |
| `list_projects` | List projects with note/task counts |
| `get_project` | Project details with stats, notes, tasks |
| `create_project` | Create a new project |
| `update_project` | Update project name, status, color |
| `list_captures` | List captures by type |
| `create_capture` | Quick capture a thought/idea/reference |
| `semantic_search` | AI-powered similarity search via embeddings |
| `generate_insights` | Generate AI insights from notes/captures |
| `delegate_to_agent` | Queue background work for an agent (lands in `/review`) |
| `get_agent_task` | Check agent task status and output |
| `list_agent_tasks` | List delegated agent tasks |
| `search` | Full-text search across all entity types |
| `recent_activity` | Recent activity feed |

**CRM tools (16)** — see *CRM Layer* above:

| Tool | Description |
|------|-------------|
| `search_contacts` | Search contacts across ventures; hides unresolved captures by default |
| `get_contact_brief` | Channels, venture roles, compartments, merged mention/touch timeline |
| `create_or_merge_contact` | Create a contact through the merge gate |
| `add_contact_channel` | Attach an email, phone, handle, URL or address |
| `log_interaction` | Record a real touch, idempotently |
| `list_review_queue` | Unresolved captures and possible duplicates |
| `resolve_contact` | Name an unresolved capture, or merge it away |
| `merge_contacts` | Fold one contact into another |
| `set_contact_role` | Attach a contact to a venture as partner, customer, etc. |
| `remove_contact_role` | Remove one role a contact holds at a venture |
| `list_ventures` | Ventures with counts, voice and compliance rules |
| `list_venture_members` | A venture's products and projects |
| `create_venture` | Create or adopt a venture |
| `create_product` | Create a product, optionally under a venture |
| `move_to_venture` | Move a product or project between ventures |
| `export_crm` | JSON or CSV export |

### Resources (8)

| URI | Description |
|-----|-------------|
| `brain://notes` | All active notes |
| `brain://notes/{noteId}` | Individual note with tags |
| `brain://projects` | All projects with stats |
| `brain://tasks` | Active tasks |
| `brain://daily` | Today's daily note and captures |
| `brain://agents` | Available AI agents |
| `brain://insights` | Recent AI insights |
| `brain://dashboard` | Dashboard summary with stats |

### Prompts (4)

| Prompt | Description |
|--------|-------------|
| `summarize_notes` | Summarize recent notes by theme |
| `weekly_review` | Generate comprehensive weekly review |
| `plan_delegation` | Plan how to delegate work to agents |
| `brain_dump` | Organize unstructured thoughts into notes/tasks/captures |

### Authentication

Two modes:
1. **API Key** (production): Set `MCP_API_KEY` env var. Keys are SHA-256 hashed in `mcp_api_keys` table.
2. **User ID** (development): Set `MCP_USER_ID` env var for trusted environments.

Generate API keys via the Settings → "AI API access" panel (preferred — supports scopes, rate limits, expiry) or via CLI: `npm run mcp:keygen -- user@example.com "Key Name"`.

### Scopes & Rate Limiting

Every tool / resource / prompt invocation is guarded by `src/mcp/guard.ts`:

1. **Scope check** — the key must hold the required scope or `*`. Denied calls do NOT consume a rate-limit token.
2. **Rate limit** — token-bucket keyed by API-key id (`src/mcp/rate-limit.ts`), refilling continuously at `rate_limit_per_minute / 60000` tokens per ms.

Canonical scopes (`MCP_SCOPES` in `src/lib/mcp/keys.ts`): `notes:read`, `notes:write`, `tasks:read`, `tasks:write`, `projects:read`, `projects:write`, `captures:read`, `captures:write`, `search:read`, `ai:search`, `ai:insights`, `ai:delegate`, `resources:read`, `prompts:read`, `crm:read`, `crm:write`. `*` is wildcard.

**Adding a tool module**: register it in `src/mcp/tools/index.ts`. Both transports
and `tests/mcp/catalog.test.ts` derive from `TOOL_MODULES` there, so the catalog
check cannot be bypassed by a module it does not know about — which is exactly
what happened before that file existed.

### Transports

- **stdio** (`src/mcp/server.ts`, `npm run mcp:start`) — for local clients like Claude Code / Desktop.
- **HTTP** (`src/app/api/mcp/rpc/route.ts`) — Streamable-HTTP transport for remote agents. Stateless; auth via `Authorization: Bearer bp_mcp_...`. Returns JSON by default (SSE via GET).
- **HTTP with the key in the URL** (`src/app/api/mcp/rpc/[key]/route.ts`) — `POST /api/mcp/rpc/bp_mcp_...`
  (or `?key=bp_mcp_...`). Same handler (`src/app/api/mcp/rpc/handler.ts`), different credential source.
  Exists for clients that cannot attach a static header — notably the Claude.ai custom-connector form,
  which exposes only OAuth client id/secret fields. The header wins when both are present. URL-borne
  keys show up in proxy access logs, so issue a dedicated, narrowly-scoped, expiring key for them.

### Claude.ai custom connector setup

1. Settings → "AI API access" → create a key (scope it; `read_only` + `ai:search` is a sane default).
2. Claude.ai → Settings → Connectors → Add custom connector.
3. URL: `https://<your-app>/api/mcp/rpc/bp_mcp_...` — leave OAuth client id/secret blank.
   If your Claude build offers a "Request headers" field, prefer `https://<your-app>/api/mcp/rpc`
   with `Authorization: Bearer bp_mcp_...` instead and keep the key out of the URL.

The server must be publicly reachable — Claude connects from Anthropic's cloud, not the browser.
`/api/mcp/rpc` is listed in `publicRoutes` in `src/middleware.ts`, so the session-cookie guard
doesn't intercept it.

### Self-Documenting Spec

`GET /api/mcp/docs` returns the full machine-readable catalog (tools, resources, prompts, scopes, auth, rate-limit details). Drives both human and LLM discovery.

- `?format=json` (default) — catalog with JSON Schema for every tool/prompt input
- `?format=openapi` — OpenAPI 3.1 spec for the HTTP transport + key-management routes
- `?format=markdown` — human-readable docs

The spec is built from `src/lib/mcp/catalog.ts`, which is the single source of truth. `tests/mcp/catalog.test.ts` enforces that every registered tool has a catalog entry.

### Setup

```bash
# 1. Run migration to create API keys table
npm run mcp:migrate

# 2. Generate an API key
npm run mcp:keygen -- user@example.com "Claude Code"

# 3. Add to Claude Code config (~/.claude/claude_code_config.json)
```

```json
{
  "mcpServers": {
    "brain-portal": {
      "command": "npx",
      "args": ["tsx", "/path/to/brain-portal/src/mcp/server.ts"],
      "env": {
        "TURSO_DATABASE_URL": "libsql://...",
        "TURSO_AUTH_TOKEN": "...",
        "MCP_API_KEY": "bp_mcp_...",
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

### Database Tables

- `mcp_api_keys` - API key storage (hashed keys, scopes, rate limits, expiration)
- Migration: `npx tsx scripts/migrate-add-mcp-api-keys.ts`

## External Agent Integration

Brain Portal is designed to be driven ambiently by an external AI agent, so the
agent stays current on what the user is working on — the whole point of Brain
Portal is to keep a durable copy of every thought, not leave them buried inside
an LLM session.

### How the wiring works

Any MCP client (Claude.ai connectors, Claude Code, Cursor, custom agents) can
connect over the HTTP MCP transport (`/api/mcp/rpc`) with an API key. Two common
bridge patterns:

1. **In-sandbox CLI** — a small `brain` CLI (`brain search "…"`, `brain capture
   "…"`, `brain delegate copy "…"`) writes calls to a file queue; a host daemon
   polls the queue and forwards each call to this app as JSON-RPC `tools/call`
   or `resources/read`.
2. **Proxy MCP server** — a standalone MCP server registers `brain_*` tools that
   proxy to this app, giving any connected MCP client the same reach.

### Provisioning a key

```bash
npm run mcp:migrate           # once, creates mcp_api_keys
npm run mcp:keygen -- user@example.com "Agent key"
```

Scope the key to what the agent actually needs using the canonical scope list
(see *Scopes & Rate Limiting* above). A wildcard (`*`) key is convenient for a
single trusted agent driving one workspace, but prefer narrower scopes for any
key that is exposed more broadly.

### Ambient usage pattern

An integrated agent is expected to call Brain Portal ambiently while executing
any user task:

- **Before answering anything about the user's work** → `brain_search` first
  (via `semantic_search`), to ground in what the user has already captured.
- **When the user says something worth keeping** → `brain_capture` so the
  thought is persisted durably, not just parroted back in chat.
- **For multi-step specialist work** → `brain_delegate` to a background agent
  (legal, finance, hr, product, sales, marketing, etc.) so the output is
  reviewable in the web UI and the original source is preserved. Omitting the
  agent type, or passing `"auto"`, runs the generalist.
- **Session start** → `brain_dashboard` + `brain_daily` to page in what the user
  is currently working on.

Tool catalog is self-documenting at `GET /api/mcp/docs` (JSON / OpenAPI
/ markdown formats).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
