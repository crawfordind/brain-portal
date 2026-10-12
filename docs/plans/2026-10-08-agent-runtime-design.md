# Pluggable runtime for delegated tasks

**Status:** implemented. `AGENT_RUNTIME` defaults to `openrouter`, so an
existing install behaves as before. Not deployed.

## Why

Every delegated task (`agent_tasks`) was executed by `executeAgentTask()`,
which called OpenRouter three times per run: an embedding lookup for context,
the completion itself, and a second "fast" completion for the TL;DR. That is
the right default for a self-hosted install with nothing but an OpenRouter key.

Some operators already run an agent host, such as a Hermes Agent profile, with
its own tools, memory, skills, MCP access to Brain Portal and approval
controls. For them a delegated task should be *work that agent does*, not a
single model call. Brain Portal stays the system of record either way; the
runtime only executes.

So delegation is a layer with two adapters and one lifecycle, chosen by the
operator:

| `AGENT_RUNTIME` | Adapter | Executes as |
|-----------------|---------|-------------|
| `openrouter` (default) | `runtime/openrouter.ts` | one model call, no tools |
| `hermes` | `runtime/hermes-client.ts` | a Hermes run with the profile's tools, memory and approvals |
| `off` | none | nothing; work is kept as "Not sent" |

**There is no fallback between runtimes.** Silent fallback would mean an
operator who chose Hermes so that delegated work stays on their own
infrastructure could find it sent to OpenRouter, and billed there, whenever
their agent was briefly unreachable. Unreachable is a state to report, not a
reason to switch providers.

This is an open-source project shared by many self-hosters, so nothing here
names a particular person or agent. The UI calls the agent by
`AGENT_DISPLAY_NAME` (default "Agent"), and prompts address "the user".

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

All of them now go through the dispatcher, which hands work to the configured
adapter or to nothing. The executor and its context builder are replaced by
the OpenRouter adapter (same persona, model chain, token budget and
empty-answer handling) and the shared envelope. The extra embedding and TL;DR
calls are gone: the envelope carries explicitly pinned context, and the
summary is taken from the answer's first heading or sentence.

## The OpenRouter adapter

A single `completeWithMeta` call with the `agent` slot's model chain. When an
active `agent_configs` row exists for the task's agent type, its system prompt
leads the instructions and its `model_id` heads the chain. An empty answer
with `finish_reason: length` is retried once with a doubled budget, then
fails; a blank version is never stored.

Because the call is synchronous, route handlers defer it with Next's `after()`
so a request never waits on a model. A model call has no side effects, so a
failure is retried automatically (5-minute backoff, within `max_retries`), and
a run with no answer after 10 minutes is treated as having died with its
worker and re-queued. Approvals, stop and live status do not exist on this
runtime, and the UI does not offer them.

## The Hermes adapter

### Transport

**Hermes API server Runs API**, server to server, from route handlers only.
Verified against the Hermes source (`gateway/platforms/api_server.py`,
`api_server_runs.py`) and docs (`user-guide/features/api-server.md`):

| Call | Use |
|------|-----|
| `POST /v1/runs` + `Idempotency-Key` | submit; identical retry returns the original `run_id` (24h, survives restart) |
| `GET /v1/runs/{id}` | poll: `queued`/`running`/`waiting_for_approval`/`stopping`/`completed`/`failed`/`cancelled`/`interrupted`, with `output`, `usage`, `runtime`, `approval` |
| `POST /v1/runs/{id}/approval` | `{choice: "once"|"deny", request_id}` |
| `POST /v1/runs/{id}/stop` | cooperative stop, settles `cancelled` |
| `GET /v1/capabilities` | connection test and optional profile check |

Not used: `/v1/chat/completions` and `/v1/responses` (OpenAI-compatible
surface), the subscription proxy (raw inference, no tools), and SSE. A
serverless function cannot hold an SSE stream for a long agent turn;
`GET /v1/runs/{id}` is documented for exactly "UIs that reconnect after
navigation", and it carries the pending approval.

**Reachability.** Hermes binds `127.0.0.1:8642` by default, which a hosted
deployment cannot reach. The operator provides an HTTPS URL (`HERMES_URL`) in
front of the API server. Recommended: a Cloudflare Tunnel protected by a
Cloudflare Access service token (`HERMES_EDGE_CLIENT_ID` /
`HERMES_EDGE_CLIENT_SECRET`), so two independent credentials guard a
terminal-capable endpoint. Tailscale Funnel or an allowlisted reverse proxy
also work.

