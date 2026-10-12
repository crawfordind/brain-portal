# Choosing and running the delegated-task runtime

Delegated tasks ("Send to …", heartbeat and skill delegation, the
`delegate_to_agent` MCP tool) run on the runtime the server's `AGENT_RUNTIME`
names. Design and reasoning: `docs/plans/2026-10-08-agent-runtime-design.md`.

| `AGENT_RUNTIME` | What runs the task | You need |
|-----------------|--------------------|----------|
| `openrouter` (**default**) | one model call through OpenRouter, no tools | `OPENROUTER_API_KEY`, which the rest of the app already uses |
| `hermes` | a Hermes Agent profile through its Runs API, with its own tools, memory and approvals | a reachable Hermes API server (below) |
| `off` | nothing; tasks are kept as **Not sent** | nothing |

**There is no fallback between runtimes.** On `hermes`, delegated work is
never sent to OpenRouter, however long Hermes is unreachable; on `openrouter`,
no Hermes endpoint is ever called. If the chosen runtime is misconfigured, new
work is stored as **Not sent** with the reason, and Review and System Health
say so.

`AGENT_DISPLAY_NAME` sets what the UI calls the agent ("Send to <name>",
notifications, the review panel). It defaults to "Agent".

All of these are **server-side only**. Never prefix them with `NEXT_PUBLIC_`.

## OpenRouter (the default)

Nothing to do beyond `OPENROUTER_API_KEY`. Each task is one model call using
the **AI agents** model in Settings → AI Models (shown only on this runtime).
If an `agent_configs` row exists for the task's agent type, its persona and
pinned model are used. Failed calls are retried automatically within the
task's retry budget. There are no approvals and no Stop: the model has no
tools, so it can only propose changes for you to apply.

`CRON_SECRET` must be set: `/api/cron/process-agent-queue` (every minute)
picks up delegations from MCP, heartbeat and skills and retries failures.

## Hermes

### What you need first

1. **Hermes with the Runs API.** `GET /v1/capabilities` must report
   `run_submission`, `run_status` and `run_stop` as `true` (and `run_approval`
   for approvals). Run `hermes update` if not.
2. **A private HTTPS address for the profile's API server that your Brain
   Portal deployment can reach.** Hermes listens on `127.0.0.1:8642`; a hosted
   function cannot reach your machine's loopback. Pick one:
   - **Cloudflare Tunnel + Cloudflare Access (recommended).** Two independent
     credentials in front of a terminal-capable endpoint: the Access service
     token at the edge, the profile's API key at Hermes.
   - Tailscale Funnel, or a reverse proxy with an IP allowlist. Only the API
     key protects these, so keep it long and rotate it.
3. **The Brain Portal MCP server configured in the profile with
   `trust: untrusted`** (step 2). This is what makes the agent ask before
   changing your records.

The examples below use `<profile>` for your Hermes profile name and
`<your-domain>` for a domain you control.

### 1. Enable the profile's API server (on the machine running Hermes)

In the profile's environment, `~/.hermes/profiles/<profile>/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<output of: openssl rand -hex 32>
# Leave API_SERVER_HOST at its default 127.0.0.1; the tunnel connects locally.
# Do NOT set API_SERVER_CORS_ORIGINS: no browser ever calls Hermes directly.
```

Start (or restart) the gateway and check it locally:

```bash
hermes -p <profile> gateway
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/capabilities
```

The `model` field is the profile name, which the connection test can check
(`HERMES_PROFILE`). With several profiles on one listener (multi-profile
routing), the profile is served at `/p/<profile>/...` and only its own key is
accepted there.

### 2. Make the agent ask before writing to Brain Portal

In the profile's `config.yaml`, on the Brain Portal MCP server entry, add
`trust: untrusted`:

```yaml
mcp_servers:
  brain-portal:
    url: "https://<your-app>/api/mcp/rpc"
    headers:
      Authorization: "Bearer ${BRAIN_PORTAL_MCP_KEY}"
    trust: untrusted
