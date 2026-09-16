# Playwright UX Audit — Design Document

**Date:** 2026-02-25
**Goal:** One-time UX audit report identifying pain points, dead ends, UI issues, and missing features across the brain-portal app using Playwright automation.

---

## Context

The app has 41 unit/integration tests (Vitest) but zero end-to-end or UI tests. This audit fills that gap with targeted scripts that walk real user journeys, capture findings, and produce an actionable report.

**Priority areas (user-selected):**
1. Core flows — notes, tasks, projects
2. Mobile responsiveness — 375px and 768px viewports
3. AI/Agent features — quick capture, delegation, review workflow

**Auth strategy:** Seed a test session cookie directly into the DB, inject it into the Playwright browser context. No email flow needed.

---

## Directory Structure

```
tests/audit/
  setup/
    auth.ts           # Read user from DB, insert session, return cookie
    fixtures.ts       # Playwright fixtures: authed page, page with console capture
    seed.ts           # Create test notes, tasks, projects for auditing
  flows/
    notes.audit.ts
    tasks.audit.ts
    projects.audit.ts
    captures.audit.ts
    agents.audit.ts
  responsive/
    mobile.audit.ts   # 375px + 768px
  reporter/
    generate.ts       # Merge all JSON findings → report.html + report.md
  playwright.config.ts
  findings/           # gitignored, auto-generated
    screenshots/
    notes.json
    tasks.json
    projects.json
    captures.json
    agents.json
    mobile.json
    report.html
    report.md
```

---

## Finding Schema

```ts
interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  type:
    | 'js-error'        // console errors during interaction
    | 'network-error'   // failed API/fetch calls
    | 'dead-end'        // user cannot complete an action
    | 'broken-ui'       // element missing, misaligned, overflowing
    | 'ux-friction'     // confusing flow, unclear feedback, extra steps
    | 'missing-feature' // expected feature not present
    | 'empty-state'     // unhandled empty state (no message, no CTA)
    | 'mobile-issue'    // layout/touch problem at small viewport
    | 'visual-bug'      // cosmetic rendering problem
  domain: string        // 'notes' | 'tasks' | 'projects' | 'captures' | 'agents' | 'mobile'
  page: string          // URL path at time of finding
  description: string   // what is wrong
  screenshot?: string   // relative path under findings/screenshots/
  suggestion?: string   // UX recommendation
}
```

**Severity guide:**
- `critical` — user cannot complete the core action (broken flow)
- `high` — major friction, workaround needed
- `medium` — noticeable friction, degrades experience
- `low` — polish issue, minor annoyance
- `info` — neutral observation worth noting

---

## Audit Scripts

### `flows/notes.audit.ts`
- Visit `/notes` — check empty state messaging and CTA
- Filter by all/daily/regular tabs — check each renders correctly
- Navigate to `/notes/new` — check editor loads without console errors
- Type content — verify auto-save status indicator appears and updates
- Check formatting toolbar — all buttons visible and clickable
- Open attachment side panel (desktop) — verify it renders
- Open share dialog — verify share link generation flow
- Navigate to an existing note by slug — verify content loads
- Check note connections section — verify it appears with data or handles empty state
- Check for broken images or layout overflow

### `flows/tasks.audit.ts`
- Visit `/tasks` — check list view loads
- Switch to calendar view — verify week grid renders, no layout overflow
- Switch to kanban — verify columns render
- Open task create dialog — check all fields (title, description, priority, due date, recurrence, project)
- Check date picker opens and selects correctly
- Check recurrence picker — cycle through options
- Complete a task — verify status update and visual feedback
- Multi-select tasks — verify bulk action toolbar appears
- Check empty states for each view (list/calendar/kanban with no tasks)
- Attempt drag-to-reschedule in calendar — note feedback quality

### `flows/projects.audit.ts`
- Visit `/projects` — check project tree renders, expand/collapse works
- Open project create dialog — fill and submit
- Navigate to project detail page — check all sections:
  - Stats card (notes/tasks/captures counts)
  - Health card (AI summary + rule checks)
  - Activity timeline
  - Captures associated with project
  - Subprojects tree
  - Task recommendations
- Check for any broken/missing data sections
- Check empty states on new project (no notes, no tasks yet)

### `flows/captures.audit.ts`
- Open UnifiedSearch via keyboard (`Meta+K`) — verify overlay appears
- Check quick actions displayed when search is empty
- Type a search query — verify results appear
- Open Quick Capture via keyboard (`Meta+Shift+C`) — verify overlay appears
- Create a thought capture — verify save feedback
- Create a link capture with a URL — verify metadata scraping indicator
- Check dashboard for capture appearing in insights feed
- Verify capture categorization display (thought/insight/link badge)

### `flows/agents.audit.ts`
- Visit `/agents` — check queue/dashboard renders
- Check empty state when no agent tasks
- Create a task, then open delegate dialog
- Select agent type — verify all 6 agents listed
- Add instructions — verify form validation
- Submit delegation — verify task enters queue
- Check agent review panel renders with task
- Attempt approve/revise/reject actions — note feedback
- Check "Save as Note" dialog if an approved task exists

### `responsive/mobile.audit.ts`
- **375px viewport (iPhone SE):** visit dashboard, notes, tasks, projects, agents
  - Verify bottom nav renders with 5 items + FAB
  - Verify FAB is accessible and triggers capture
  - Open task create — verify sheet (not dialog) renders
  - Open note create — verify editor is usable
  - Measure touch target sizes via bounding rects (flag anything < 44px)
  - Check for horizontal overflow on each page
  - Check sidebar is hidden
- **768px viewport (iPad):**
  - Verify layout transitions correctly (may show sidebar or not)
  - Check dialogs vs sheets behavior
  - Check calendar/kanban views at tablet width

---

## Report Generator

`reporter/generate.ts` reads all `findings/*.json` files and produces:

**`report.md`:**
- Summary table: findings count by domain and severity
- Grouped sections per domain, sorted by severity desc
- Each finding: severity badge, type, page, description, suggestion, screenshot path

**`report.html`:**
- Same structure with screenshots inline (base64 or relative src)
- Color-coded severity badges (red/orange/yellow/blue/gray)
- Collapsible sections per domain
- Total finding count in header

---

## Auth Setup

`setup/auth.ts`:
1. Connect to Turso DB using env vars
2. Query `SELECT id, email FROM users LIMIT 1`
3. Generate a session ID (crypto.randomUUID)
4. Insert into `sessions` table with 24h expiry
5. Return `{ sessionId, userId }` for cookie injection

`fixtures.ts`:
- Playwright `test.extend` fixture `authedPage`
- Before each test: call `createTestSession()`, set `session` cookie on browser context
- After: delete test session from DB

---

## Running the Audit

```bash
# Install Playwright (one-time)
npx playwright install chromium

# Run all audit scripts
npx playwright test tests/audit/ --headed

# Run a specific domain
npx playwright test tests/audit/flows/notes.audit.ts --headed

# Generate report from existing findings
npx tsx tests/audit/reporter/generate.ts
```

Output in `tests/audit/findings/` — open `report.html` in browser.

---

## Success Criteria

The audit is complete when:
1. All 6 scripts run without crashing
2. Each script produces a `findings/*.json` file
3. `report.html` and `report.md` are generated
4. At least the core happy paths have been walked for notes, tasks, projects, captures, and agents
5. Mobile audit has covered all major pages at 375px