**Auth and profile binding.** `Authorization: Bearer $HERMES_API_KEY` (the
profile's own `API_SERVER_KEY`). With Hermes multi-profile routing the URL is
`…/p/<profile>` and Hermes binds the key to that profile. The profile is server
configuration; the browser never names one. When `HERMES_PROFILE` is set, the
connection test compares it with `/v1/capabilities`'s `model` (Hermes
advertises the profile name).

**Hardening.** HTTPS required in production (plain http only to loopback in
development); no credentials, query or fragment in the URL; `redirect:
"error"` so the bearer token can never follow a redirect to another host; 15s
request timeout (4s for UI-triggered polls); response bodies capped; errors
reduced to a fixed vocabulary before they reach a user or a log. No task
content is logged.

### Integrity

- **Idempotent submit.** The exact request body and a random
  `Idempotency-Key` are written to `agent_task_runs` *before* the POST. Any
  retry replays those bytes, so a timeout after Hermes accepted the run
  returns the same `run_id` instead of starting a second, possibly
  side-effecting run. Retries are bounded (6) with backoff; only outcomes where
  Hermes certainly did not start work (429, 5xx before accept, unreachable)
  are retried automatically.
- **No automatic retry after a run started.** A run that ends `failed` or
  `interrupted` may have done things. It is marked failed with the reason and
  waits for the user's explicit Retry.
- **Unreachable is not failure.** A poll that cannot reach Hermes leaves the
  state alone and records "Hermes agent unreachable since …". A run Hermes no
  longer knows about (404 past its retention) becomes `failed` with `lost` on
  the run, never a fabricated output.
- **One Hermes session per task** (`brain-portal-task-<id>`), so a revision
  is the next turn of the same conversation, with the agent's own tool
  history. The revision input still carries the previous version, bounded, so
  a revision of a task from before the lifecycle works too.

## Lifecycle (both runtimes)

`agent_tasks.status` has a CHECK constraint (`queued`, `processing`,
`awaiting_review`, `revision_requested`, `approved`, `rejected`, `failed`).
Widening it means rebuilding a table that two others reference with
`ON DELETE CASCADE`, which is exactly how the chat migration once lost data.
So the precise state lives in a new nullable column, `runtime_state`, and
`status` keeps its meaning as the coarse projection every existing reader
(badges, counts, task sync, digest) already understands.

| `runtime_state` | Meaning | `status` |
|-----------------|---------|----------|
| `needs_dispatch` | accepted, deliberately not sent (delegation off, or parked legacy work) | `queued` / `revision_requested` |
| `needs_review` | could not be mapped safely; explanation in `last_error` | `failed` (or `awaiting_review` if it has output) |
| `queued` | accepted, not yet handed to the runtime | `queued` / `revision_requested` |
| `dispatching` | claimed; submit in flight or being retried with the same key | `processing` |
| `running` | the runtime is working | `processing` |
| `awaiting_approval` | Hermes paused on a gated tool call | `processing` |
| `awaiting_input` | reserved; Hermes Runs surface only approvals today | `processing` |
| `cancelling` | stop requested, Hermes has not settled | `processing` |
| `awaiting_review` | output stored as a new version | `awaiting_review` |
| `completed` | the user approved | `approved` |
| `rejected` | the user rejected | `rejected` |
| `failed` | safe, actionable reason in `last_error` | `failed` (or `awaiting_review` if an earlier version exists) |
| `cancelled` | stopped deliberately | `rejected` (or `awaiting_review` if an earlier version exists) |

`runtime` is stamped at claim time with what actually ran the work (`NULL`
before that). A `NULL` `runtime_state` is a row from before the lifecycle,
shown as read-only history.

Shared integrity:

- **Atomic claim.** `queued → dispatching` is a conditional `UPDATE`;
  `rowsAffected = 0` means another worker owns it.
- **Exactly-once output.** Completion is one `db.batch` (a transaction):
  claim the run row, insert the output version only if the run has none,
  record it, advance the task. Two pollers racing produce one version.
