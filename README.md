# Brain Portal

A self-hosted, AI-native personal knowledge base. Notes, tasks, projects,
captures and contacts in one place, with an AI layer that reads what you have
already written instead of starting from a blank prompt.

Built with Next.js 16, Turso (SQLite), and OpenRouter. Runs on Vercel's free
tier or anywhere Node runs. **Your data lives in your database, under your
account, on your provider keys.**

[![CI](https://github.com/crawfordind/brain-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/crawfordind/brain-portal/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

---

## Why this exists

Most note apps store text. Most AI assistants forget everything when the tab
closes. Brain Portal is an attempt at the thing in between: a durable record of
what you think, that an AI can actually read.

Three things follow from that:

- **Everything is indexed.** Notes, captures and tasks get embeddings, so
  "what did I decide about pricing" finds the note where you decided it, not
  the notes containing the word "pricing".
- **AI works on your material.** Ask about a note and the model receives the
  note, its project, its highlights and the notes semantically near it. It is
  not a general chatbot that happens to live in your sidebar.
- **Background work is reviewable.** Delegated agent work lands in a review
  queue you approve, revise or reject. Nothing is silently written into your
  notes on your behalf.

---

## Features

### Writing and capture

- **Markdown editor** (TipTap) with markdown shortcuts, tables, task lists, a
  sticky mobile toolbar, and a cursor that stays centred while you type.
- **Quick capture** — `Cmd+Shift+C` from anywhere. A thought, a link, a task,
  a reference; classification happens after, not before.
- **Voice capture** via the Web Speech API, including punctuation commands.
- **Sketch & handwriting** — a OneNote-style pad (pressure-sensitive pen,
  highlighter, shapes, grid/ruled backgrounds) with AI ink-to-text. Strokes are
  stored as vectors so a sketch stays editable, and the transcription is
  indexed so it is searchable.
- **Semantic highlights** — highlight colour is an *instruction*, not
  decoration. Green means "keep as is", yellow "rework this", blue "say more",
  red "cut". Every model that later reads the note is handed the same meanings,
  so a review responds to your markup without you writing a word of prompt.
- **Web Share Target** — share a link or selection to Brain Portal from any
  Android app's share sheet. Also works from iOS Shortcuts and bookmarklets.

### Finding things

- **Command palette** (`Cmd+K`) — search, navigate, and run commands from one
  input. Quick actions show by default so the capabilities are discoverable.
- **Semantic search** over 1536-dimensional embeddings, plus SQLite FTS5
  full-text search.
- **Knowledge graph** — notes connected by AI-detected relationships.
- **Entity layer** — a canonical graph beneath the notes, so the app reasons
  about the *entity* rather than the string. A company mentioned thirteen
  different ways becomes one node with thirteen mentions and a timeline.

### Getting work done

- **Stream dashboard** — a single feed at a density you choose (compact, cozy,
  comfortable), grouped into time buckets, with a "since you were last here"
  divider. A **Needs you** band appears only when something actually needs you.
- **Tasks** with natural-language parsing ("write the post by Friday, urgent"),
  priorities, recurrence, a kanban board and a calendar.
- **Projects** with nested hierarchy, collaborators, activity logs and
  AI-generated health summaries.
- **Daily notes and weekly reviews**, the latter AI-generated from your week.

### The AI layer

- **Ask about anything** — a streaming chat pinned to a note, task, capture,
  reminder or insight. The answer arrives immediately; the follow-up is the
  next message; one button keeps the result as a note or task.
- **Background agents** — 17 specialist agent types for work you want done out
  of band. Output is versioned and lands in `/review` for approval.
- **Insights** that dedupe against what you have already been told and learn
  from your up/down votes, so the engine stops re-deriving the same idea.
- **Tiered processing** — every operation is routed by cost, from free local
  parsing through embeddings to full LLM calls, each with its own cache.
- **Model selection is configuration, not code.** Pick a model per *job*
  (fast / deep / agent / vision / embedding) in Settings, from OpenRouter's
  live catalog. A model that gets retired degrades to the next candidate
  instead of silently breaking a feature.

### CRM

A contact layer built **on** the entity graph, so contacts are populated by
notes you already wrote rather than by data entry. Channels, interactions,
ventures, products, roles, a merge review queue, and compartments for keeping
separate businesses separate.

### Integrations

- **MCP server** — 38 tools, 7 resources and 4 prompts over stdio or HTTP, so
  Claude Code, Claude.ai connectors, Cursor or your own agent can read and
  write your knowledge base. Keys are per-user, scoped and rate-limited.
- **Obsidian import** with folder-to-project mapping.
- **Attachments** — images, PDFs, audio, video and documents on S3-compatible
  storage (Cloudflare R2), with text extraction and thumbnails.
- **Offline support** — a service worker plus IndexedDB queue; edits made
  offline sync when you are back.

A complete inventory is in [FEATURES.md](FEATURES.md). Architecture and design
reasoning is in [CLAUDE.md](CLAUDE.md) and [`docs/plans/`](docs/plans).

---

## Requirements

### Required

| What | Why | Cost |
|------|-----|------|
| **Node.js 22+** | Runtime | Free |
| **[Turso](https://turso.tech) database** | All application data (SQLite at the edge) | Free tier is generous |
| **[OpenRouter](https://openrouter.ai) API key** | Embeddings, chat, agents, vision | Pay per use |
| **An SMTP server** | Magic-link sign-in is the *only* way in | Varies |

### Optional

| What | Enables | Without it |
|------|---------|-----------|
| **S3-compatible storage** (Cloudflare R2) | File attachments | Attachment upload is disabled |
| **`CRON_SECRET`** | Scheduled background work | **Required in production** — see below |

> **`CRON_SECRET` is not optional in production.** Every `/api/cron/*` route is
> guarded by it. Unset, each scheduled request is rejected with a 401, so the
> queue is never drained: embeddings are never generated, delegated work sits
> in `queued` forever, and nothing reports an error. The System status
> indicator in the header detects exactly this and says so.

### Running costs

For one person using it daily, expect a few dollars a month in OpenRouter usage
and nothing else — Turso's free tier and Vercel's hobby tier both cover a
personal instance. Cost scales with how much AI processing you enable, and the
tiered router keeps the cheap paths cheap.

---

## Quick start

```bash
git clone https://github.com/crawfordind/brain-portal.git
cd brain-portal
npm install
```

**1. Create the database**

```bash
turso db create brain-portal
turso db show brain-portal --url        # → TURSO_DATABASE_URL
turso db tokens create brain-portal     # → TURSO_AUTH_TOKEN
```

**2. Configure**

```bash
cp .env.example .env.local
```

Fill in `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `OPENROUTER_API_KEY`, the
`SMTP_*` block, and generate two secrets:

```bash
openssl rand -hex 32    # SESSION_SECRET
openssl rand -hex 32    # CRON_SECRET
```

`.env.example` documents every variable, including what breaks without it.

**3. Migrate and create your account**

```bash
npm run db:migrate
npm run user:create you@example.com "Your Name"
```

That second command matters. **Signups are closed by default** (see below), so
a fresh instance has nobody who can log in until you create the first account.

**4. Run it**

```bash
npm run dev
```

Open <http://localhost:3000>, enter your address, and follow the emailed link.

---

## Who can sign up

Magic-link authentication will create an account for any address that
successfully receives a link. On a public URL with SMTP configured and no
policy, that is an **open signup**: anyone on the internet gets a workspace and
a share of your OpenRouter bill.

So the default is closed. `SIGNUP_MODE` controls it:

| Mode | Behaviour |
|------|-----------|
| `closed` *(default)* | Only addresses already in the database can sign in. Add them with `npm run user:create`. |
| `allowlist` | Addresses in `ALLOWED_EMAILS` may sign up. Entries may be a full address or `@yourdomain.com` for a whole domain. |
| `open` | Anyone may sign up. Only for a deliberately public service. |

Existing users can always sign in, whatever the mode. A refused signup gets the
same response as an accepted one, so the endpoint cannot be used to discover
which addresses have accounts.

---

## Deploying

### Vercel

1. Push to GitHub and import the repository at [vercel.com/new](https://vercel.com/new).
2. Add every variable from `.env.example` in the project's environment settings.
3. Deploy. `vercel.json` already declares the cron schedules.
4. Set `NEXT_PUBLIC_APP_URL` to your real URL — magic links are built from it.

The five scheduled jobs (queue processing, the agent queue, heartbeat,
notifications, project health) run automatically once `CRON_SECRET` is set.

### Anywhere else

`npm run build && npm start` behind a reverse proxy works. Two things to know:

- **Attachment media processing does not run in serverless.** Thumbnails, EXIF,
  PDF and spreadsheet text extraction need `sharp`, `pdf-parse` and `xlsx`,
  which are not declared as `serverExternalPackages`. Run
  `npm run queue:process` (or the PM2 config in `ecosystem.config.js`) on a
  normal server to handle those.
- **Set `TRUST_PROXY_HEADERS=false`** if Node is directly internet-facing.
  Rate limiting keys off `x-forwarded-for`, which is trustworthy behind a proxy
  that overwrites it and forgeable when there is not one.

---

## Connecting an AI agent

Brain Portal speaks MCP, so any MCP client can use it as a memory.

```bash
npm run mcp:migrate                                  # once
npm run mcp:keygen -- you@example.com "Claude Code"  # prints the key once
```

**Claude Code / Desktop** (`~/.claude/claude_code_config.json`):

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

**Remote clients** use the HTTP transport at `/api/mcp/rpc` with
`Authorization: Bearer bp_mcp_...`. The full machine-readable catalog is served
from `GET /api/mcp/docs` in JSON, OpenAPI 3.1 or Markdown.

Scope keys to what the agent actually needs — `read_only` plus `ai:search` is a
sensible default. A key in a URL shows up in proxy logs, so if your client
supports request headers, use those.

---

## Development

```bash
npm run dev          # dev server on :3000
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # vitest (1197 tests)
npm run test:watch   # vitest in watch mode
npm run test:coverage
```

Run one test file:

```bash
npx vitest run tests/lib/ai/embeddings.test.ts
```

CI runs lint, typecheck, test and build on every pull request, plus a
dependency audit. None of it needs secrets — migrations skip themselves when
`CI=true`.

### Project layout

```
src/app/          Next.js App Router — pages and 118 API routes
  (dashboard)/    Authenticated app
  api/            REST endpoints
src/components/   React components (ui/ holds shadcn primitives)
src/lib/          Business logic by domain
  ai/             OpenRouter client, embeddings, model slots, tiered routing
  auth/           Magic links, sessions, signup policy
  crm/            Contacts, ventures, interactions
  entities/       Entity resolution and the knowledge graph
  processing/     Background queue and job handlers
  db/             Turso client and schema
src/mcp/          MCP server (stdio + HTTP)
scripts/          Migrations and CLI utilities
tests/            Vitest suites
```

---

## Security

Brain Portal holds your entire working memory, so security reports are taken
seriously. **Please do not open a public issue for a vulnerability** — see
[SECURITY.md](SECURITY.md) for how to report one privately and what is in scope.

Design notes worth knowing if you are deploying it:

- Sessions and magic-link tokens are random 32-byte values, SHA-256 hashed at
  rest, and never logged.
- Server-side link fetching validates the URL, re-checks every address DNS
  returns, and re-validates each redirect hop, so a pasted link cannot be used
  to reach your private network or a cloud metadata service.
- Uploads are checked against their magic bytes, not the Content-Type the
  client claimed. SVG is not an accepted image format.
- Every `/api/cron/*` route and every admin route fails closed when unconfigured.

---

## Contributing

Contributions are welcome — bug reports, fixes, features and documentation
alike. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the conventions,
and a list of good first issues. The
[Code of Conduct](CODE_OF_CONDUCT.md) applies.

If you are planning something large, open an issue first so the approach can be
discussed before you spend a weekend on it.

---

## License

Released under the [GNU Affero General Public License v3.0 or later](LICENSE).
© 2026 Daniel Crawford.

AGPL means you are free to use, study, modify and share this software. It also
means that if you run a modified version as a network service, you must make
your source available to that service's users under the same license. If you
are self-hosting for yourself or your team, this costs you nothing; if you are
building a product on it, you owe the same freedoms onward.
