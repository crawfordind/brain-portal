# Security Policy

Brain Portal holds someone's notes, tasks, contacts and half-formed thoughts,
and it holds API keys that spend real money. A vulnerability here is not
abstract. Reports are welcome and taken seriously.

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
go to the **Security** tab → **Report a vulnerability**. That opens a private
thread with the maintainers and gives you a draft advisory to collaborate in.

If that is unavailable to you, contact the maintainer privately through their
GitHub profile and say only that you have a security report — no details in a
public channel.

Please include:

- What the issue is, and which files or endpoints are involved
- How to reproduce it — a request, a sequence of steps, or a small script
- What an attacker gets out of it
- Anything you know about which versions are affected

You do not need a polished write-up. A rough report of something real is worth
far more than a tidy report of something theoretical.

### What to expect

| | |
|---|---|
| **Acknowledgement** | Within 3 days |
| **Initial assessment** | Within 7 days |
| **Fix for a confirmed high or critical issue** | As fast as is practical, with a published advisory |
| **Credit** | Yes, in the advisory, unless you would rather not be named |

This is a project maintained by volunteers, not a company with a security team
on rotation. Those are honest targets rather than contractual ones.

## Supported versions

Brain Portal is self-hosted and has no release train yet. **`main` is the
supported version.** Fixes land there; if you are running a fork or a pinned
commit, you are responsible for pulling them forward.

## Scope

### In scope

- Authentication and session handling
- Authorization — anything that lets one user read or write another's data
- Injection of any kind (SQL, command, template, prompt injection with real
  consequences)
- Server-side request forgery, including bypasses of the existing protections
- Stored or reflected XSS
- Secrets leaking into responses, logs, error messages or the client bundle
- MCP API key scoping and rate-limit bypass
- Anything that lets an unauthenticated caller spend the operator's money

### Out of scope

- **Missing rate limits on authenticated endpoints.** Known and documented: the
  limiter is per-process and in-memory, which is honest for a personal
  deployment and inadequate for a public one. See `src/lib/rate-limit.ts`.
- **`SIGNUP_MODE=open` behaving as documented.** That is the setting's purpose.
- **Self-XSS**, or attacks requiring the victim to paste code into a console.
- **Missing security headers** that do not lead to an exploitable condition.
- **Vulnerabilities in a dependency with no patched release available.** Report
  those upstream; open a normal issue here so we can track or pin it.
- **Findings from an automated scanner with no demonstrated impact.**

## Deploying safely

A few defaults that matter, because the most likely vulnerability in your
instance is a misconfiguration rather than a bug in this code:

**Keep signups closed.** `SIGNUP_MODE` defaults to `closed` precisely because
magic-link auth will otherwise create an account for anyone who can receive
email. If you open it, you are handing strangers a workspace and your
OpenRouter budget.

**Set `CRON_SECRET` in production.** Without it every `/api/cron/*` request is
rejected, so no background work ever runs — and nothing tells you, because
there is no error, only silence.

**Set `TRUST_PROXY_HEADERS=false` if Node is directly internet-facing.** Rate
limiting keys off `x-forwarded-for`. Behind Vercel, Cloudflare or an nginx that
overwrites the header, that is trustworthy. Directly exposed, it is
attacker-controlled and every limit is bypassable by varying it.

**Serve attachments from a domain that shares no cookies with the app.**
`R2_PUBLIC_URL` should not be a subdomain that can read your session cookie.

**Scope your MCP keys.** `*` is convenient for one trusted agent on your own
machine. Anything shared more widely should get the narrowest scope set that
works, an expiry, and a rate limit. A key passed in a URL rather than a header
will appear in proxy access logs — use `/api/mcp/rpc` with an `Authorization`
header where your client supports it.

**Put an egress proxy in front of link scraping if you handle untrusted
links.** `safeFetch` validates the URL, re-resolves the hostname and
re-validates every redirect hop, but the gap between resolving a name and
connecting to it cannot be closed in application code alone.

## Known limitations

These are documented rather than hidden. None is a secret, and each is a
reasonable place to contribute:

- **Rate limiting is per-process and in-memory.** On serverless, each instance
  keeps its own counters, so the effective limit is roughly the configured one
  times the instance count. A shared store (Redis, Upstash) would fix it.
- **The Content-Security-Policy allows `unsafe-inline` and `unsafe-eval` on
  `script-src`.** That is what Next's App Router needs without nonce threading.
  Tightening it to a nonce-based policy is real, wanted work.
- **DNS rebinding is narrowed, not eliminated.** See the note in
  `src/lib/utils/safe-fetch.ts`.
- **Prompt injection is mitigated, not solved.** Untrusted content reaching a
  model cannot forge the structural tags the prompt builders use, but no
  application-level defence against prompt injection is complete. Treat agent
  output as a suggestion to review, which is why it lands in `/review` rather
  than in your notes.
