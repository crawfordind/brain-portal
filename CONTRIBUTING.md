# Contributing to Brain Portal

Contributions are welcome — bug reports, fixes, features and documentation
alike. This file tries to answer the questions you would otherwise have to ask
in an issue first.

## Getting set up

You need Node 22+, a [Turso](https://turso.tech) database and an
[OpenRouter](https://openrouter.ai) key. A local SMTP server or a throwaway
mail provider is enough for magic links.

```bash
git clone https://github.com/YOUR_FORK/brain-portal.git
cd brain-portal
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate
npm run user:create you@example.com "Your Name"
npm run dev
```

That `user:create` step is not optional: signups default to closed, so a fresh
database has nobody who can sign in.

**In development without SMTP**, the login endpoint returns the magic link in
its JSON response instead of emailing it, so you can still get in.

### Working on something that does not need AI

Most of the app runs fine with a nonsense `OPENROUTER_API_KEY`. Only the
features that actually call a model will fail, and they fail loudly rather than
silently. You do not need a funded account to fix a layout bug.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test
```

All three should pass. CI runs exactly these plus `npm run build`, so if they
are green locally they will be green there. **The test suite is currently
green — 1197 tests across 121 files — so a failure is something you changed,
not pre-existing noise.**

### About lint warnings

`npm run lint` reports zero errors and around 300 warnings. That split is
deliberate:

- **Errors** mean something is broken. Never merge with a new one.
- **Warnings** are mostly `no-unused-vars` and `no-explicit-any`, plus a known
  backlog of `react-hooks/set-state-in-effect`. They are worth cleaning up and
  are not worth blocking your pull request over.

Please do not add new warnings in the code you touch, but equally, please do
not turn a two-line bug fix into a 400-file type sweep.

## Conventions

**Match the surrounding code.** This codebase has a fairly distinctive comment
style: comments explain *why* a thing is the way it is, especially when the
obvious implementation was tried and was wrong. If you fix something subtle,
say what the subtlety was. Future contributors — including you in six months —
will be reading it to find out whether they can change it back.

**Keep pure logic pure.** Domain logic that can be a pure function usually is
one, in its own module, with unit tests. Modules that reach for the database or
construct an API client are kept separate from the vocabularies and parsers
that describe them, so the latter can be imported anywhere. `item-types.ts`
versus `item-context.ts` is the pattern.

**Write the test.** Not for everything, but a bug fix without a test that would
have caught it tends to become a bug fix again later.

**One change per pull request.** A refactor bundled with a feature is hard to
review and harder to revert.

## Architecture

Read [CLAUDE.md](CLAUDE.md) before making a substantial change. Despite the
filename, it is the architecture document: it covers every subsystem and, more
usefully, records *why* each is built the way it is and which simpler approach
failed. [`docs/plans/`](docs/plans) holds the longer design documents.

A quick map:

| Area | Where |
|------|-------|
| Pages and API routes | `src/app/` |
| Business logic by domain | `src/lib/` |
| React components | `src/components/` |
| MCP server | `src/mcp/` |
| Migrations and CLI tools | `scripts/` |
| Tests | `tests/` |

### Some things that will save you time

- **Timestamps.** SQLite's `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` with
  no timezone marker and is UTC. `new Date()` reads that as *local*. Use
  `parseDbTimestamp`.
- **Ownership.** Every query against user data needs a `user_id` predicate,
  even when a prior check already established access. Defence in depth is the
  whole defence when a route is refactored later.
- **Fetching a user-supplied URL.** Use `safeFetch` from
  `src/lib/utils/safe-fetch.ts`. Never call `fetch` directly on a URL a user
  provided — the reasons are in that file's header.
- **Mocking the database in a test.** Use `createDbClientMock()` from
  `tests/helpers/db-mock.ts` rather than hand-rolling a partial mock, or your
  test will break the next time the route under test calls a different helper.
- **Rendering a component that uses React Query.** Use `renderWithProviders`
  from `tests/helpers/render.tsx`.

## Good first issues

Genuinely useful, genuinely self-contained:

- **Tighten the Content-Security-Policy.** It currently allows `unsafe-inline`
  and `unsafe-eval` on `script-src`. Threading a nonce through the App Router
  would let both go. See `next.config.ts`.
- **Work through the `react-hooks/set-state-in-effect` backlog.** About 19
  components set state synchronously inside an effect, mostly as a "have I
  mounted yet" hydration guard. Each one is a small, independent fix.
- **Make rate limiting shared.** `src/lib/rate-limit.ts` is an in-memory `Map`,
  which on serverless means one bucket per instance. A pluggable store with a
  Redis/Upstash implementation would make it real.
- **Run attachment media jobs in serverless.** `sharp`, `pdf-parse` and `xlsx`
  need declaring as `serverExternalPackages` before the cron can handle
  thumbnails and text extraction. Today they need a normal server.
- **Let attachments be embedded.** The `embeddings` table's CHECK constraint
  permits only `note`, `capture` and `task_candidate`, so attachment vectors
  have nowhere to go and are excluded from the queue.
- **Reduce the `any` count.** 139 warnings' worth. Pick a directory.

Issues labelled `good first issue` on the tracker are the current list.

## Reporting bugs and requesting features

Please use the issue templates. For a bug, the three things that matter are
what you did, what you expected, and what happened instead — plus your Node
version and whether you are self-hosting or on Vercel.

**For security issues, do not open a public issue.** See
[SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## License

By contributing you agree that your contributions are licensed under the
project's AGPL-3.0-or-later license (see [LICENSE](LICENSE)).
