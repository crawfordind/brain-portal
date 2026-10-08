# Running delegated tasks on Jack

Brain Portal sends every delegated task to **Jack**, a Hermes Agent profile,
through the Hermes API server's **Runs API**. It never runs a delegated task on
OpenRouter and never falls back to it. Design and reasoning:
`docs/plans/2026-10-08-jack-task-runtime-design.md`.

The integration ships **off** (`JACK_ENABLED` unset). While it is off, new
delegated work is stored as **Not sent**, nothing is sent anywhere, and Review
and System Health say so.

## What you need first

1. **Hermes with the Runs API.** `GET /v1/capabilities` must report
   `run_submission`, `run_status` and `run_stop` as `true` (and `run_approval`
   for approvals). Run `hermes update` if not.
2. **A private HTTPS address for Jack's API server that Vercel can reach.**
   Hermes listens on `127.0.0.1:8642`; a Vercel function cannot reach your
   machine's loopback. Pick one:
   - **Cloudflare Tunnel + Cloudflare Access (recommended).** Two independent
     credentials in front of a terminal-capable endpoint: the Access service
     token at the edge, Jack's own API key at Hermes.
   - Tailscale Funnel, or a reverse proxy with an IP allowlist. Only Jack's API
     key protects these, so keep it long and rotate it.
3. **The Brain Portal MCP server configured in Jack with `trust: untrusted`**
   (below). This is what makes Jack ask before changing your records.

## 1. Enable Jack's API server (on the machine running Jack)

In Jack's profile environment, `~/.hermes/profiles/jack/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<output of: openssl rand -hex 32>
# Leave API_SERVER_HOST at its default 127.0.0.1; the tunnel connects locally.
# Do NOT set API_SERVER_CORS_ORIGINS: no browser ever calls Jack directly.
```

Start (or restart) the gateway and check it locally:

```bash
hermes -p jack gateway
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/capabilities
```

The `model` field is the profile name (`jack`), which the connection test
checks. If you run several profiles on one listener (multi-profile routing),
Jack is served at `/p/jack/...` and only Jack's own key is accepted there.

## 2. Make Jack ask before writing to Brain Portal

In Jack's `config.yaml`, on the Brain Portal MCP server entry, add
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
Hermes's `session` or `always`; widen Jack's standing permissions in Hermes, on
purpose, if you ever want to.

Optionally, scope Jack's Brain Portal MCP key narrowly (Settings → AI API
access) so a write cannot happen even if approved by mistake.

## 3. Put Jack behind a private HTTPS address

Cloudflare example:

```bash
cloudflared tunnel create jack
# ~/.cloudflared/config.yml
#   tunnel: <tunnel-id>
#   credentials-file: ~/.cloudflared/<tunnel-id>.json
#   ingress:
#     - hostname: jack.<your-domain>
#       service: http://127.0.0.1:8642
#     - service: http_status:404
cloudflared tunnel route dns jack jack.<your-domain>
cloudflared tunnel run jack
```

Then in Cloudflare Zero Trust: **Access → Applications → Add** a self-hosted
application for `jack.<your-domain>` with a **Service Auth** policy, and create
a **Service Token**. Its client id and secret become `JACK_EDGE_CLIENT_ID` and
`JACK_EDGE_CLIENT_SECRET`. Check from another machine that an unauthenticated
request is refused at the edge:

```bash
curl -i https://jack.<your-domain>/v1/capabilities          # expect 403 from Access
```

## 4. Configure Brain Portal (Vercel → Settings → Environment Variables)

Server-side only. Never prefix any of these with `NEXT_PUBLIC_`.

| Variable | Value |
|----------|-------|
| `JACK_HERMES_URL` | `https://jack.<your-domain>` (add `/p/jack` with multi-profile routing) |
| `JACK_HERMES_API_KEY` | Jack's `API_SERVER_KEY` |
| `JACK_PROFILE` | `jack` (default) |
| `JACK_EDGE_CLIENT_ID` | Access service token client id (optional, both or neither) |
| `JACK_EDGE_CLIENT_SECRET` | Access service token secret (optional) |
| `JACK_ENABLED` | leave unset until step 6 |

`CRON_SECRET` must already be set: `/api/cron/process-agent-queue` (every
minute) is what hands queued work to Jack and checks on running work.

## 5. Migrate

`npm run db:migrate` runs on every build (`prebuild`), so a normal deploy
applies it. To run it on its own and read the report:

