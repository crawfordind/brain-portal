# Jack as the only delegated-task runtime

**Status:** implemented behind `JACK_ENABLED` (default off). Not deployed.

## Why

Every delegated task (`agent_tasks`) was executed by `executeAgentTask()`,
which called OpenRouter three times per run: an embedding lookup for context,
the completion itself, and a second "fast" completion for the TL;DR. Jack, an
existing Hermes Agent profile with tools, memory, skills, MCP access to Brain
Portal and its own approval controls, can do the same work on Daniel's own
OpenAI routing. Brain Portal stays the system of record; Jack only executes.

## What was found (every OpenRouter task-execution path)

| Path | What it did |
|------|-------------|
| `src/lib/agents/executor.ts` `executeAgentTask` | `completeWithMeta` (agent slot) + `complete` (fast slot, summary) + `maybeEvolve` |
| `src/lib/agents/context.ts` `buildTaskContext` | `findSimilarToText` → OpenRouter embedding per run |
| `POST /api/agent-tasks` | fire-and-forget `executeAgentTask` |
| `POST /api/agent-tasks/[id]/revise` | fire-and-forget `executeAgentTask` |
| `/api/cron/process-agent-queue` | executed every `queued` row, reset stuck `processing`, re-queued `failed` with retry budget, recovered `revision_requested` |
| `POST /api/system-health` `retry_agent_tasks` | fire-and-forget `executeAgentTask` |
| Skills `delegate_to_agent`, `auto_triage_captures` | fire-and-forget `executeAgentTask` |
| MCP `delegate_to_agent` (stdio + HTTP), heartbeat `delegate_to_agent` | insert `queued` rows the cron then executed |
| `scripts/test-agent-task.ts` | manual executor run |
| Settings → AI Models "AI agents" slot | model picker for the above |

All of them now reach Jack or nothing. `executeAgentTask` and its OpenRouter
completion code are deleted, not bypassed.

## Transport

**Hermes API server Runs API**, server to server, from Vercel route handlers
only. Verified against the Hermes source (`gateway/platforms/api_server.py`,
`api_server_runs.py`) and docs (`user-guide/features/api-server.md`):

| Call | Use |
|------|-----|
| `POST /v1/runs` + `Idempotency-Key` | submit; identical retry returns the original `run_id` (24h, survives restart) |
| `GET /v1/runs/{id}` | poll: `queued`/`running`/`waiting_for_approval`/`stopping`/`completed`/`failed`/`cancelled`/`interrupted`, with `output`, `usage`, `runtime`, `approval` |
| `POST /v1/runs/{id}/approval` | `{choice: "once"|"deny", request_id}` |
| `POST /v1/runs/{id}/stop` | cooperative stop, settles `cancelled` |
| `GET /v1/capabilities` | connection test and profile check |

Not used: `/v1/chat/completions` and `/v1/responses` (OpenAI-compatible
surface), the OpenAI-compatible subscription proxy (raw inference, no tools),
and SSE. A Vercel function cannot hold an SSE stream for a long agent turn;
`GET /v1/runs/{id}` is documented for exactly "UIs that reconnect after
navigation", and it carries the pending approval.

**Reachability.** Hermes binds `127.0.0.1:8642` by default. Vercel cannot
reach that. Brain Portal therefore requires an operator-provided HTTPS URL
(`JACK_HERMES_URL`) in front of Jack's API server. Recommended: a Cloudflare
Tunnel to `127.0.0.1:8642` protected by a Cloudflare Access service token
(`JACK_EDGE_CLIENT_ID` / `JACK_EDGE_CLIENT_SECRET`), so two independent
credentials guard a terminal-capable endpoint. Tailscale Funnel or an
allowlisted reverse proxy also work. **This endpoint does not exist yet; it is
Daniel's prerequisite.** Until it does, the feature flag stays off and the UI
says "Jack connection not configured".

