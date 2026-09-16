# Stream v2 — "The Desk"

**A PRD for the main dashboard of an agentic second brain**

- **Date:** 2026-09-14
- **Surface:** `/` (`StreamPage`) — and, by consequence, the whole app's interaction grammar
- **Status:** Phases 0 and 1 shipped 2026-09-14. Phases 2–4 proposed.
- **Supersedes the dashboard portion of:** `2026-02-06-dashboard-redesign.md`, and the Stream sections of `2026-02-13-ux-improvements-design.md`

---

## Contents

1. [Summary](#1-summary)
2. [Where we are, measured](#2-where-we-are-measured)
3. [The panel](#3-the-panel)
4. [Competitive scan: what the frontier actually ships](#4-competitive-scan-what-the-frontier-actually-ships)
5. [Design principles](#5-design-principles)
6. [The layout](#6-the-layout)
7. [Component specifications](#7-component-specifications)
8. [The interaction model](#8-the-interaction-model)
9. [Reducing lift across the rest of the app](#9-reducing-lift-across-the-rest-of-the-app)
10. [Data and API plan](#10-data-and-api-plan)
11. [Phasing](#11-phasing)
12. [Success metrics](#12-success-metrics)
13. [Non-goals, risks, open questions](#13-non-goals-risks-open-questions)
14. [Requirement index](#14-requirement-index)

---

## 1. Summary

The Stream is a well-built **launcher**. Every element on it is a link to somewhere
else: a count that routes to `/tasks`, a pill that routes to `/crm`, a card that
routes to `/notes/…`. It tells you competently that something is waiting and then
makes you leave to deal with it.

The proposal is to make it a **desk**.

> **The rule:** anything you can learn on the dashboard, you can act on without
> leaving it.

Three things follow from that rule, and they are the whole PRD:

1. **Counts become queues.** The "Needs you" pills expand *in place* into the
   actual items, with the actual actions. Clearing three overdue tasks becomes
   three keystrokes on the home screen instead of a round trip to `/tasks`.
2. **Rows earn their pixels.** A density control (Compact / Cozy / Comfortable),
   time-bucketed grouping, and an inline expansion drawer replace the one flat
   list of identical 88px cards. Measured below: **≈7 → ≈25 addressable items**
   on a 1080p screen, **≈5 → ≈13** on a phone.
3. **The app's own intelligence shows up.** Brain Portal has 118 API routes, an
   entity graph, an insight-quality pipeline with a feedback loop, task
   recommendations, project health, a heartbeat, 8 skills and a background
   queue. The dashboard consumes **three** data sources. A right rail — built in
   the ~780px of horizontal margin that `max-w-4xl` currently throws away —
   surfaces the rest.

Nothing here requires a new table. Most of it requires new *composition* of
endpoints that already exist.

---

## 2. Where we are, measured

### 2.1 The vertical budget

Desktop, 1920×1080, browser chrome ~120px → **960px of content height**.

| Element | Height | Information delivered |
|---|---|---|
| Greeting + date + "N done today" | 56px | ~8 words |
| Brain Bar | 120px | an input |
| `NeedsYou` pills | 34px | up to 6 integers |
| `CrmPulseCard` (quiet state) | 28px | 1 sentence |
| Filter chips | 34px | 4 toggles + "+N" |
| **Chrome subtotal** | **~272px** | |
| Stream cards @ 88px each | remaining 688px | **≈7 items** |

Mobile, iPhone-class 844px viewport, chrome + bottom nav ~184px → **660px**:
chrome subtotal ~244px, leaving **≈4–5 cards**.

An app whose premise is *"a durable copy of every thought"* shows you seven of
them.

### 2.2 The horizontal budget

`src/components/layout/agentic-layout.tsx:75` — `container max-w-4xl`.

- **896px** content column
- **240px** sidebar
- On a 1920px display: **~780px of empty margin**, roughly 41% of the screen

`max-w-4xl` is correct for *reading a note*. It is a bad default for a
dashboard, which is not prose.

### 2.3 What the dashboard knows about

The Stream reads `/api/stream`, `/api/notifications?countOnly=true`,
`getStreamStats()`, `getCrmPulse()`.

What exists and never appears on it:

| Capability | Where it lives | Dashboard presence |
|---|---|---|
| Task recommendations (AI-found tasks in your notes) | `task_recommendations`, `/api/tasks/recommendations` | sidebar badge only |
| Insights + up/downvote feedback loop | `insights`, `/api/insights` (PUT) | none |
| Knowledge graph / note connections | `note_connections`, `/api/graph`, `components/graph/*` | none |
| Entity & CRM graph | `entities`, `entity_mentions` | contact counts only |
| Project health | `/api/projects/[id]/health`, `cron/generate-project-health` | none |
| Background work (queue, skills, heartbeat, agents) | `processing_queue`, `skills`, `heartbeat_tasks` | **failures only** |
| Weekly review | `weekly_reviews`, `/api/weekly` | none |
| Journal / daily note | `daily_notes`, `/api/daily` | a feed row |
| Pinned notes | `pinned-notes-strip.tsx` | sidebar only |
| Attachments | `attachments`, `/api/attachments` | none |

The system is far more intelligent than its front door admits.

### 2.4 Controls that do nothing

Four are confirmed in the current code. These are worse than missing features,
because they teach the user that the interface lies. **All four are fixed —
see §9.1.**

- **`handleArchive` never persists.** `stream-feed.tsx:189` filters the item out
  of local state and calls no API. Archive appears to work; the item returns on
  refresh. *(P0 bug, not a redesign item.)*
- **Reminder dismiss is inert.** `StreamItemCard` renders a dismiss button
  guarded on `onDismiss`, and `StreamFeed` never passes `onDismiss`. The button
  is visible and does nothing. *(P0 bug.)*
- **Brain Bar's suggested actions are stubs.** `brain-bar.tsx` renders
  `classification.suggestedActions` as buttons whose `onClick` body is a comment
  explaining that they are unimplemented.
- **And the endpoint behind archive lied too.** `PATCH /api/stream/[id]` decided
  success from `mutate()`, which returns `rows[0] ?? null` — an `UPDATE` without
  `RETURNING` has no rows, so it returned `{success:true}` for every id ever
  passed to it. Nobody noticed because no client called it. *(B5, §9.1.)*

### 2.5 Everything else, in one list

- **Actions are hover-gated on desktop** (`md:opacity-0 md:group-hover:opacity-100`).
  A user who does not hover does not know the app can do anything.
- **No keyboard path through the feed.** `Cmd+K` opens search; the feed itself
  has no `j`/`k`, no `e`, no `x`, no `⏎`.
- **Nothing expands.** Clicking a note navigates, a journal entry navigates, an
  agent output navigates. Home is a place you leave.
- **Chronological is the weakest available ranking.** A three-minute-old thought,
  a stale note and an overdue task render identically and sort by `updated_at`.
- **Two competing taxonomies stacked vertically.** `NeedsYou` (by urgency) and
  filter chips (by type) are two rows describing the same corpus.
- **Four separate attention counters** — `getStreamStats`, `getCrmPulse`,
  `useReviewCount`, `useCrmAttentionCount`, `useInboxCount`, plus `NeedsYou`'s own
  notifications fetch. They are *designed* to agree; nothing *enforces* it.
- **`fetchItems` closes over `offset` and `items.length`** (`stream-feed.tsx:97`),
  so it is rebuilt on every fetch and "Load more" can double-append under a race.
  The project already depends on React Query; this should be `useInfiniteQuery`.
- **No optimistic UI, no undo.** Completing a task waits for a round trip; there
  is no way back. `sonner` is already installed and supports action toasts.
- **Delegation left a hole.** Folding it into chat was right for *conversation*.
  But "go do this while I'm away" — the thing agents, skills and the heartbeat
  are for — now has **no launch point anywhere on the home screen**.

---

## 3. The panel

> **Honesty note.** These are **composite archetypes**, not transcripts. Expert
> voices are synthesized from the published design practice of the schools named
> in §4 plus the constraints visible in this codebase. User voices are
> constructed from the workloads this repo actually serves — multi-venture
> operations, a farm content pipeline, CRM/compliance, heavy capture — and from
> the failure modes in §2. Treat them as a structured way to argue with the
> design, not as research findings. Where a real study would change the answer,
> §13 says so.

### 3.1 Experts

**Density & information architecture (the Tufte school)**
> "You have a data-ink problem, not a space problem. A 56px greeting that says
> 'Good afternoon' is the most expensive sentence in the application. Meanwhile
> `max-w-4xl` is discarding 41% of the display. Density is not achieved by
> shrinking type — it is achieved by removing things that carry no information
> and then using a strict grid so the remainder can sit closer together without
> becoming noise."
> → **R1** Delete or fold decorative chrome. **R2** Break `max-w-4xl` on the
> dashboard only. **R3** Density is a *control*, not a fixed choice.

**Interaction design, keyboard-first tools (the Linear/Superhuman school)**
> "Triage is a sweep, not a tour. The reason Linear's triage works is that the
> queue, the decision and the result are on one screen, and the hand never leaves
> the keyboard. Your pills route away to six different screens — that is six
> context switches to do what should be one pass. And hover-revealed actions are
> a desktop-only secret; on a trackpad they cost a hunt, on a phone they don't
> exist."
> → **R4** Expand-in-place triage. **R5** Full keyboard model over the feed.
> **R6** Actions always visible at Compact density.

**Agentic UX / human-in-the-loop**
> "Your agents are invisible until they fail. That is exactly backwards.
> Interruptibility has to be a first-class surface: what is running, what it
> intends, what it produced, and a pause/approve/rollback that is always within
> reach. A system that only speaks up to say 'something broke' trains people to
> distrust it. Also — you removed the only way to *start* background work from
> the home screen. Conversation and delegation are different verbs; you replaced
> one with the other."
> → **R7** A Background Work rail card showing success, not only failure.
> **R8** Re-introduce "run this in the background" as a *chat action*, not a form.
> **R9** Every agent-produced item carries provenance and a one-key accept/reject.

**Daily-planning ritual (the Sunsama school)**
> "There is no 'today' in this product. There's a greeting that says the date and
> a feed sorted by modification time. The single highest-leverage band you can add
> is a compressed 'today' — what's due, what's scheduled, whether the journal has
> been touched. Not a 15-minute ceremony. One band, one line, expandable."
> → **R10** A Today band.

**PKM architecture (the Tana/Capacities/Heptabase school)**
> "You built an entity graph, a connection graph and an insight pipeline with a
> learning loop, and the home screen renders none of it. The differentiator of a
> second brain is not that it stores — everything stores — it's that it
> *surfaces*. 'Three notes you wrote months apart just got linked' is the moment
> people tell their friends about. That moment currently has no UI."
> → **R11** Connections & Insights rail card, with the existing feedback loop wired.
> **R12** Related notes inside the expansion drawer.

**Accessibility & mobile**
> "Compact density cannot mean 28px tap targets. The row can be 36px tall and
> still present 44px hit areas with negative margins. Expansion must be real
> disclosure — `aria-expanded`, focus moved into the drawer, `Esc` returns focus
> to the row. And if you add a right rail, its reading order must come *after*
> the stream in the DOM, whatever the visual order is."
> → **R13** Targets ≥44px at every density. **R14** Full a11y contract on
> expansion. **R15** DOM order = priority order.

**Frontend performance**
> "Six attention counters is six chances to disagree and up to six requests. One
> endpoint, one cache key, one number per thing. And the rail must not block the
> stream — stream the rail in with Suspense or the dashboard's LCP becomes the
> slowest card on it."
> → **R16** One `/api/attention` endpoint. **R17** Rail cards stream
> independently; none blocks first paint.

### 3.2 Users

**The Operator** — runs several ventures; the CRM, compliance and follow-ups are the job.
> "My question every morning is *who am I late to*. I get a pill that says '4
> contacts to sort'. Four *what*? I have to go to `/crm`, read the list, decide,
> come back. By then I've forgotten the other five pills. Show me the names."
> → **R4**, **R18** People rail card with names and one-tap log-a-touch.

**The Maker** — captures constantly, writes long-form, thinks in the stream.
> "I love the Brain Bar. But after I capture something the app forgets about it.
> It classifies it, files it, and that's it — no 'this is related to that thing
> you wrote in March,' no 'want this as a task too.' And the suggestion buttons it
> *does* show don't work. I clicked them for a week before I realised."
> → **R19** Post-capture actions that work. **R12**, **R11**.

**The Commuter** — phone only, one hand, 20-second sessions, often outdoors.
> "On my phone the first screen is a greeting, a box, and some pills. I have to
> scroll to see anything I own. And I can't swipe anything. Every action is a tap
> into a menu."
> → **R20** Mobile-first vertical budget. **R21** Swipe actions (`use-swipe`
> already exists and is used in the calendar views).

**The Returner** — away four days; opens the app cold.
> "I want one screen that says *here's what happened while you were gone*. What
> did the agents do, what got linked, what's overdue, who emailed. Instead I get
> a feed sorted by modification time that I have to reconstruct by hand."
> → **R22** Time-bucketed grouping with a "since you were last here" divider.
> **R7**.

**The Delegator** — the reason the agent system exists.
> "Chat is better for questions, no argument. But I used to be able to hand off a
> job and walk away. Now if I want something *done* while I'm asleep there's
> nowhere to say so. The 17 specialists are still in the database. They're just
> unreachable."
> → **R8**, **R7**.

### 3.3 The distillation

Every voice above reduces to one of four demands:

| Demand | Requirements |
|---|---|
| **Show me more per screen** | R1, R2, R3, R20 |
| **Let me act where I am** | R4, R5, R6, R13, R14, R18, R19, R21 |
| **Show me what the brain figured out** | R10, R11, R12, R22 |
| **Show me what the agents are doing** | R7, R8, R9 |

Plus the two hygiene requirements that make the rest trustworthy: **R15/R16/R17**
(one source of truth, correct order, nothing blocks paint).

---

## 4. Competitive scan: what the frontier actually ships

| Product | The pattern worth taking | How it lands here |
|---|---|---|
| **Linear** — triage queue | An incoming queue with its own view, processed in a single keyboard sweep: accept / reject / prioritise / defer. Opinionated defaults reduce decision fatigue. | The Decision Rail (§7.2). Take the *sweep*, reject the separate route — ours expands in place. |
| **Superhuman** — split inbox | Segments the same corpus by *what kind of attention it needs*, not by type. Keyboard-complete. | Saved views (§7.4) replace type-only chips. |
| **Sunsama** — the planning ritual | A guided "what matters today, does the math work" pass; users report the 15-minute investment as a genuine behaviour change. | The Today band (§7.3) — the value without the ceremony, because a second brain is opened 20× a day, not once. |
| **Akiflow** — universal inbox + command bar | Everything lands in one place; keyboard-first triage out of it. Users cite it as killing the "I'll do it later" trap. | Brain Bar slash-commands (§7.1) + the Decision Rail. |
| **Notion 3.0 / Custom Agents** (Sep 2025 → Feb 2026) | Agents that run on schedules and triggers, as first-class workspace citizens with visible runs. | The Background Work card (§7.6) — we already have the heartbeat and skills engine; we just never show it. |
| **Mem 2.0** (rebuild, Oct 2025) | Home screen fuses notes + collections + an AI panel; the rigid Inbox was demoted to an opt-in collection because it didn't match most workflows. | Vindicates saved views over a mandatory inbox. Our rail is the "AI panel" equivalent. |
| **Tana** (2026 pivot) | Ambient capture — meeting audio transcribed with no bot, auto-tagged, **linked back to context**. Capture is passive; structure is automatic. | Our equivalent of "linked back to context" is the entity graph, which is invisible. §7.7. |
| **Agentic-UX practice** (Smashing, Feb 2026; UX Magazine) | Design *interruptibility*: pause, override, rollback, escalation as first-class. Gate before the run for standing access, after the draft for consequential artifacts. Show work as lanes with owner/status/outcome — not chat transcripts. | §7.6 and R9. Our review flow already gates after the draft; it just isn't visible from home. |
| **Dashboard practice, 2026** | The shift from "metrics walls" to decision-focused layouts: KPI hierarchy, saved views, freshness indicators, and a direct path from insight to action. "Density with clarity" — strict grids and firm typographic hierarchy. | The whole PRD. Our current dashboard is the opposite failure mode: not a metrics wall, an *empty* wall. |

**What nobody has yet — and where we can lead.** Every product above does either
knowledge (Tana, Mem, Capacities) or agency (Notion agents, Linear) well.
None of them puts **the agent's working state, the knowledge graph's discoveries,
and the human's decision queue on one screen**. The right rail is that bet.

Sources: [Tana — best second brain apps 2026](https://tana.inc/blog/best-second-brain-apps-2026) ·
[Mem 2.0 transition](https://get.mem.ai/blog/mem-2-dot-0-transition-guide) ·
[Notion 3.0: Agents](https://www.notion.com/releases/2025-09-18) ·
[Linear Triage guide](https://www.issuelinker.com/blog/linear-triage) ·
[How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) ·
[Designing for Agentic AI — Smashing, Feb 2026](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) ·
[Secrets of Agentic UX — UX Magazine](https://uxmag.com/articles/secrets-of-agentic-ux-emerging-design-patterns-for-human-interaction-with-ai-agents) ·
[Sunsama vs Akiflow 2026](https://toolfinder.com/comparisons/akiflow-vs-sunsama) ·
[Dashboard design trends 2026](https://fuselabcreative.com/top-dashboard-design-trends-2025/)

---

## 5. Design principles

1. **The desk, not the launcher.** If the dashboard shows it, the dashboard can
   act on it. A navigation is an admission of failure, not a feature.
2. **Density through hierarchy, never through shrinking.** Three information
   temperatures — the rail (hot, dense, decisions), the stream (warm, scannable),
   the drawer (cool, complete). Type sizes do not go below 12px; rows get shorter
   by *removing* elements, not by compressing them.
3. **Every pixel is either information or a target.** Decoration is deleted.
4. **Progressive disclosure over navigation.** Collapsed → expanded → full page.
   Two of those three happen in place.
5. **Silence is the reward for an empty queue.** Keep the existing discipline:
   `NeedsYou` and `CrmPulseCard` render *nothing* when they have nothing. Extend
   it to every new rail card. A dashboard of zeroes is a dashboard of noise.
6. **State is remembered.** Density, rail card collapse, active view, group
   collapse — all persisted to `users.preferences`. The app should look the way
   you left it.
7. **Show the machine working.** Agents, the queue, the heartbeat and the graph
   are the product. Rendering them only on failure is the single biggest
   perceived-value loss in the app today.

---

## 6. The layout

### 6.1 Desktop, ≥1280px

```
┌─ sidebar ─┬────────── main (flex, min 560px) ───────────┬──── rail (380px) ────┐
│ Today     │ ╭─────────────────────────────────────────╮ │ ╭──────────────────╮ │
│  Stream • │ │ A. BRAIN BAR         Sun 14 · 6 done ✓ │ │ │ B. IN FLIGHT   ▾ │ │
│  Tasks  3 │ │ [ what's on your mind…        ] 🎙 ↵   │ │ │ ● Northwind Q3    │ │
│  Review 2 │ ╰─────────────────────────────────────────╯ │ │ ● Farm content   │ │
│  People 4 │ ╭─────────────────────────────────────────╮ │ ╰──────────────────╯ │
│           │ │ C. NEEDS YOU                            │ │ ╭──────────────────╮ │
│ Library   │ │ ⚠3 overdue  🤖2 review  👤4 sort  ✨4   │ │ │ D. PEOPLE      ▾ │ │
│  Notes    │ │ ─────────── expanded ─────────────────  │ │ │ Northwind  2d ago │ │
│  Journal  │ │ ⚠ Overdue                 snooze all ▾ │ │ │ Broker    5d ago │ │
│  Projects │ │  ○ Send Q3 numbers  2d  [✓][→][⋯]      │ │ │ + log a touch    │ │
│           │ │  ○ Reply to broker  5d  [✓][→][⋯]      │ │ ╰──────────────────╯ │
│ ─────     │ │  ○ Book audit      11d  [✓][→][⋯]      │ │ ╭──────────────────╮ │
│ Settings  │ │                          see all 3 →   │ │ │ E. DISCOVERED  ▾ │ │
│           │ ╰─────────────────────────────────────────╯ │ │ ✨ 3 notes on    │ │
│ Pinned    │ ╭─────────────────────────────────────────╮ │ │   pricing linked │ │
│  · SOP    │ │ F. TODAY            3 due · journal ○  ▾│ │ │        👍  👎    │ │
│  · Specs  │ ╰─────────────────────────────────────────╯ │ ╰──────────────────╯ │
│           │  All · Unfiled · Decide · Project ▾   ⣿ ▾  │ ╭──────────────────╮ │
│           │  ┌─ Now ──────────────────────────────────┐ │ │ G. AGENTS      ▾ │ │
│           │  │ 💡 Pricing idea for the CSA   2m [⋯]  │ │ │ ▸ copy · draft   │ │
│           │  │ ☑ Call the vet                8m [⋯]  │ │ │   ▓▓▓▓░░ 2m left │ │
│           │  ├─ Earlier today ───────────────────────┤ │ │ ✓ 12 embedded    │ │
│           │  │ 📄 Compliance notes          10:04[⋯] │ │ ╰──────────────────╯ │
│           │  │ 🔗 usda.gov/organic-cert      9:12[⋯] │ │                      │
│           │  │ ☑ Order seed trays            8:40[⋯] │ │                      │
│           │  ├─ Yesterday ──────────────────────────┤ │ │                      │
│           │  │ …                                     │ │ │                      │
└───────────┴─────────────────────────────────────────────┴──────────────────────┘
```

Breakpoints:

| Width | Layout |
|---|---|
| ≥1536px | main 1fr + rail 420px, `max-w-[1600px]` centred |
| 1280–1535px | main 1fr + rail 380px |
| 1024–1279px | single column; rail cards fold to the bottom of the main column |
| <1024px | mobile (§6.2) |

**R2 scope note.** `max-w-4xl` is removed *for the dashboard route only*. Note
reading, the editor and Settings keep their measure. This is a per-route
container, not a global change.

### 6.2 Mobile, <1024px

```
┌────────────────────────────┐
│ Good afternoon   6 done ✓ │  ← 28px, merged into one line
│ ╭────────────────────────╮ │
│ │ what's on your mind… 🎙│ │  ← 64px
│ ╰────────────────────────╯ │
│ ⚠3  🤖2  👤4  ✨4  🔔6    │  ← 36px, horizontally scrollable, tap = expand
│ ─────────────────────────  │
│ All │ Unfiled │ Decide  ⣿ │  ← 32px views + density
│ ── Now ───────────────────│
│ 💡 Pricing idea      2m ›│  ← 40px compact rows
│ ☑ Call the vet       8m ›│
│ ── Earlier today ─────────│
│ 📄 Compliance      10:04 ›│
│ 🔗 usda.gov/organ…  9:12 ›│
│ ☑ Order seed trays  8:40 ›│
│ 💡 Note for Janine  8:02 ›│
│ …                          │
├────────────────────────────┤
│  Tasks │ Stream │ Notes │ ⋯│
└────────────────────────────┘
```

Rail cards appear **below** the stream on mobile, collapsed by default, in
priority order (In flight → People → Discovered → Agents). Not a separate tab:
a tab would hide them from the people who need them most, and the panel's mobile
voice was explicit that scrolling is cheaper than remembering.

### 6.3 The density gain, arithmetic

**Desktop 1080p (960px content height):**

| | Current | v2 (Compact) |
|---|---|---|
| Greeting | 56px | 0 (merged into bar) |
| Brain Bar | 120px | 72px |
| Needs You | 34px | 40px |
| CRM quiet line | 28px | 0 (moved to rail) |
| Views + density | 34px | 32px |
| **Chrome** | **272px** | **144px** |
| Available | 688px | 816px |
| Row height | 88px | 40px (+ group heads) |
| **Items in main column** | **≈7** | **≈18** |
| **Items in rail** | 0 | **≈8–10** |
| **Total addressable** | **≈7** | **≈26–28** |

**Mobile (660px content height):** chrome 244px → 160px; rows 88px → 40px;
**≈4–5 → ≈12–13**.

Comfortable density preserves today's card exactly, for users who prefer it.
The default is Compact on desktop, Cozy on mobile.

---

## 7. Component specifications

### 7.1 `BrainBar` v2 — capture that finishes the job

**Merged with the greeting.** One 72px block: input on the left, `Sun 14 Sep ·
6 done` as a right-aligned muted caption. Saves 56px and one visual stop.

**Slash commands** (R19, Akiflow's lesson). Typing `/` at position 0 opens an
inline menu; everything else still classifies as today:

| Command | Effect |
|---|---|
| `/task`, `/note`, `/journal`, `/thought`, `/link` | Force the destination, skip classification |
| `/remind <natural language>` | Creates a reminder; `/remind tomorrow 9am call the vet` |
| `/ask <text>` | Opens the chat with the text, does not create an item |
| `/find <text>` | Hands off to `UnifiedSearch` |
| `/person <name>` | Logs a CRM touch against a contact |
| `/run <text>` | **R8** — hands the text to the chat with "do this in the background" pre-armed |

**Destination override.** Once classification lands, the type chip becomes a
segmented control: `Thought · Task · Note · Journal`. The AI's guess is
pre-selected. Today, a misclassification can only be corrected by rewriting the
input.

**Post-capture actions (R19).** On success the toast is replaced by an inline
strip on the just-created row, live for 8 seconds:

```
✓ Task created   [ Set a date ] [ File under ▾ ] [ Ask about it ] [ Undo ]
```

These are the `suggestedActions` the classifier already returns, finally wired.
Any suggestion the front end cannot execute is **not rendered** — the current
inert buttons are removed in the same change.

**Paste-a-URL.** On paste of a bare URL, fetch `/api/captures/link/metadata` and
show the resolved title + favicon inline *before* submit, so the user can see
what they are filing.

### 7.2 `NeedsYou` → the Decision Rail (the centrepiece, R4)

Collapsed, it is today's pill row — same discipline, renders nothing at zero.
**Clicking a pill expands it in place** rather than navigating.

```
⚠ 3 overdue   🤖 2 to review   👤 4 to sort   ✨ 4 suggested   🔔 6
└──────────────────────────────────────────────────────────────────┘
  ⚠ Overdue                                       Snooze all ▾   ✕
  ○ Send Northwind the Q3 numbers        2d late   [✓] [→1d] [⋯]
  ○ Reply to the insurance broker       5d late   [✓] [→1d] [⋯]
  ○ Book the compliance audit          11d late   [✓] [→1d] [⋯]
                                                   see all 3 →
```

Rules:

- **One group open at a time.** Opening another closes the first. This is a
  triage sweep, not a dashboard of drawers.
- **Three items shown**, then `see all N →` to the full route. Three is the
  number that fits without pushing the stream below the fold.
- **Inline actions are the decision itself**, per group:

| Group | Source | Inline actions |
|---|---|---|
| Overdue | `tasks` where `due_date < today` | Complete · Snooze 1d/1w · Reschedule · Open |
| To review | `agent_tasks` `awaiting_review` | Approve · Revise (opens chat) · Reject · Open |
| Contacts to sort | `entities` unresolved / merge candidates | Name it · Merge into ▾ · Not a contact · Open |
| Follow-ups due | `entities` `crm.next_action_at` | Log a touch · Snooze · Clear · Open |
| Due today | `tasks` due today | Complete · Snooze · Open |
| **Suggested tasks** *(new)* | `task_recommendations` pending | **Accept · Edit & accept · Reject** |
| Notifications | `notifications` unread | Open · Mark read · Mark all read |
| **System health** *(new, conditional)* | `/api/system-health` | Retry · Copy admin report |

- **Suggested tasks is the flagship addition.** The app already reads your notes
  and extracts tasks from them; that is precisely the "second brain that works
  for you" promise, and today it is a number on a sidebar badge.
- **Every action is optimistic with a 5s undo toast.** Panel consensus: the fear
  tax on irreversible one-key actions is what kills keyboard triage.
- **Keyboard:** `1`–`8` open the corresponding group; inside a group `j`/`k`
  move, `Enter` takes the primary action, `s` snoozes, `e` archives, `Esc`
  collapses.

### 7.3 The Today band (R10)

One 32px row between the Decision Rail and the views. Renders only if it has
something:

```
Today · Sun 14 Sep          3 due · 2 scheduled · journal not started  ▾
```

Expanded: a time-ordered list of everything with a time today — tasks with
due times, reminders, follow-ups — plus a single `Start today's journal →` row
when `daily_notes` has no entry for today. Collapse state persisted.

This is Sunsama's insight at 1/20th the ceremony: the value is *knowing the
shape of the day*, not performing a ritual.

### 7.4 Saved views (R4, replacing chip-only filtering)

The chip row becomes a **view** row. Views are named intents; chips become a
secondary filter *within* a view.

| View | Definition |
|---|---|
| **All** | today's default feed |
| **Unfiled** | items with no project and no tags — the real inbox |
| **Needs a decision** | `waiting` status ∪ awaiting review ∪ unresolved contacts ∪ pending recommendations |
| **Project ▾** | scoped to one project |
| **+** | user-defined: any combination of type / status / project / tag / age, named and saved |

Stored in `users.preferences.streamViews` — same pattern as the models
preference, no migration. Type chips remain, keep the existing earned-chip logic
(only types you have, four visible, `+N` folds the rest), and live *under* the
active view.

### 7.5 `StreamRow` — three densities and an expansion drawer

**Compact (40px, desktop default).** One line:

```
💡  Pricing idea for the CSA boxes          #pricing  Farm   2m   [✓][✨][⋯]
```

icon · title (truncate) · up to 2 metadata chips · relative time · 3 actions.
Actions are **always visible** (R6) with 44px hit areas achieved by negative
margin on a 40px row (R13).

**Cozy (56px, mobile default).** Adds a one-line content preview.

**Comfortable (88px).** Today's card, unchanged, for users who want it.

**The expansion drawer (R12, R14).** `→` or click expands *in place*:

```
┌──────────────────────────────────────────────────────────────┐
│ 💡 Pricing idea for the CSA boxes            Thought · 2m ago │
│                                                               │
│ What if the CSA tiers were priced by pickup frequency rather  │
│ than box size? Weekly pickups are the ones that actually cost │
│ us labour…                                                    │
│                                                               │
│ 🏷 #pricing #csa      📁 Farm operations      ✍ 2 highlights   │
│                                                               │
│ Related ─────────────────────────────────────────────────────│
│  · CSA renewal numbers 2026          92% similar          →   │
│  · Labour cost per pickup            87% similar          →   │
│                                                               │
│ [ Make it a task ] [ Expand into a note ] [ Ask about this ]  │
│ [ File under ▾ ]   [ Archive ]            [ Open full page ]  │
└──────────────────────────────────────────────────────────────┘
```

- **Related notes** come from `/api/embeddings/similar`, fetched lazily on first
  expansion and cached. This is the knowledge graph finally doing visible work.
- **Highlights count** links to the annotation intents already in the note body.
- **Type-aware action bars:**

| Type | Primary actions |
|---|---|
| thought / capture | Make it a task · Expand into a note · Ask about this |
| task | Complete · Reschedule · Add subtask · Ask about this |
| note | Open · Analyze · Ask about this · Find connections |
| reference / link | Open link · Save excerpt · Ask about this |
| insight | 👍 / 👎 · Act on it · Dismiss |
| agent_output | Approve · Revise · Reject · Save as note |
| reminder | Done · Snooze · Reschedule |
| journal | Open journal · Ask about this |

- A11y: `aria-expanded` on the row, drawer is `role="region"` labelled by the
  row title, focus moves to the drawer's first control, `Esc` collapses and
  restores focus to the row.

**Time grouping (R22).** Sticky subheads: `Now` (<1h) · `Earlier today` ·
`Yesterday` · `This week` · `Earlier`. A **"— since you were last here —"**
divider is drawn at the position matching `users.last_seen_at`, which is what the
Returner asked for. Group collapse state persisted.

**Multi-select.** `x` toggles selection, `shift+click` selects a range, a bulk
bar rises from the bottom: Archive · Tag · Move to project · Convert to task ·
Complete. `use-bulk-select` already exists and is already used by the Work page.

### 7.6 Rail card: Agents & background work (R7, R8, R9)

The card the agentic-UX voice cared most about. Currently the *only* signal the
user gets about background work is `SystemHealthIndicator`, which by design
renders nothing unless something is broken.

```
╭─ Working ────────────────────────── ▾ ╮
│ ▸ copy · CSA newsletter draft         │
│   ▓▓▓▓▓▓░░░░  started 3m ago  [stop]  │
│ ▸ queue · 12 notes embedding          │
│   ▓▓▓▓▓▓▓▓░░  ~40s                    │
├───────────────────────────────────────┤
│ ✓ insights generated        2h ago    │
│ ✓ heartbeat · 3 checks      15m ago   │
│ ✗ research agent failed      1h [↻]   │
╰───────────────────────────────────────╯
```

- Live section (`agent_tasks` in `processing`/`queued`, `processing_queue` in
  flight) with a **stop** control — interruptibility as a first-class pattern.
- Completed section, last 24h, so success is visible and not only failure.
- Failures inherit the existing `diagnoseError` diagnosis and retry action —
  reuse `system-health`, do not duplicate it.
- **R8 — starting background work.** No new form. The chat gains a "run this in
  the background" affordance on any message: it enqueues an `agent_task` via the
  existing router and executor, and the run appears in this card. Conversation
  stays the default; delegation becomes an escalation *from* conversation, which
  is what the folding of delegation into chat should have left behind.

### 7.7 Rail card: Discovered (R11, R12)

```
╭─ Discovered ─────────────────────── ▾ ╮
│ ✨ Three notes on pricing just linked │
│    Pricing idea · CSA renewal · …     │
│                        👍 👎  explore →│
│ ✨ Northwind appears in 6 notes this    │
│    month — up from 1                  │
│                        👍 👎  open   → │
╰───────────────────────────────────────╯
```

Sources: `insights` (already ranked and deduped by the insight-quality
pipeline), `note_connections` created in the last 7 days, and entity mention
velocity from `entity_mentions`. 👍/👎 write to `PUT /api/insights` —
**the feedback loop that already exists in the backend and has no UI anywhere.**

### 7.8 Rail cards: In flight, People, Pinned

- **In flight** — active projects with a health dot (`/api/projects/[id]/health`),
  last activity, and the single next action. Click scopes the stream to that
  project rather than navigating.
- **People** — `CrmPulseCard`, moved here essentially as-is, plus a `+ log a
  touch` quick action. It belongs in the rail, not in the main column.
- **Pinned** — `PinnedNotesStrip`, moved out of the sidebar so the sidebar is
  purely navigation.

---

## 8. The interaction model

### 8.1 Keyboard (R5)

The current dashboard has no keyboard model at all. Proposed, Linear-compatible:

| Key | Action |
|---|---|
| `j` / `k` or `↓` / `↑` | Move between rows |
| `→` / `Enter` | Expand row · `←` / `Esc` collapse |
| `o` | Open full page |
| `✓` via `Space` | Complete (tasks) |
| `e` | Archive |
| `s` | Snooze (menu: 1h / tonight / tomorrow / next week) |
| `a` | Ask about this (opens chat pinned to the row) |
| `x` | Toggle selection · `shift+j/k` extend |
| `1`–`8` | Open the corresponding Decision Rail group |
| `d` | Cycle density |
| `g` then `s`/`t`/`r`/`p`/`n` | Go to Stream / Tasks / Review / People / Notes |
| `/` | Focus the Brain Bar · `Cmd+K` keeps UnifiedSearch |
| `?` | Shortcut sheet |
| `Cmd+Z` | Undo the last action (5s window) |

Every shortcut has a visible equivalent. Keyboard is an accelerator, never the
only path (R13).

### 8.2 Touch (R21)

- **Swipe right** on a row → complete (task) / archive (everything else)
- **Swipe left** → snooze menu
- **Long press** → multi-select mode
- **Tap** → expand in place. **Chevron** → full page.
- `use-swipe` exists and is already proven in the calendar views.

### 8.3 Undo

Every destructive or state-changing action is optimistic and emits a `sonner`
toast with an `Undo` action for 5 seconds. Actions queue; `Cmd+Z` pops the stack.
This is what makes one-key triage psychologically affordable.

---

## 9. Reducing lift across the rest of the app

The user's brief was explicit that this is not only about the dashboard. These
are the highest-leverage reductions found while reading the surrounding code.

### 9.1 Bugs to fix first (P0 — these precede any redesign)

**Status: shipped 2026-09-14.** Five bugs, not four — B5 was found while fixing B1.

| # | Issue | Location | Fix |
|---|---|---|---|
| B1 | **Archive does not persist.** Filters local state, calls no API. Item returns on refresh. | `stream-feed.tsx:189` | Calls `PATCH /api/stream/[id]`, optimistic with rollback |
| B2 | **Reminder dismiss is inert.** `onDismiss` is never passed by `StreamFeed`. | `stream-item-card.tsx:346`, `stream-feed.tsx:308` | Wired to `PATCH /api/reminders/[id]` |
| B3 | **Brain Bar suggested actions are no-ops.** Rendered buttons with an empty handler. | `brain-bar.tsx` | Removed; returns for real as R19 |
| B4 | **`fetchItems` race.** Closes over `offset` and `items.length`; rebuilt every fetch; "Load more" can double-append. | `stream-feed.tsx:97` | Migrated to `useInfiniteQuery` |
| B5 | **The archive endpoint always reported success.** `mutate()` returns `rows[0] ?? null` and an `UPDATE` without `RETURNING` has no rows, so the success flag was permanently `false`; the 404 branch additionally required *all five* statements to throw. Every id — including ids belonging to nobody — got `{success:true}`. Five sequential round trips, too. | `api/stream/[id]/route.ts` | One `db.batch`, decided on summed `rowsAffected`, honest 404 |

**Notes on the fix.** `agent_tasks` is deliberately absent from the archive
batch: archiving agent output means *rejecting* it, which is a review decision
with its own endpoint and side effects. The Archive menu item is now hidden for
`agent_output` rows, and an attempt to archive one 404s instead of pretending.
All three mutations resync on settle, because the filter chips read a
server-computed `counts` that an optimistic patch cannot keep honest.
Regression cover: `tests/app/api/stream/archive.test.ts` (7 tests).

### 9.2 One attention endpoint (R16)

Today: `getStreamStats` (server) + `getCrmPulse` (server) + `useReviewCount` +
`useCrmAttentionCount` + `useInboxCount` + `NeedsYou`'s notifications fetch.
Six code paths, several overlapping queries, no structural guarantee of
agreement.

Replace with **`GET /api/attention`** returning one object: overdue, due today,
awaiting review, contacts to sort, follow-ups due, unread notifications, pending
recommendations, system-health status — each with a count **and** the top 3
items. Consumed by the dashboard (server-rendered, then revalidated), the
sidebar badges, and the mobile "More" dot. One cache key, one truth.

### 9.3 Grammar consistency

The same verb should look the same everywhere. Today it does not:

| Verb | Stream | Tasks | Review | Notes | CRM |
|---|---|---|---|---|---|
| Ask about this | ✓ hover | ✓ | — | — | — |
| Archive | ✓ (broken) | menu | — | menu | — |
| Snooze | — | reschedule | — | — | — |
| Bulk select | — | ✓ | — | — | — |
| Swipe | — | calendar only | — | — | — |

**Extract `useItemActions(item)`** — a hook returning the canonical action set
for any entity, with optimistic mutation, undo and toast built in. Consume it in
`StreamRow`, `WorkTaskRow`, `ReviewView`, the notes list and the CRM list. This
is the single change that makes the whole app feel like one product, and it
deletes a lot of duplicated mutation code.

### 9.4 Other reductions

- **Expansion everywhere.** The drawer pattern is not dashboard-specific. Notes
  list, tasks list and CRM list should all expand in place with the same
  component.
- **Empty-state → first-run.** A brand-new user sees "Your mind is clear" and an
  input. Instead, seed the rail with three real first actions (`Capture your
  first thought`, `Connect your calendar`, `Import from Obsidian` — the import
  route already exists).
- **Journal has no home presence** beyond being a feed row. The Today band's
  `Start today's journal →` closes that.
- **Skills have no UI at all.** Eight registered skills, an executor, an audit
  log, three API routes, zero surfaces. Minimum viable: expose `daily_digest` and
  `auto_triage_captures` as Decision Rail actions ("Triage 14 unprocessed
  captures").
- **Settings depth.** AI Models, MCP keys, guardrails, notification preferences
  and themes are all in one page. Not in scope here, but the rail's "Agents"
  card should deep-link into the model/agent settings when something is
  misconfigured.

---

## 10. Data and API plan

**No new tables. No migration.** Preferences ride in `users.preferences` JSON,
exactly as the model-selection feature does.

| Need | Status |
|---|---|
| Stream items, counts | `GET /api/stream` — **needs**: `groupBy=time`, cursor pagination, a `view` param |
| Attention counts + top items | **New** `GET /api/attention` (§9.2) — composes existing queries |
| Related notes in the drawer | `GET /api/embeddings/similar` — exists |
| Insights + feedback | `GET/PUT /api/insights` — exists, unused by the UI |
| Recent connections | `GET /api/connections`, `GET /api/graph` — exist |
| Task recommendations | `GET /api/tasks/recommendations`, `/[id]` accept/reject — exist |
| Project health | `GET /api/projects/[id]/health` — exists; **needs** a batch variant |
| Background work | **New** `GET /api/work/live` — composes `agent_tasks` + `processing_queue` + `skill_executions` + `heartbeat_logs` |
| Stop a running agent | **New** `POST /api/agent-tasks/[id]/stop` |
| Start background work from chat | Existing `POST /api/delegate` + executor; new UI affordance only |
| Snooze | `POST /api/tasks/[id]/reschedule` — exists |
| Archive (fixing B1) | `PATCH /api/captures/[id]`, `/api/notes/[id]`, `/api/tasks/[id]` — exist |
| Preferences | `users.preferences.stream = { density, views, railCollapsed, groupsCollapsed }` |

New endpoints: **three**. Everything else is composition.

**Performance contract (R17):** the page's server component renders the Brain
Bar, Decision Rail and the first stream page. Each rail card is its own
`Suspense` boundary with a skeleton. No rail card is on the LCP path.

---

## 11. Phasing

Each phase ships independently and is independently valuable.

### Phase 0 — Fix what lies ✅ *shipped 2026-09-14*
B1–B5 from §9.1. Nothing else should be built on top of an archive button that
does not archive. Build passes; suite went 1084 → 1091 passing with no new
failures.

### Phase 1 — Density ✅ *shipped 2026-09-14*
- Greeting merged into the bar's line (R1) — ~56px → ~28px
- `contentWidthClass` in `src/lib/navigation.ts`; the dashboard route only (R2)
- Three densities, remembered per device (R3)
- Time buckets, sticky headings, "since you were last here" (R22)
- Actions always visible, 44px on touch at every density (R6, R13)

**Two deliberate deviations from the spec above.**

1. **R2 stops at `max-w-6xl` (1152px) rather than going full-bleed.** Nothing
   occupies the far right until the rail lands, and a 1600px row with a title at
   one end and a timestamp at the other is worse than a narrow one. This is open
   question 5, answered incrementally; Phase 3 takes the rest.
2. **R6 went wider than written.** Actions are always visible at *every*
   density, not only Compact. "Comfortable" is a statement about row height, not
   a reason to hide controls behind hover — which the panel identified as the
   single worst pattern on the current dashboard.

**A bug fell out of it.** `StreamItemCard` called `new Date(item.updatedAt)`
directly. SQLite's `datetime('now')` yields `YYYY-MM-DD HH:MM:SS` with no zone
marker and V8 reads that as *local* time, so every timestamp was skewed by the
viewer's UTC offset — east of Greenwich "5 hours ago" could render as a future
time, and a row could land in the wrong bucket. `CrmPulseCard` already
normalised this; the stream card never had. Now centralised as
`parseDbTimestamp` in `src/lib/stream/grouping.ts`, with tests.

**Storage.** Density and last-visit are `localStorage`, not `users.preferences`.
Density describes the *screen* — the same person wants compact rows on a 27"
monitor and cozy ones on a phone, and syncing it would make each device fight
the other. Last-visit has no column to live in and the device-local answer is
the one the question actually asks. Both read through `useSyncExternalStore`
rather than an effect, so neither costs a cascading render.

**Verification.** `tsc` clean in `src/`; `eslint` clean on all ten changed
files; `npm run build` exit 0; 51 tests passing across the six suites that
touch any of it (`stream/grouping`, `stream/density`, `navigation`,
`use-ask-about`, `dashboard-layout`, `stream/archive`) — 38 of them new.

### Phase 2 — Act where you are (5–8 days) · *the requested "reduce user lift"*
- Decision Rail expand-in-place, all groups incl. Suggested tasks (R4)
- The expansion drawer with related notes and type-aware action bars (R12, R14)
- `useItemActions` with optimistic mutation + undo (§9.3)
- Full keyboard model (R5) and swipe actions (R21)
- `GET /api/attention` and the consolidation of all six counters (R16)

### Phase 3 — The rail (5–8 days) · *the requested "lead the category"*
- Two-column layout ≥1280px, mobile fold-below
- In flight · People · Discovered · Agents · Pinned (R7, R11, R18)
- Insight feedback loop wired to its existing backend
- `GET /api/work/live`, agent stop control

### Phase 4 — Ritual & views (3–5 days)
- Today band (R10)
- Saved views incl. user-defined (R4)
- First-run rail (§9.4)
- "Run in the background" from chat (R8)

---

## 12. Success metrics

Instrument before Phase 1 so the baseline is real.

| Metric | Now (est.) | Target | How |
|---|---|---|---|
| Items visible on first paint, desktop | 7 | ≥18 | Layout measurement |
| Items visible on first paint, mobile | 4–5 | ≥12 | Layout measurement |
| **Actions taken without leaving `/`** | ~0 | ≥60% of all item actions | Event: action + route |
| Navigations per session | baseline | −40% | Route-change count |
| Time to clear the attention queue | baseline | −50% | First-view → all-groups-zero |
| Task recommendation accept rate | unknown (no surface) | measurable at all | `task_recommendations.status` |
| Insight feedback events / week | 0 (no surface) | >0, then rising | `insights.feedback` writes |
| Keyboard action share, desktop | 0% | ≥25% | Input modality on action events |
| Agent runs visible before completion | 0% | 100% | Rail card impressions |
| Dashboard LCP | baseline | no regression | Vercel Web Analytics |

The third row is the one that matters. It is the operational definition of
"desk, not launcher."

---

## 13. Non-goals, risks, open questions

### Non-goals
- Not reviving the delegate dialog. R8 is an escalation *from* chat, not a form.
- Not a calendar. The Today band lists what is due; it does not draw a day grid.
- Not a new data model. No tables, no migration.
- Not changing the Stream's unified-feed premise. Grouping and ranking change;
  the UNION query stays.
- Not touching the note editor, Settings or the MCP surface.

### Risks

| Risk | Mitigation |
|---|---|
| **Density becomes noise.** The failure mode of every dashboard redesign. | The empty-rendering discipline (principle 5) is preserved and extended to every new card. A quiet day still looks quiet. Compact is a *default*, not a mandate. |
| **The rail becomes a graveyard of dead widgets.** | Every rail card renders nothing when it has nothing. A card that is empty for a week for most users gets deleted, not shrunk. |
| **Mobile regresses.** Two-column thinking usually costs the phone. | Mobile is specified first in §6.2 and has its own budget arithmetic. Rail folds below, never behind a tab. |
| **Expand-in-place fights the router.** Deep links, back button, scroll restoration. | Expansion state lives in the URL hash (`#item=<id>`), so back collapses and a link opens expanded. |
| **Scope.** Four phases is a lot. | Each phase ships alone. Phase 1 alone delivers the density ask; Phase 2 alone delivers the lift ask. |
| **Optimistic UI diverges from the server.** | `useItemActions` reconciles on settle and rolls back on error with an explicit toast. Never silent. |

### Open questions

1. **Compact by default, or Cozy?** Compact triples density but drops the content
   preview, which is how thoughts are recognised. Recommend shipping Compact as
   default with a one-time inline hint, and reading the density-toggle telemetry
   after two weeks.
2. **Three items per Decision Rail group, or five?** Three keeps the stream above
   the fold. Five clears more per sweep. Cheap to A/B.
3. **Should the rail be reorderable?** Powerful, but it is per-user state and a
   drag surface. Recommend deferring past Phase 3.
4. **Real user research.** §3 is composite. Before Phase 2 locks the action
   vocabulary, five 20-minute sessions watching people triage would either
   confirm the group ordering or reorder it cheaply. This is the single highest
   value-per-hour item in the document.
5. **How wide is too wide?** Breaking `max-w-4xl` on an ultrawide display could
   produce a 1200px stream column with 40px rows — a very long line length for
   titles. Recommend capping the *main* column at ~760px and letting the rail
   and the gutter absorb the rest, but this wants eyes on a real 34" monitor
   before it is fixed.

---

## 14. Requirement index

| ID | Requirement | Phase |
|---|---|---|
| R1 | Delete decorative chrome; merge greeting into the bar | 1 |
| R2 | Break `max-w-4xl` on the dashboard route only | 1 |
| R3 | Density as a persisted user control (Compact/Cozy/Comfortable) | 1 |
| R4 | Expand-in-place triage + saved views | 2, 4 |
| R5 | Full keyboard model over the feed | 2 |
| R6 | Actions always visible at Compact density | 1 |
| R7 | Background-work rail card showing success, not only failure | 3 |
| R8 | "Run in the background" as a chat escalation | 4 |
| R9 | Provenance + one-key accept/reject on agent output | 2 |
| R10 | Today band | 4 |
| R11 | Discovered rail card with the insight feedback loop wired | 3 |
| R12 | Related notes inside the expansion drawer | 2 |
| R13 | ≥44px targets at every density | 1 |
| R14 | Full a11y contract on expansion | 2 |
| R15 | DOM order = priority order (stream before rail) | 3 |
| R16 | One `/api/attention` endpoint | 2 |
| R17 | Rail cards stream independently; none blocks LCP | 3 |
| R18 | People rail card with names and log-a-touch | 3 |
| R19 | Post-capture actions that actually execute | 1 |
| R20 | Mobile-first vertical budget | 1 |
| R21 | Swipe actions on rows | 2 |
| R22 | Time-bucketed grouping + "since you were last here" | 1 |