- **Adoption.** Rows inserted by MCP, heartbeat or skills arrive as
  `status='queued'` with `runtime_state IS NULL`; the cron adopts them into
  the lifecycle. They are never executed any other way.

## Context

Narrow and labelled, built from rows the user owns, the same for both runtimes:

- the source record (task, note, capture, reminder, insight, project or
  contact) and its id, so a Hermes agent can re-read it live over MCP;
- a per-source `Approach:` line (a note gets feedback, a task gets done);
- notes the user explicitly pinned (≤5, each capped), their annotations;
- the project's name and description; the given URLs (≤10);
- the user's compiled guardrails;
- for a revision: the previous version (capped) and the feedback.

Dropped compared to the old executor: embedding auto-retrieval (an extra
OpenRouter call), the user's other active tasks, recent completions and recent
captures (unrelated data). Everything inside `<brain_portal_context>` is
escaped with the existing structural-tag defence and declared to the model as
data, not instructions. Total input is capped at 60k characters.

## Confirmation boundary

- **OpenRouter:** the model has no tools, so it cannot change anything. The
  rules tell it so, and to list any implied record changes as "Proposed
  changes" for the user to apply.
- **Hermes, enforced by the host.** The profile's Brain Portal MCP server is
  configured `trust: untrusted`, so every write-capable tool call parks the run
  in `waiting_for_approval`. Brain Portal shows the redacted request and offers
  **Approve once** or **Deny** only. `session` and `always` are never offered
  from Brain Portal; widening the agent's permissions is done in Hermes,
  deliberately.
- **Hermes, instructed per task.** The rules tell the agent to propose record
  changes instead of writing them unless the call goes through approval, and
  never to send, post, publish, buy, trade, change credentials or delete as
  part of a delegated task.

Every decision is written to `agent_task_events` (who, what, which run).
Writes a Hermes agent makes through MCP are already attributed by provenance
(`source_actor = mcp_key`, the key's label).

### Where record changes are gated

Hermes `trust: untrusted` asks before every MCP tool *not* annotated
`readOnlyHint: true`. Brain Portal's MCP tools carried no annotations, so every
read would have paused the agent too. `registerAllTools` now marks read-only
tools from the catalog (`isReadOnlyTool`: `*:read`, `ai:search`, and the two
agent task lookups), checked over a real MCP client in
`tests/mcp/read-only-hints.test.ts`. The hint never grants access; scopes do.

## Migration

Additive: three columns on `agent_tasks`, two new tables. On its first
application only, pending work from before the lifecycle is handled by
runtime, read from the build's `AGENT_RUNTIME`:

- **`openrouter`:** keeps running as it did before the upgrade. `queued` rows
  are adopted by the next queue pass; pending revisions are queued.
- **`hermes` or `off`:** `queued` and `revision_requested` rows →
  `needs_dispatch`, so stale work never starts on a new runtime by itself. The
  user sends them explicitly.
- **Any runtime:** `processing` rows → `needs_review` (a call may have been
  mid-flight), and rows whose source record no longer exists → `needs_review`.

Parked rows get a coarse status the *outgoing* deployment's cron never selects
(`failed` with the retry budget spent, or `awaiting_review`), because the
migration runs in `prebuild` while the previous build is still live.
Everything else is untouched history.

A database that ran the early draft of this feature, which used
runtime-specific column names, is renamed onto the generic schema in place.

## Model settings

The "AI agents" slot picks the model for delegated tasks only on the
OpenRouter runtime, so Settings shows it only there. On Hermes the agent
brings its own model. Chat, summaries, embeddings, insights and every other
OpenRouter feature are unchanged on every runtime.

## Rollback

- **To stop delegated work:** `AGENT_RUNTIME=off`. Nothing is sent or polled;
  new work is stored as `needs_dispatch`, running tasks keep the state last
  seen.
- **Hermes back to OpenRouter:** `AGENT_RUNTIME=openrouter`. Hermes runs in
  flight are no longer polled (their last state stays visible); the user can
  send parked or failed tasks again, and they then run on OpenRouter. This is
  an explicit operator choice, not a fallback.
- **Reverting the code** is safe for data: the new columns and tables are
  additive and the old code ignores them. Rows the migration parked read
  `failed` (retry budget spent) or `awaiting_review`, which the old cron never
  touches.

Full steps: `docs/operations/agent-runtime.md`.