**Auth and profile binding.** `Authorization: Bearer $JACK_HERMES_API_KEY`
(Jack's own `API_SERVER_KEY`). With Hermes multi-profile routing the URL is
`…/p/jack` and Hermes binds the key to that profile (other profiles' keys are
rejected since July 2026). The profile is server configuration; the browser
never names one. The connection test compares `/v1/capabilities`'s `model`
(Hermes advertises the profile name) with `JACK_PROFILE`.

**Hardening.** HTTPS required in production; `redirect: "error"` so the bearer
token can never follow a redirect to another host; 15s request timeout (4s
for UI-triggered polls); response bodies capped; errors reduced to a fixed
vocabulary before they reach a user or a log. No task content is logged.

## Lifecycle

`agent_tasks.status` has a CHECK constraint (`queued`, `processing`,
`awaiting_review`, `revision_requested`, `approved`, `rejected`, `failed`).
Widening it means rebuilding a table that two others reference with
`ON DELETE CASCADE`, which is exactly how the chat migration once lost data.
So the precise state lives in a new nullable column, `jack_state`, and
`status` keeps its meaning as the coarse projection every existing reader
(badges, counts, task sync, digest) already understands.

| `jack_state` | Meaning | `status` |
|--------------|---------|----------|
| `needs_dispatch` | accepted, deliberately not sent (Jack off, or migrated legacy work) | `queued` / `revision_requested` |
| `needs_review` | could not be mapped safely; explanation in `last_error` | `failed` (or `awaiting_review` if it has output) |
| `queued` | accepted, not yet handed to Jack | `queued` / `revision_requested` |
| `dispatching` | submit in flight or being retried with the same key | `processing` |
| `running` | Jack is working | `processing` |
| `awaiting_approval` | Jack paused on a gated tool call | `processing` |
| `awaiting_input` | reserved; Hermes Runs surface only approvals today | `processing` |
| `cancelling` | stop requested, Jack has not settled | `processing` |
| `awaiting_review` | output stored as a new version | `awaiting_review` |
| `completed` | Daniel approved | `approved` |
| `rejected` | Daniel rejected | `rejected` |
| `failed` | safe, actionable reason in `last_error` | `failed` (or `awaiting_review` if an earlier version exists) |
| `cancelled` | stopped deliberately | `rejected` (or `awaiting_review` if an earlier version exists) |

`runtime` (`NULL` = historical OpenRouter row, `jack`) tells the UI which
vocabulary applies. Historical rows are never rewritten except as below.

## Integrity

- **Atomic claim.** `queued → dispatching` is a conditional `UPDATE`;
  `rowsAffected = 0` means another worker owns it.
- **Idempotent submit.** The exact request body and a random
  `Idempotency-Key` are written to `agent_task_runs` *before* the POST. Any
  retry replays those bytes, so a timeout after Hermes accepted the run
  returns the same `run_id` instead of starting a second, possibly
  side-effecting run. Retries are bounded (6) with backoff; only outcomes where
  Hermes certainly did not start work (429, 5xx before accept, unreachable)
  are retried automatically.
- **No automatic retry after a run started.** A run that ends `failed` or
  `interrupted` may have done things. It is marked failed with the reason and
  waits for Daniel's explicit Retry.
- **Exactly-once output.** Completion is one `db.batch` (a transaction):
  claim the run row, insert the output version only if the run has none,
  record it, advance the task. Two pollers racing produce one version.
- **Unreachable is not failure.** A poll that cannot reach Jack leaves the
  state alone and records "Jack unreachable since …". A run Hermes no longer
  knows about (404 past its retention) becomes `failed` with
  `lost` on the run, never a fabricated output.
- **One Hermes session per task** (`brain-portal-task-<id>`), so a revision
  is the next turn of the same conversation, with Jack's own tool history.
  The revision input still carries the previous version, bounded, so a
  revision of a migrated legacy task works too.

## Context

Narrow and labelled, built from rows the user owns:

- the source record (task, note, capture, reminder, insight, project or
  contact) and its id, so Jack can re-read it live over its MCP connection;
- notes the user explicitly pinned (≤5, each capped), their annotations;
- the project's name and description; the given URLs (≤10);
- the user's compiled guardrails;
- for a revision: the previous version (capped) and the feedback.

Dropped compared to the old executor: embedding auto-retrieval (an OpenRouter
call), the user's other active tasks, recent completions and recent captures
(unrelated data). Everything inside `<brain_portal_context>` is escaped with
the existing structural-tag defence and declared to Jack as data, not
instructions. Total input is capped at 60k characters.

## Confirmation boundary

Two layers:

1. **Enforced by Hermes (prerequisite, Daniel's config).** Jack's Brain Portal
   MCP server is configured `trust: untrusted`, so every write-capable tool
   call parks the run in `waiting_for_approval`. Brain Portal shows the
   redacted request and offers **Approve once** or **Deny** only. `session` and
   `always` are never offered from Brain Portal; widening Jack's permissions is
   done in Hermes, deliberately.
2. **Instructed per task.** The envelope tells Jack to propose record changes
   as a "Proposed changes" list instead of writing them, and never to send,
   post, publish, buy, trade, change credentials or delete as part of a
   delegated task.

Every decision is written to `agent_task_events` (who, what, which run).
Writes Jack does make through MCP are already attributed by provenance
(`source_actor = mcp_key`, the key's label).

## Removing OpenRouter from task execution

- The cron route now only reconciles Jack work. It cannot reach OpenRouter.
- Rows inserted by MCP, heartbeat or skills arrive as `status='queued'` with
  `runtime IS NULL`; the cron adopts them (`runtime='jack'`), and they go to
  Jack or wait in `needs_dispatch`. They are never executed any other way.
- Migration (first application only): legacy `queued` and
  `revision_requested` rows → `needs_dispatch` (Daniel sends them explicitly;
  stale work is not auto-started). Legacy `processing` rows → `needs_review`,
  since an OpenRouter call may have been mid-flight. Rows whose source record
  no longer exists → `needs_review`. Everything else is untouched history.
  Parked rows get a coarse status the *outgoing* deployment's cron never
  selects (`failed` with the retry budget spent, or `awaiting_review`), because
  the migration runs in `prebuild` while the previous build is still live.
- The "AI agents" model slot is hidden from Settings; nothing reads it.
- Chat, summaries, embeddings, insights and every other OpenRouter feature are
  unchanged.

## Feature flag

`JACK_ENABLED=true` plus a valid `JACK_HERMES_URL` and `JACK_HERMES_API_KEY`.
Anything less: new delegations are stored as `needs_dispatch` with "Jack
connection not configured", nothing is sent anywhere, and System Health shows
it. There is no fallback.

## Rollback

Set `JACK_ENABLED=false`: Brain Portal stops every call to Jack. New work is
stored as `needs_dispatch`; running tasks keep the state last seen and are not
polled until Jack is enabled again. Reverting the code is safe for data: the
new columns and tables are additive and the old code ignores them. Rows the
migration parked read `failed` (retry budget spent) or `awaiting_review`, which
the old cron never touches. Tasks created while Jack was off read `queued`, and
the old cron would run those on OpenRouter, so reject them first if that is not
wanted. Full steps: `docs/operations/jack-runtime.md`.

## Where record changes are gated

Hermes `trust: untrusted` asks before every MCP tool *not* annotated
`readOnlyHint: true`. Brain Portal's MCP tools carried no annotations, so every
read would have paused Jack too. `registerAllTools` now marks read-only tools
from the catalog (`isReadOnlyTool`: `*:read`, `ai:search`, and the two agent
task lookups), checked over a real MCP client in
`tests/mcp/read-only-hints.test.ts`. The hint never grants access; scopes do.