```

With `untrusted`, Hermes asks for approval before every tool that is not
annotated `readOnlyHint: true`. Brain Portal marks its read-only tools that way
(search, get/list tools, `semantic_search`, `get_contact_brief`, …), so reads
flow freely and every create/update/delete/merge pauses the run. Brain Portal
shows the request in Review with **Approve once** and **Deny**. It never offers
Hermes's `session` or `always`; widen the agent's standing permissions in
Hermes, on purpose, if you ever want to.

Optionally, scope the profile's Brain Portal MCP key narrowly (Settings → AI
API access) so a write cannot happen even if approved by mistake.

### 3. Put the API server behind a private HTTPS address

Cloudflare example:

```bash
cloudflared tunnel create <tunnel-name>
# ~/.cloudflared/config.yml
#   tunnel: <tunnel-id>
#   credentials-file: ~/.cloudflared/<tunnel-id>.json
#   ingress:
#     - hostname: agent.<your-domain>
#       service: http://127.0.0.1:8642
#     - service: http_status:404
cloudflared tunnel route dns <tunnel-name> agent.<your-domain>
cloudflared tunnel run <tunnel-name>
```

Then in Cloudflare Zero Trust: **Access → Applications → Add** a self-hosted
application for `agent.<your-domain>` with a **Service Auth** policy, and
create a **Service Token**. Its client id and secret become
`HERMES_EDGE_CLIENT_ID` and `HERMES_EDGE_CLIENT_SECRET`. Check from another
machine that an unauthenticated request is refused at the edge:

```bash
curl -i https://agent.<your-domain>/v1/capabilities          # expect 403 from Access
```

### 4. Configure Brain Portal (your host's environment variables)

| Variable | Value |
|----------|-------|
| `HERMES_URL` | `https://agent.<your-domain>` (add `/p/<profile>` with multi-profile routing) |
| `HERMES_API_KEY` | the profile's `API_SERVER_KEY` (≥ 16 characters) |
| `HERMES_PROFILE` | optional: the profile name the connection test should find |
| `HERMES_EDGE_CLIENT_ID` | Access service token client id (optional, both or neither) |
| `HERMES_EDGE_CLIENT_SECRET` | Access service token secret (optional) |
| `AGENT_DISPLAY_NAME` | optional: what the UI calls the agent |
| `AGENT_RUNTIME` | leave at its current value until step 6 |

`CRON_SECRET` must already be set: `/api/cron/process-agent-queue` (every
minute) is what hands queued work to Hermes and checks on running work.

### 5. Migrate

`npm run db:migrate` runs on every build (`prebuild`) with the build's
`AGENT_RUNTIME`, so a normal deploy applies it. To run it on its own and read
the report:

```bash
AGENT_RUNTIME=hermes npm run migrate:agent-runtime
```

It is additive (three nullable columns on `agent_tasks`, two new tables) and
idempotent. On its first run only, work left pending from before is handled by
runtime: on `openrouter` it keeps running as before; on `hermes` or `off`,
`queued`/`revision_requested` → **Not sent** so stale work never starts on a
new runtime by itself. On any runtime, `processing` rows and rows whose source
record is gone → **Needs your review**, each with an explanation. History
(approved, rejected, failed, awaiting review) is untouched.

### 6. Switch over and run a live test

1. Set `AGENT_RUNTIME=hermes` and redeploy.
2. **Review → Test <name> connection.** Expect "<name> is connected". The same
   check: `GET /api/agent-runtime/status?check=true` while signed in.
3. On a throwaway note, **⋯ → Send to <name>**: "Summarize this note in three
   bullets." Watch it go *Sending → Working → Ready for review*. Reply to it
   once and confirm version 2 arrives.
4. Approval path: send "Create a note titled 'Agent test' with today's date."
   The task should stop at **Waiting for your approval** showing the request.
   **Deny** it, and confirm in Brain Portal that no note was created.
5. Cancel path: send something long, press **Stop**, confirm it reads
   *Stopping* and then *Cancelled*.
