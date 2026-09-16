<div align="center">

# 🧠 Brain Portal

### Think it. Keep it. Use it.

**A self-hosted knowledge base with an AI that has actually read your notes.**

Most note apps store text. Most AI assistants forget everything when the tab closes.<br />
Brain Portal is the thing in between.

[![CI](https://github.com/crawfordind/brain-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/crawfordind/brain-portal/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![MCP](https://img.shields.io/badge/MCP-38%20tools-teal.svg)](#give-your-ai-a-memory)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quick start](#quick-start) · [Features](#what-it-does) · [Connect your AI](#give-your-ai-a-memory) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

## The problem

You write something down. Six weeks later you need it and you cannot find it, because you
searched for "pricing" and got back every note containing the word "pricing" instead of the
one where you *decided* something about pricing.

Meanwhile your AI assistant is brilliant and amnesiac. Every conversation starts from zero.
You paste in context, get a good answer, close the tab, and the context is gone.

Brain Portal keeps a durable record of what you think, indexes all of it, and hands it to
the model. **Your notes become the context window.**

```
     you write  →  it gets embedded  →  the AI reads YOUR stuff  →  you keep the good bits
         ↑                                                                    │
         └────────────────────────────────────────────────────────────────────┘
```

---

## What it does

### 🧲 One input for everything

`⌘K` searches everything. `⌘⇧C` captures anything. Type a thought, paste a link, speak into
your phone, sketch on a tablet, or share to it from any app's share sheet — it gets
classified and filed without you choosing a folder.

### 🔍 Search that understands you

Every note, capture and task is embedded into a 1536-dimension vector space, with SQLite
FTS5 underneath for exact matches. Ask *"what did I decide about pricing"* and get the
decision, not the keyword.

Beneath that sits a **canonical entity graph** — a company mentioned thirteen different ways
collapses into one node with thirteen mentions and a timeline. It reasons about the thing,
not the string.

### 💬 Ask about anything

Point at a note, task, capture or idea and ask. The answer streams back holding that item,
its project, your highlights on it, and the notes semantically nearest to it. The follow-up
is just the next message. One tap keeps the answer as a note or a task.

### 🎨 Highlighting is an instruction

The colour tells the model what to do — this is the feature people don't expect:

| | Colour | Means |
|---|---|---|
| 🟢 | Green | Keep as is, don't touch it |
| 🟡 | Yellow | Rework this |
| 🔵 | Blue | Say more here |
| 🟣 | Purple | Too long, tighten it |
| 🔴 | Red | Cut this / I disagree |
| 🟠 | Orange | Fact-check this |
| 🩷 | Pink | I don't follow — explain it |

Every model that later reads the note is handed the same meanings, so a review responds to
your markup without you writing a line of prompt.

### 🤖 Work that happens while you don't

Scheduled rules, skills and your own AI tools can hand work to 17 specialist roles — code,
research, legal, finance, product, ops. It runs out of band against your real context.

**Nothing fires behind your back.** Output is versioned and waits in a review queue where
you approve it, send it back, or bin it. It never writes into your notes on its own.

### 👥 A Rolodex you never had to fill in

Contacts are built from notes you already wrote. People and companies get extracted,
resolved against each other, and given a timeline of every mention and every real touch.
Running several businesses? Keep them in separate compartments, one contact holding
different roles at each.

### ✍️ Write, speak, draw

A markdown editor that keeps your cursor centred. Pressure-sensitive sketching with
**AI ink-to-text** — strokes stay editable as vectors, and the transcription is indexed, so
a drawing is searchable. Voice capture with punctuation commands. Tasks that parse
*"write the post by Friday, urgent"* into a real due date and priority.

### 🔌 Give your AI a memory

A full **MCP server** — 38 tools, 8 resources, 4 prompts, over stdio or HTTP. Claude Code,
Claude.ai, Cursor or your own agent can search what you've written, capture what you just
decided, and read your dashboard before answering anything.

Keys are per-user, scoped and rate-limited, so you decide how much reach any one agent gets.

<details>
<summary><b>Everything else</b> — click to expand</summary>

<br />

| | |
|---|---|
| **Stream dashboard** | One feed at a density you choose, grouped into time buckets, with a "since you were last here" divider. A *Needs you* band that appears only when something needs you. |
| **Projects** | Nested hierarchy, collaborators with roles, activity logs, AI health summaries |
| **Tasks** | Natural-language parsing, priorities, recurrence, kanban, calendar |
| **Daily notes & journaling** | Templated journals across 10 categories, with monthly compilation |
| **Weekly reviews** | AI-generated from your actual week |
| **Insights** | Deduped against what you've already been told, ranked by your up/down votes |
| **Task recommendations** | AI scans your notes for tasks you haven't created yet |
| **Attachments** | Images, PDFs, audio, video, documents on S3-compatible storage, with text extraction and thumbnails |
| **Offline** | Service worker plus IndexedDB queue; edits sync when you're back |
| **Obsidian import** | Folder-to-project mapping |
| **Markdown export** | Your vault back out as `.md` or a ZIP, any time |
| **Model selection** | Pick a model per *job* from OpenRouter's live catalog. A retired model degrades to the next candidate instead of breaking a feature |
| **Shareable notes** | Public read-only links, revocable |
| **AI guardrails** | Set your values, style and boundaries; agents adapt |
| **It tells you when it breaks** | Background failures surface in plain language, not silence |
| **Passwordless** | Magic links. No passwords to leak |

</details>

---

## Quick start

**You'll need:** Node 22+, a [Turso](https://turso.tech) database (free tier is plenty), an
[OpenRouter](https://openrouter.ai) key, and any SMTP server.

```bash
git clone https://github.com/crawfordind/brain-portal.git
cd brain-portal
npm install
```

**1. Make a database**

```bash
turso db create brain-portal
turso db show brain-portal --url      # → TURSO_DATABASE_URL
turso db tokens create brain-portal   # → TURSO_AUTH_TOKEN
```

**2. Configure**

```bash
cp .env.example .env.local
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # CRON_SECRET
```

`.env.example` documents every variable and what breaks without it.

**3. Migrate, then make yourself an account**

```bash
npm run db:migrate
npm run user:create you@example.com "Your Name"
```

That second command matters — **signups are closed by default**, so a fresh instance has
nobody who can log in until you create the first account.

**4. Go**

```bash
npm run dev
```

Open <http://localhost:3000>, enter your address, click the emailed link.

> **Running costs**, for one person using it daily: a few dollars a month of OpenRouter
> usage, and nothing else. Turso's free tier and Vercel's hobby tier both cover a personal
> instance.

---

## Who can sign up

Magic-link auth will create an account for *any* address that receives a link. On a public
URL with SMTP configured and no policy, that's an open signup — anyone on the internet gets
a workspace and a share of your OpenRouter bill. So the default is closed.

| `SIGNUP_MODE` | Who gets in |
|---|---|
| `closed` *(default)* | Only addresses already in the database. Add them with `npm run user:create`. |
| `allowlist` | Addresses in `ALLOWED_EMAILS` — a full address, or `@yourdomain.com` for a whole domain. |
| `open` | Anyone. Only for a deliberately public service. |

Existing users always sign in, whatever the mode. A refused signup gets the same response as
an accepted one, so the endpoint can't be used to discover which addresses have accounts.

---

## Deploying

<details>
<summary><b>Vercel</b></summary>

<br />

1. Push to GitHub, import at [vercel.com/new](https://vercel.com/new)
2. Add every variable from `.env.example`
3. Deploy — `vercel.json` already declares the cron schedules
4. Point `NEXT_PUBLIC_APP_URL` at your real URL; magic links are built from it

> **`CRON_SECRET` is not optional in production.** Every `/api/cron/*` route is guarded by
> it. Unset, each scheduled request is rejected with a 401 — embeddings are never generated,
> delegated work sits in `queued` forever, and *nothing reports an error*. The System status
> indicator in the header detects exactly this and says so.

</details>

<details>
<summary><b>Anywhere else</b></summary>

<br />

`npm run build && npm start` behind a reverse proxy. Two things to know:

- **Attachment media processing doesn't run in serverless.** Thumbnails, EXIF, PDF and
  spreadsheet extraction need `sharp`, `pdf-parse` and `xlsx`, which aren't declared as
  `serverExternalPackages`. Run `npm run queue:process` (or the PM2 config in
  `ecosystem.config.js`) on a normal server for those.
- **Set `TRUST_PROXY_HEADERS=false`** if Node is directly internet-facing. Rate limiting
  keys off `x-forwarded-for` — trustworthy behind a proxy that overwrites it, forgeable
  when there isn't one.

</details>

<details>
<summary><b>Connecting Claude Code, Cursor, or your own agent</b></summary>

<br />

```bash
npm run mcp:migrate                                  # once
npm run mcp:keygen -- you@example.com "Claude Code"  # prints the key once
```

`~/.claude/claude_code_config.json`:

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

Remote clients use the HTTP transport at `/api/mcp/rpc` with
`Authorization: Bearer bp_mcp_...`. The machine-readable catalog is at `GET /api/mcp/docs`
in JSON, OpenAPI 3.1 or Markdown.

Scope keys to what the agent needs — `read_only` plus `ai:search` is a sane default. A key
in a URL shows up in proxy logs, so use headers where your client supports them.

</details>

---

## Development

```bash
npm run dev          npm run lint         npm test
npm run build        npm run typecheck    npm run test:watch
```

CI runs all four plus a dependency audit on every PR, and needs no secrets — migrations skip
themselves when `CI=true`.

```
src/app/          Pages and 117 API routes
src/lib/          Business logic by domain (ai, auth, crm, entities, processing, db)
src/components/   React components (ui/ holds shadcn primitives)
src/mcp/          MCP server, stdio + HTTP
scripts/          Migrations and CLI tools
tests/            1197 Vitest tests
```

**Read [CLAUDE.md](CLAUDE.md) before a substantial change.** Despite the filename it's the
architecture document — it covers every subsystem and, more usefully, records why each is
built the way it is and which simpler approach failed.

---

## Security

Brain Portal holds your entire working memory. **Don't open a public issue for a
vulnerability** — [SECURITY.md](SECURITY.md) has the private reporting path, the scope, and
the limitations that are documented rather than hidden.

Worth knowing if you're deploying it:

- Session and magic-link tokens are random 32-byte values, SHA-256 hashed at rest, never logged
- Server-side link fetching validates the URL, re-checks every address DNS returns, and
  re-validates each redirect hop — a pasted link can't reach your private network or a cloud
  metadata service
- Uploads are checked against their magic bytes, not the type the client claimed. SVG is not
  an accepted image format
- Every cron and admin route fails closed when unconfigured

---

## Contributing

Bug reports, fixes, features and docs are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md)
has the setup, the conventions, the traps worth knowing, and a list of good first issues —
including a few that are genuinely useful and genuinely self-contained.

Planning something large? Open an issue first so the approach can be discussed before you
spend a weekend on it.

The [Code of Conduct](CODE_OF_CONDUCT.md) applies.

---

## License

[GNU AGPL v3.0 or later](LICENSE) · © 2026 Daniel Crawford

You're free to use, study, modify and share this. If you run a modified version as a network
service, you must make your source available to that service's users under the same license.
Self-hosting for yourself or your team costs you nothing; building a product on it means
passing the same freedoms on.

<div align="center">
<br />

**[⭐ Star this repo](https://github.com/crawfordind/brain-portal)** if a knowledge base that
actually remembers sounds useful.

</div>