```bash
npm run migrate:jack-runtime
```

It is additive (three nullable columns on `agent_tasks`, two new tables) and
idempotent. On its first run only, work the OpenRouter runtime left pending is
parked: `queued`/`revision_requested` → **Not sent**, `processing` and rows
whose source record is gone → **Needs your review**, each with an explanation.
Nothing is sent to Jack. History (approved, rejected, failed, awaiting review)
is untouched.

## 6. Enable and run a live test

1. Set `JACK_ENABLED=true` and redeploy.
2. **Review → Test Jack connection.** Expect "Jack is connected (profile
   "jack")". The same check: `GET /api/jack/status?check=true` while signed in.
3. On a throwaway note, **⋯ → Send to Jack**: "Summarize this note in three
   bullets." Watch it go *Sending to Jack → Jack is working → Ready for
   review*. Reply to it once and confirm version 2 arrives.
4. Approval path: send "Create a note titled 'Jack test' with today's date."
   The task should stop at **Waiting for your approval** showing the request.
   **Deny** it, and confirm in Brain Portal that no note was created.
5. Cancel path: send something long, press **Stop**, confirm it reads
   *Stopping* and then *Cancelled*.
6. Parked work from the migration: open **Review → Needs you** and send or
   reject each item.

## Rotating or revoking the key

1. Generate a new key and set it as `API_SERVER_KEY` in Jack's profile `.env`;
   restart the gateway. From this moment Brain Portal's polls get 401 and tasks
   show "Jack rejected Brain Portal's credentials". Nothing is lost or marked
   failed; running tasks keep their state.
2. Set the new value as `JACK_HERMES_API_KEY` in Vercel and redeploy. Polling
   resumes and tasks catch up.

To revoke immediately without rotating: delete the Access service token, or
stop the tunnel. To rotate the edge token, create a new one in Access, update
`JACK_EDGE_CLIENT_ID`/`JACK_EDGE_CLIENT_SECRET`, redeploy, then delete the old
token.

## Disabling

Set `JACK_ENABLED=false` (or remove it) and redeploy. Brain Portal stops all
calls to Jack: new work is stored as **Not sent**; tasks already running are
shown as they were last seen and are not polled. Jack may still finish them on
its side; re-enabling picks their results up (Hermes keeps finished run status
for a limited time; after that the task says Jack no longer has a record and
points at the Hermes session `brain-portal-task-<id>`). Stop running tasks
first if you want a clean cut.

## Rolling back the code

The schema change is additive and the old code ignores it, so reverting the PR
is safe for data. Know what the old code would do with what the new code wrote:

- Rows parked by the migration read `failed` with their retry budget spent, or
  `awaiting_review`; the old cron leaves both alone.
- Tasks created while Jack was off, or adopted from MCP, read `queued`; the old
  cron would run those through OpenRouter. Reject or delete them first if that
  is not wanted.
- Outputs Jack produced stay readable (`model_used = jack:<provider>/<model>`).

## Troubleshooting

| What you see | Meaning | Fix |
|--------------|---------|-----|
| "Jack connection not configured" | `JACK_ENABLED` is not `true` | Finish steps 1 to 4, then 6 |
| "JACK_HERMES_URL must use https" | Misconfigured, nothing is sent | Use the tunnel's https address |
| "Jack rejected Brain Portal's credentials" | 401/403 from Hermes or Access | Keys out of step; see rotation |
| "Jack unreachable since …" | Gateway, tunnel or machine down | `hermes -p jack gateway`; `cloudflared tunnel run jack` |
| "Jack is at its concurrent-run limit" | Hermes `max_concurrent_runs` reached | Retried automatically |
| Connection test: wrong profile | URL points at another profile | Fix `JACK_HERMES_URL` or `JACK_PROFILE` |
| Every read pauses for approval | Read tools lack `readOnlyHint` (older Brain Portal) | Deploy this version |
| Writes happen without approval | Brain Portal MCP entry is not `trust: untrusted` | Step 2 |

## Environment variable names (no values)

`JACK_ENABLED`, `JACK_HERMES_URL`, `JACK_HERMES_API_KEY`, `JACK_PROFILE`,
`JACK_EDGE_CLIENT_ID`, `JACK_EDGE_CLIENT_SECRET`, plus the existing
`CRON_SECRET`. On Jack's side: `API_SERVER_ENABLED`, `API_SERVER_KEY`, and the
Brain Portal MCP key Jack already uses.