6. Parked work from the migration: open **Review → Needs you** and send or
   reject each item.

### Rotating or revoking the key

1. Generate a new key and set it as `API_SERVER_KEY` in the profile's `.env`;
   restart the gateway. From this moment Brain Portal's polls get 401 and tasks
   show "The Hermes agent rejected Brain Portal's credentials". Nothing is lost
   or marked failed; running tasks keep their state.
2. Set the new value as `HERMES_API_KEY` in Brain Portal and redeploy. Polling
   resumes and tasks catch up.

To revoke immediately without rotating: delete the Access service token, or
stop the tunnel. To rotate the edge token, create a new one in Access, update
`HERMES_EDGE_CLIENT_ID`/`HERMES_EDGE_CLIENT_SECRET`, redeploy, then delete the
old token.

## Switching runtimes, disabling, rolling back

- **Stop all delegated work:** `AGENT_RUNTIME=off`, redeploy. Nothing is sent
  or polled. New work is stored as **Not sent**; tasks already running are
  shown as last seen. A Hermes agent may still finish them on its side;
  switching back to `hermes` picks their results up while Hermes still holds
  the run (after that the task says Hermes no longer has a record and points
  at the session `brain-portal-task-<id>`). Stop running tasks first for a
  clean cut.
- **Hermes back to OpenRouter:** `AGENT_RUNTIME=openrouter`, redeploy. Hermes
  runs in flight are no longer polled. Tasks you send or retry from then on
  run on OpenRouter. This is your explicit choice, never an automatic
  fallback.
- **Rolling back the code:** the schema change is additive and the old code
  ignores it, so reverting is safe for data. Rows the migration parked read
  `failed` with their retry budget spent, or `awaiting_review`; the old cron
  leaves both alone. Rows that read `queued` would be run by the old cron on
  OpenRouter. Outputs stay readable (`model_used` is the OpenRouter model, or
  `hermes:<provider>/<model>`).

## Troubleshooting

| What you see | Meaning | Fix |
|--------------|---------|-----|
| "Delegated tasks are turned off on this server" | `AGENT_RUNTIME=off` | Choose a runtime |
| "AGENT_RUNTIME is openrouter but OPENROUTER_API_KEY is not set" | Default runtime without a key | Set the key, or choose another runtime |
| "AGENT_RUNTIME is hermes but HERMES_URL is not set" | Hermes chosen, not configured; nothing is sent | Steps 1 to 4 |
| "HERMES_URL must use https" | Misconfigured, nothing is sent | Use the tunnel's https address |
| "The Hermes agent rejected Brain Portal's credentials" | 401/403 from Hermes or Access | Keys out of step; see rotation |
| "Hermes agent unreachable since …" | Gateway, tunnel or machine down | `hermes -p <profile> gateway`; restart the tunnel |
| "The Hermes agent is at its concurrent-run limit" | Hermes `max_concurrent_runs` reached | Retried automatically |
| Connection test: wrong profile | URL points at another profile | Fix `HERMES_URL` or `HERMES_PROFILE` |
| Every read pauses for approval | Read tools lack `readOnlyHint` (older Brain Portal) | Deploy this version |
| Writes happen without approval | Brain Portal MCP entry is not `trust: untrusted` | Hermes step 2 |
| OpenRouter task fails with "402 Insufficient credits" | Account out of credit | Top up; the task retries within its budget |

## Environment variable names (no values)

`AGENT_RUNTIME`, `AGENT_DISPLAY_NAME`; for Hermes `HERMES_URL`,
`HERMES_API_KEY`, `HERMES_PROFILE`, `HERMES_EDGE_CLIENT_ID`,
`HERMES_EDGE_CLIENT_SECRET`; plus the existing `OPENROUTER_API_KEY` and
`CRON_SECRET`. On the Hermes side: `API_SERVER_ENABLED`, `API_SERVER_KEY`, and
the Brain Portal MCP key the profile uses.
