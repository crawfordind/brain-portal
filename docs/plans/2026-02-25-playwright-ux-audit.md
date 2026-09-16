# Playwright UX Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a suite of Playwright audit scripts that walk every major user flow in brain-portal, record findings (screenshots + structured JSON), and generate a single HTML + Markdown report of UI issues, dead ends, and missing features.

**Architecture:** Domain-specific scripts in `tests/audit/flows/` each walk one feature area end-to-end. A shared fixtures file injects a seeded session cookie so no email auth is needed. A reporter merges all JSON findings into `report.html` and `report.md`.

**Tech Stack:** Playwright (headed Chromium), Node.js crypto (SHA256 session hashing), @libsql/client (Turso DB access for auth seed), tsx for running TypeScript scripts directly.

---

## Auth Context (READ FIRST)

The app stores sessions in the `sessions` table with a **hashed** token:
- Cookie name: `brain_session`
- Cookie value: **raw** 32-byte hex token (e.g. `abc123...`)
- DB `sessions.token`: SHA256 hash of the raw token
- To seed: generate raw token → SHA256 hash it → insert hash into DB → set raw token as cookie

---

## Task 1: Install Playwright

**Files:**
- Modify: `package.json` (add script)

**Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Expected output: Chromium downloaded to `~/.cache/ms-playwright/`

**Step 2: Add audit script to package.json**

In `package.json`, add to `"scripts"`:
```json
"audit": "playwright test tests/audit/ --headed --reporter=list",
"audit:report": "tsx tests/audit/reporter/generate.ts"
```

**Step 3: Create the findings output directory and gitignore it**

```bash
mkdir -p tests/audit/findings/screenshots
echo "tests/audit/findings/" >> .gitignore
```

**Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: install Playwright and add audit scripts"
```

---

## Task 2: Playwright Config

**Files:**
- Create: `tests/audit/playwright.config.ts`

**Step 1: Create the config file**

```ts
// tests/audit/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './',
  testMatch: '**/*.audit.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: false,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  reporter: 'list',
})
```

**Step 2: Verify config is picked up**

```bash
npx playwright test --config tests/audit/playwright.config.ts --list
```

Expected: "No tests found" (no scripts yet) — that's fine.

**Step 3: Commit**

```bash
git add tests/audit/playwright.config.ts
git commit -m "chore: add Playwright config for UX audit"
```

---

## Task 3: Auth Seed Utility

**Files:**
- Create: `tests/audit/setup/auth.ts`

**Step 1: Create the auth seed file**

```ts
// tests/audit/setup/auth.ts
import { createClient } from '@libsql/client'
import { randomBytes, createHash } from 'crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

export const SESSION_COOKIE_NAME = 'brain_session'

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createTestSession(): Promise<{
  rawToken: string
  userId: string
  cleanup: () => Promise<void>
}> {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // Get first user in DB
  const result = await db.execute('SELECT id, email FROM users LIMIT 1')
  if (result.rows.length === 0) {
    throw new Error(
      'No users found in DB. Create a user account first by logging in once.'
    )
  }

  const user = result.rows[0]
  const userId = user.id as string

  const rawToken = generateToken()
  const hashedToken = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() // 24h

  await db.execute({
    sql: 'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)',
    args: [userId, hashedToken, expiresAt],
  })

  const cleanup = async () => {
    await db.execute({
      sql: 'DELETE FROM sessions WHERE token = ?',
      args: [hashedToken],
    })
    db.close()
  }

  return { rawToken, userId, cleanup }
}
```

**Step 2: Verify it can connect (dry run)**

The dev server must be running and a user must exist. Run:
```bash
npx tsx -e "import('./tests/audit/setup/auth.ts').then(m => m.createTestSession()).then(s => { console.log('userId:', s.userId); s.cleanup(); })"
```

Expected: prints `userId: <some-hex-id>` with no errors.

If you get "No users found": open the app at http://localhost:3000 and log in once via magic link to create a user record.

**Step 3: Commit**

```bash
git add tests/audit/setup/auth.ts
git commit -m "chore: add test session seed utility for Playwright auth"
```

---

## Task 4: Shared Playwright Fixtures

**Files:**
- Create: `tests/audit/setup/fixtures.ts`
- Create: `tests/audit/setup/findings.ts`

**Step 1: Create the findings helper**

```ts
// tests/audit/setup/findings.ts
import * as fs from 'fs'
import * as path from 'path'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type FindingType =
  | 'js-error'
  | 'network-error'
  | 'dead-end'
  | 'broken-ui'
  | 'ux-friction'
  | 'missing-feature'
  | 'empty-state'
  | 'mobile-issue'
  | 'visual-bug'

export interface Finding {
  severity: Severity
  type: FindingType
  domain: string
  page: string
  description: string
  screenshot?: string
  suggestion?: string
}

const FINDINGS_DIR = path.join(process.cwd(), 'tests/audit/findings')
const SCREENSHOTS_DIR = path.join(FINDINGS_DIR, 'screenshots')

export function ensureDirs() {
  fs.mkdirSync(FINDINGS_DIR, { recursive: true })
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
}

export function saveFindings(domain: string, findings: Finding[]) {
  ensureDirs()
  const file = path.join(FINDINGS_DIR, `${domain}.json`)
  fs.writeFileSync(file, JSON.stringify({ domain, findings, generatedAt: new Date().toISOString() }, null, 2))
  console.log(`\n📋 ${domain}: ${findings.length} findings saved to ${file}`)
}

export function screenshotPath(domain: string, name: string): string {
  ensureDirs()
  return path.join(SCREENSHOTS_DIR, `${domain}-${name}.png`)
}
```

**Step 2: Create the Playwright fixtures**

```ts
// tests/audit/setup/fixtures.ts
import { test as base, expect, Page } from '@playwright/test'
import { createTestSession, SESSION_COOKIE_NAME } from './auth'
import { Finding, ensureDirs } from './findings'

type AuditFixtures = {
  authedPage: Page
  consoleErrors: string[]
  networkErrors: string[]
  findings: Finding[]
}

export const test = base.extend<AuditFixtures>({
  consoleErrors: async ({}, use) => {
    const errors: string[] = []
    await use(errors)
  },

  networkErrors: async ({}, use) => {
    const errors: string[] = []
    await use(errors)
  },

  findings: async ({}, use) => {
    const items: Finding[] = []
    await use(items)
  },

  authedPage: async ({ browser, consoleErrors, networkErrors }, use) => {
    ensureDirs()
    const { rawToken, cleanup } = await createTestSession()

    const context = await browser.newContext()
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: rawToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ])

    const page = await context.newPage()

    // Capture console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()} @ ${page.url()}`)
      }
    })

    // Capture network errors
    page.on('requestfailed', (req) => {
      networkErrors.push(`[NET FAIL] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
    })

    await use(page)

    await context.close()
    await cleanup()
  },
})

export { expect }
```

**Step 3: Commit**

```bash
git add tests/audit/setup/findings.ts tests/audit/setup/fixtures.ts
git commit -m "chore: add Playwright fixtures and findings helper"
```

---

## Task 5: Notes Audit Script

**Files:**
- Create: `tests/audit/flows/notes.audit.ts`

**Step 1: Create the notes audit script**

```ts
// tests/audit/flows/notes.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Notes: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Notes list page ──────────────────────────────────
  await page.goto('/notes')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('notes', '01-list') })

  // Check page title visible
  const heading = page.getByRole('heading').first()
  if (!(await heading.isVisible())) {
    findings.push({ severity: 'high', type: 'broken-ui', domain: 'notes', page: '/notes', description: 'No visible heading on /notes page.', screenshot: screenshotPath('notes', '01-list') })
  }

  // Check for empty state messaging
  const noteLinks = page.locator('a[href*="/notes/"]')
  const noteCount = await noteLinks.count()
  if (noteCount === 0) {
    // Empty state — look for a CTA
    const cta = page.getByRole('link', { name: /new note|create/i })
    if (!(await cta.isVisible())) {
      findings.push({ severity: 'high', type: 'empty-state', domain: 'notes', page: '/notes', description: 'Notes list is empty with no visible CTA to create the first note.', screenshot: screenshotPath('notes', '01-list'), suggestion: 'Add an empty state component with a "Create your first note" button.' })
    }
  }

  // Check filter tabs (all / daily / regular)
  const tabs = page.getByRole('tab')
  const tabCount = await tabs.count()
  if (tabCount < 2) {
    findings.push({ severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes', description: `Expected filter tabs (all/daily/regular), found ${tabCount}.`, screenshot: screenshotPath('notes', '01-list') })
  } else {
    // Click each tab and check it doesn't error
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(500)
    }
  }

  // ── 2. New note page ────────────────────────────────────
  await page.goto('/notes/new')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('notes', '02-new') })

  // Check editor loads
  const editor = page.locator('[contenteditable="true"]')
  if (!(await editor.isVisible())) {
    findings.push({ severity: 'critical', type: 'broken-ui', domain: 'notes', page: '/notes/new', description: 'TipTap editor (contenteditable) not visible on /notes/new.', screenshot: screenshotPath('notes', '02-new') })
  }

  // Check toolbar visible
  const toolbar = page.locator('[role="toolbar"], .toolbar, nav button').first()
  if (!(await toolbar.isVisible())) {
    findings.push({ severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes/new', description: 'Formatting toolbar not visible in note editor.', screenshot: screenshotPath('notes', '02-new'), suggestion: 'Ensure toolbar renders immediately, not only on focus.' })
  }

  // Type content and check auto-save
  if (await editor.isVisible()) {
    await editor.click()
    await page.keyboard.type('UX Audit Test Note — checking auto-save behavior')
    await page.waitForTimeout(1500) // wait for debounced auto-save
    await page.screenshot({ path: screenshotPath('notes', '03-typed') })

    // Look for save status indicator
    const saveStatus = page.locator('text=/saved|saving|auto-save/i')
    if (!(await saveStatus.isVisible())) {
      findings.push({ severity: 'medium', type: 'missing-feature', domain: 'notes', page: '/notes/new', description: 'No auto-save status indicator visible after typing.', screenshot: screenshotPath('notes', '03-typed'), suggestion: 'Show "Saving..." / "Saved" status near the editor toolbar.' })
    }

    // Wait for slug to be assigned and navigate back to list
    await page.waitForTimeout(2000)
    const currentUrl = page.url()
    if (currentUrl.includes('/notes/new')) {
      findings.push({ severity: 'medium', type: 'ux-friction', domain: 'notes', page: '/notes/new', description: 'URL still shows /notes/new after typing content — no automatic slug redirect.', screenshot: screenshotPath('notes', '03-typed'), suggestion: 'Redirect to /notes/[slug] once note is saved to allow bookmarking.' })
    }
  }

  // ── 3. Attachment panel (desktop) ──────────────────────
  const attachBtn = page.getByRole('button', { name: /attach|attachment/i }).first()
  if (!(await attachBtn.isVisible())) {
    findings.push({ severity: 'low', type: 'missing-feature', domain: 'notes', page: '/notes/new', description: 'No attachment button visible in note editor at 1280px viewport.', screenshot: screenshotPath('notes', '03-typed') })
  } else {
    await attachBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('notes', '04-attachments') })
    const panel = page.locator('[data-panel="attachments"], .attachment-panel, [aria-label*="attachment"]').first()
    if (!(await panel.isVisible())) {
      findings.push({ severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes/new', description: 'Clicking attachment button did not open the attachment panel.', screenshot: screenshotPath('notes', '04-attachments') })
    }
    // Close it
    await page.keyboard.press('Escape')
  }

  // ── 4. Existing note — slug navigation ─────────────────
  await page.goto('/notes')
  await page.waitForLoadState('networkidle')
  const firstNote = page.locator('a[href*="/notes/"]').first()
  if (await firstNote.isVisible()) {
    const href = await firstNote.getAttribute('href')
    await firstNote.click()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: screenshotPath('notes', '05-detail') })

    // Check editor loads with content
    const noteEditor = page.locator('[contenteditable="true"]')
    if (!(await noteEditor.isVisible())) {
      findings.push({ severity: 'critical', type: 'broken-ui', domain: 'notes', page: href ?? '/notes/[slug]', description: 'Editor not visible on note detail page.', screenshot: screenshotPath('notes', '05-detail') })
    }

    // Check note connections section
    const connections = page.locator('text=/connection|related|similar/i').first()
    if (!(await connections.isVisible())) {
      findings.push({ severity: 'info', type: 'missing-feature', domain: 'notes', page: href ?? '/notes/[slug]', description: 'No note connections / related notes section visible on note detail page.', suggestion: 'Show related notes panel once embeddings are generated.' })
    }

    // Share button
    const shareBtn = page.getByRole('button', { name: /share/i }).first()
    if (!(await shareBtn.isVisible())) {
      findings.push({ severity: 'low', type: 'missing-feature', domain: 'notes', page: href ?? '/notes/[slug]', description: 'Share button not visible on note detail page.' })
    } else {
      await shareBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: screenshotPath('notes', '06-share-dialog') })
      const dialog = page.getByRole('dialog')
      if (!(await dialog.isVisible())) {
        findings.push({ severity: 'medium', type: 'broken-ui', domain: 'notes', page: href ?? '/notes/[slug]', description: 'Share button click did not open share dialog.', screenshot: screenshotPath('notes', '06-share-dialog') })
      }
      await page.keyboard.press('Escape')
    }
  } else {
    findings.push({ severity: 'info', type: 'empty-state', domain: 'notes', page: '/notes', description: 'No existing notes to test note detail page navigation.' })
  }

  // ── 5. Console/network errors ────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'notes', page: page.url(), description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'notes', page: page.url(), description: err })
  }

  saveFindings('notes', findings)
})
```

**Step 2: Run the notes audit (dev server must be running)**

```bash
npx playwright test tests/audit/flows/notes.audit.ts --config tests/audit/playwright.config.ts --headed
```

Expected: browser opens, navigates through notes flow, `tests/audit/findings/notes.json` created.

**Step 3: Commit**

```bash
git add tests/audit/flows/notes.audit.ts
git commit -m "feat(audit): add notes flow audit script"
```

---

## Task 6: Tasks Audit Script

**Files:**
- Create: `tests/audit/flows/tasks.audit.ts`

**Step 1: Create the tasks audit script**

```ts
// tests/audit/flows/tasks.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Tasks: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Task list (default view) ──────────────────────────
  await page.goto('/tasks')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('tasks', '01-list') })

  // Check view switcher tabs exist
  const listTab = page.getByRole('tab', { name: /list/i }).or(page.getByRole('button', { name: /list/i })).first()
  const calendarTab = page.getByRole('tab', { name: /calendar/i }).or(page.getByRole('button', { name: /calendar/i })).first()
  const kanbanTab = page.getByRole('tab', { name: /kanban|board/i }).or(page.getByRole('button', { name: /kanban|board/i })).first()

  for (const [name, tab] of [['List', listTab], ['Calendar', calendarTab], ['Kanban', kanbanTab]] as const) {
    if (!(await (tab as any).isVisible())) {
      findings.push({ severity: 'medium', type: 'missing-feature', domain: 'tasks', page: '/tasks', description: `"${name}" view tab not visible in task view switcher.` })
    }
  }

  // ── 2. Calendar view ─────────────────────────────────────
  if (await calendarTab.isVisible()) {
    await calendarTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: screenshotPath('tasks', '02-calendar') })

    // Check calendar grid renders
    const calGrid = page.locator('[role="grid"], .calendar-grid, table').first()
    if (!(await calGrid.isVisible())) {
      findings.push({ severity: 'high', type: 'broken-ui', domain: 'tasks', page: '/tasks?view=calendar', description: 'Calendar grid not visible after switching to calendar view.', screenshot: screenshotPath('tasks', '02-calendar') })
    }

    // Check for horizontal overflow at 1280px
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    if (overflow) {
      findings.push({ severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks?view=calendar', description: 'Horizontal overflow detected in calendar view at 1280px.', screenshot: screenshotPath('tasks', '02-calendar'), suggestion: 'Constrain calendar columns to viewport width.' })
    }
  }

  // ── 3. Kanban view ───────────────────────────────────────
  if (await kanbanTab.isVisible()) {
    await kanbanTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: screenshotPath('tasks', '03-kanban') })

    const columns = page.locator('[data-column], .kanban-column, [aria-label*="column"]')
    const colCount = await columns.count()
    if (colCount < 2) {
      findings.push({ severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks?view=kanban', description: `Kanban view shows ${colCount} columns, expected at least 2 (pending, done).`, screenshot: screenshotPath('tasks', '03-kanban') })
    }
  }

  // ── 4. Create task dialog ────────────────────────────────
  await listTab.click().catch(() => page.goto('/tasks'))
  await page.waitForTimeout(500)

  const createBtn = page.getByRole('button', { name: /new task|add task|create/i }).first()
  if (!(await createBtn.isVisible())) {
    findings.push({ severity: 'critical', type: 'dead-end', domain: 'tasks', page: '/tasks', description: 'No visible "New Task" / "Add Task" button on /tasks page.', screenshot: screenshotPath('tasks', '01-list'), suggestion: 'Add a prominent CTA button in the page header.' })
  } else {
    await createBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('tasks', '04-create-dialog') })

    const dialog = page.getByRole('dialog')
    if (!(await dialog.isVisible())) {
      findings.push({ severity: 'critical', type: 'broken-ui', domain: 'tasks', page: '/tasks', description: 'Clicking "New Task" button did not open task create dialog.', screenshot: screenshotPath('tasks', '04-create-dialog') })
    } else {
      // Check required fields
      for (const fieldName of ['title', 'description']) {
        const field = dialog.getByLabel(new RegExp(fieldName, 'i')).or(dialog.getByPlaceholder(new RegExp(fieldName, 'i'))).first()
        if (!(await field.isVisible())) {
          findings.push({ severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks', description: `"${fieldName}" field not visible in task create dialog.`, screenshot: screenshotPath('tasks', '04-create-dialog') })
        }
      }

      // Check priority selector
      const priority = dialog.locator('text=/priority/i').first()
      if (!(await priority.isVisible())) {
        findings.push({ severity: 'low', type: 'missing-feature', domain: 'tasks', page: '/tasks', description: 'Priority selector not visible in task create dialog.' })
      }

      // Check due date picker
      const dueDateBtn = dialog.getByRole('button', { name: /due date|date/i }).first()
      if (!(await dueDateBtn.isVisible())) {
        findings.push({ severity: 'medium', type: 'missing-feature', domain: 'tasks', page: '/tasks', description: 'Due date picker button not visible in task create dialog.' })
      } else {
        await dueDateBtn.click()
        await page.waitForTimeout(300)
        const calendar = page.locator('[role="dialog"] [role="grid"]').or(page.locator('.rdp')).first()
        if (!(await calendar.isVisible())) {
          findings.push({ severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks', description: 'Date picker popover did not open after clicking due date button.', screenshot: screenshotPath('tasks', '04-create-dialog') })
        } else {
          await page.keyboard.press('Escape')
        }
      }

      // Check recurrence option
      const recurrence = dialog.locator('text=/recur|repeat/i').first()
      if (!(await recurrence.isVisible())) {
        findings.push({ severity: 'low', type: 'missing-feature', domain: 'tasks', page: '/tasks', description: 'Recurrence picker not visible in task create dialog.' })
      }

      // Fill and submit
      const titleField = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/title|task name/i)).first()
      if (await titleField.isVisible()) {
        await titleField.fill('Audit Test Task')
        const submitBtn = dialog.getByRole('button', { name: /create|save|add/i }).first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
          await page.waitForTimeout(800)
          await page.screenshot({ path: screenshotPath('tasks', '05-after-create') })

          // Check dialog closed (task was created)
          if (await dialog.isVisible()) {
            findings.push({ severity: 'high', type: 'dead-end', domain: 'tasks', page: '/tasks', description: 'Task create dialog did not close after clicking submit — task may not have been created.', screenshot: screenshotPath('tasks', '05-after-create') })
          }
        }
      }
    }
  }

  // ── 5. Complete a task ───────────────────────────────────
  const checkbox = page.locator('[type="checkbox"]').first()
  if (await checkbox.isVisible()) {
    await checkbox.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('tasks', '06-completed') })
    // Check some visual feedback (strikethrough, dim, removed from list)
    const strikethrough = page.locator('s, .line-through, [data-completed="true"]').first()
    if (!(await strikethrough.isVisible())) {
      findings.push({ severity: 'medium', type: 'ux-friction', domain: 'tasks', page: '/tasks', description: 'Completing a task shows no visual strikethrough or completion state.', screenshot: screenshotPath('tasks', '06-completed'), suggestion: 'Apply line-through styling and dim completed tasks.' })
    }
  }

  // ── 6. Bulk select ───────────────────────────────────────
  const taskItems = page.locator('[data-task-id], .task-item, li[role="listitem"]')
  const taskCount = await taskItems.count()
  if (taskCount >= 2) {
    // Shift+click to select multiple
    await taskItems.nth(0).click()
    await page.keyboard.down('Shift')
    await taskItems.nth(1).click()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(400)
    await page.screenshot({ path: screenshotPath('tasks', '07-bulk') })

    const toolbar = page.locator('[data-bulk-toolbar], .bulk-action-toolbar, text=/selected/i').first()
    if (!(await toolbar.isVisible())) {
      findings.push({ severity: 'medium', type: 'ux-friction', domain: 'tasks', page: '/tasks', description: 'Shift+clicking tasks did not surface a bulk action toolbar.', screenshot: screenshotPath('tasks', '07-bulk'), suggestion: 'Show bulk toolbar with count + action buttons when 2+ tasks selected.' })
    }
    // Deselect
    await page.keyboard.press('Escape')
  }

  // ── 7. Console/network errors ─────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'tasks', page: page.url(), description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'tasks', page: page.url(), description: err })
  }

  saveFindings('tasks', findings)
})
```

**Step 2: Run the tasks audit**

```bash
npx playwright test tests/audit/flows/tasks.audit.ts --config tests/audit/playwright.config.ts --headed
```

Expected: `tests/audit/findings/tasks.json` created.

**Step 3: Commit**

```bash
git add tests/audit/flows/tasks.audit.ts
git commit -m "feat(audit): add tasks flow audit script"
```

---

## Task 7: Projects Audit Script

**Files:**
- Create: `tests/audit/flows/projects.audit.ts`

**Step 1: Create the projects audit script**

```ts
// tests/audit/flows/projects.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Projects: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Projects list ─────────────────────────────────────
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('projects', '01-list') })

  // Check project tree renders
  const projectTree = page.locator('[data-project-tree], .project-tree, nav[aria-label*="project"]').first()
  const projectLinks = page.locator('a[href*="/projects/"]')
  const projectCount = await projectLinks.count()

  if (projectCount === 0) {
    // Check empty state has CTA
    const cta = page.getByRole('button', { name: /new project|create/i }).or(page.getByRole('link', { name: /new project/i })).first()
    if (!(await cta.isVisible())) {
      findings.push({ severity: 'high', type: 'empty-state', domain: 'projects', page: '/projects', description: 'No projects and no visible CTA to create the first project.', screenshot: screenshotPath('projects', '01-list'), suggestion: 'Add an empty state with "Create your first project" CTA.' })
    }
  }

  // ── 2. Create project dialog ─────────────────────────────
  const createBtn = page.getByRole('button', { name: /new project|add project|create/i }).first()
  if (!(await createBtn.isVisible())) {
    findings.push({ severity: 'critical', type: 'dead-end', domain: 'projects', page: '/projects', description: 'No visible "New Project" button on /projects page.', screenshot: screenshotPath('projects', '01-list') })
  } else {
    await createBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('projects', '02-create-dialog') })

    const dialog = page.getByRole('dialog')
    if (!(await dialog.isVisible())) {
      findings.push({ severity: 'critical', type: 'broken-ui', domain: 'projects', page: '/projects', description: 'New Project button did not open a dialog.', screenshot: screenshotPath('projects', '02-create-dialog') })
    } else {
      const nameField = dialog.getByLabel(/name/i).or(dialog.getByPlaceholder(/project name/i)).first()
      if (await nameField.isVisible()) {
        await nameField.fill('Audit Test Project')
        const submitBtn = dialog.getByRole('button', { name: /create|save/i }).first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
          await page.waitForTimeout(1000)
          await page.screenshot({ path: screenshotPath('projects', '03-after-create') })
        }
      }
      if (await dialog.isVisible()) {
        findings.push({ severity: 'high', type: 'dead-end', domain: 'projects', page: '/projects', description: 'Project create dialog did not close after submission.', screenshot: screenshotPath('projects', '03-after-create') })
        await page.keyboard.press('Escape')
      }
    }
  }

  // ── 3. Project detail page ───────────────────────────────
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  const firstProject = page.locator('a[href*="/projects/"]').first()
  if (await firstProject.isVisible()) {
    const href = await firstProject.getAttribute('href')
    await firstProject.click()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: screenshotPath('projects', '04-detail') })

    // Check key sections
    const sections = [
      { name: 'Stats card', selector: 'text=/tasks|notes|captures/i' },
      { name: 'Health card', selector: 'text=/health/i' },
      { name: 'Activity timeline', selector: 'text=/activity|timeline/i' },
    ]

    for (const { name, selector } of sections) {
      const el = page.locator(selector).first()
      if (!(await el.isVisible())) {
        findings.push({ severity: 'medium', type: 'missing-feature', domain: 'projects', page: href ?? '/projects/[slug]', description: `"${name}" section not visible on project detail page.`, screenshot: screenshotPath('projects', '04-detail') })
      }
    }

    // Check for broken/empty data sections without messaging
    const capturesSection = page.locator('text=/capture/i').first()
    if (await capturesSection.isVisible()) {
      // Good — section visible
    } else {
      findings.push({ severity: 'info', type: 'empty-state', domain: 'projects', page: href ?? '/projects/[slug]', description: 'No captures section visible on project detail (may be hidden when empty).', suggestion: 'Consider showing empty state for captures with a quick-capture CTA.' })
    }

    // Subprojects
    const subprojects = page.locator('text=/subproject|sub-project/i').first()
    if (!(await subprojects.isVisible())) {
      findings.push({ severity: 'info', type: 'missing-feature', domain: 'projects', page: href ?? '/projects/[slug]', description: 'Subprojects section not visible on project detail page.' })
    }

    // Recommendations
    const recs = page.locator('text=/recommendation|suggest/i').first()
    if (!(await recs.isVisible())) {
      findings.push({ severity: 'info', type: 'missing-feature', domain: 'projects', page: href ?? '/projects/[slug]', description: 'Recommendations section not visible on project detail page.' })
    }
  } else {
    findings.push({ severity: 'info', type: 'empty-state', domain: 'projects', page: '/projects', description: 'No existing projects to test detail page.' })
  }

  // ── 4. Console/network errors ─────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'projects', page: page.url(), description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'projects', page: page.url(), description: err })
  }

  saveFindings('projects', findings)
})
```

**Step 2: Run the projects audit**

```bash
npx playwright test tests/audit/flows/projects.audit.ts --config tests/audit/playwright.config.ts --headed
```

**Step 3: Commit**

```bash
git add tests/audit/flows/projects.audit.ts
git commit -m "feat(audit): add projects flow audit script"
```

---

## Task 8: Captures Audit Script

**Files:**
- Create: `tests/audit/flows/captures.audit.ts`

**Step 1: Create the captures audit script**

```ts
// tests/audit/flows/captures.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Captures: quick capture and UnifiedSearch audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // ── 1. UnifiedSearch (Cmd+K) ─────────────────────────────
  await page.screenshot({ path: screenshotPath('captures', '01-dashboard') })

  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(500)
  await page.screenshot({ path: screenshotPath('captures', '02-search-open') })

  const searchOverlay = page.locator('[cmdk-root], [role="dialog"][aria-label*="search" i], .unified-search').first()
  if (!(await searchOverlay.isVisible())) {
    findings.push({ severity: 'critical', type: 'dead-end', domain: 'captures', page: '/', description: 'Cmd+K did not open UnifiedSearch overlay.', screenshot: screenshotPath('captures', '02-search-open'), suggestion: 'Verify Meta+K keybinding is registered globally.' })
  } else {
    // Check quick actions show when empty
    const quickActions = page.locator('text=/quick action|new note|new task/i').first()
    if (!(await quickActions.isVisible())) {
      findings.push({ severity: 'medium', type: 'ux-friction', domain: 'captures', page: '/', description: 'UnifiedSearch shows blank state when query is empty — no quick actions visible.', screenshot: screenshotPath('captures', '02-search-open'), suggestion: 'Show quick action shortcuts in empty state for discoverability.' })
    }

    // Type a query and check results
    const input = page.locator('[cmdk-input], input[placeholder*="search" i]').first()
    if (await input.isVisible()) {
      await input.fill('test')
      await page.waitForTimeout(600)
      await page.screenshot({ path: screenshotPath('captures', '03-search-results') })
      const results = page.locator('[cmdk-item], [role="option"]')
      const resultCount = await results.count()
      if (resultCount === 0) {
        findings.push({ severity: 'medium', type: 'empty-state', domain: 'captures', page: '/', description: 'Search for "test" returns 0 results — may be expected on fresh DB.', screenshot: screenshotPath('captures', '03-search-results'), suggestion: 'Show a "No results" message with a CTA to create content.' })
      }
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // ── 2. Quick Capture (Cmd+Shift+C) ──────────────────────
  await page.keyboard.press('Meta+Shift+c')
  await page.waitForTimeout(500)
  await page.screenshot({ path: screenshotPath('captures', '04-quick-capture') })

  const captureOverlay = page.locator('[data-quick-capture], .quick-capture, dialog').first()
  if (!(await captureOverlay.isVisible())) {
    findings.push({ severity: 'critical', type: 'dead-end', domain: 'captures', page: '/', description: 'Cmd+Shift+C did not open Quick Capture overlay.', screenshot: screenshotPath('captures', '04-quick-capture'), suggestion: 'Verify Meta+Shift+C keybinding is globally registered.' })
  } else {
    // Check capture type selector (thought/insight/link)
    const typeSelector = page.locator('text=/thought|insight|link/i').first()
    if (!(await typeSelector.isVisible())) {
      findings.push({ severity: 'medium', type: 'missing-feature', domain: 'captures', page: '/', description: 'Capture type selector (thought/insight/link) not visible in quick capture.', screenshot: screenshotPath('captures', '04-quick-capture') })
    }

    // Type a thought
    const input = captureOverlay.locator('textarea, [contenteditable="true"], input[type="text"]').first()
    if (await input.isVisible()) {
      await input.fill('UX audit test capture — verifying thought capture flow')
      await page.screenshot({ path: screenshotPath('captures', '05-capture-typed') })

      // Submit
      const submitBtn = captureOverlay.getByRole('button', { name: /save|capture|add/i }).first()
      if (!(await submitBtn.isVisible())) {
        findings.push({ severity: 'high', type: 'dead-end', domain: 'captures', page: '/', description: 'No save/submit button visible in quick capture overlay.', screenshot: screenshotPath('captures', '05-capture-typed') })
      } else {
        await submitBtn.click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: screenshotPath('captures', '06-after-capture') })

        if (await captureOverlay.isVisible()) {
          findings.push({ severity: 'high', type: 'dead-end', domain: 'captures', page: '/', description: 'Quick capture overlay did not close after saving.', screenshot: screenshotPath('captures', '06-after-capture') })
        }
      }
    } else {
      await page.keyboard.press('Escape')
    }
  }

  // ── 3. URL capture — metadata scraping ──────────────────
  await page.keyboard.press('Meta+Shift+c')
  await page.waitForTimeout(500)
  const captureOverlay2 = page.locator('dialog, [data-quick-capture]').first()
  if (await captureOverlay2.isVisible()) {
    const input2 = captureOverlay2.locator('textarea, input[type="text"]').first()
    if (await input2.isVisible()) {
      await input2.fill('https://example.com')
      await page.waitForTimeout(2000) // wait for metadata scraping

      await page.screenshot({ path: screenshotPath('captures', '07-link-capture') })
      const metadata = captureOverlay2.locator('text=/example|title|loading/i').first()
      if (!(await metadata.isVisible())) {
        findings.push({ severity: 'medium', type: 'ux-friction', domain: 'captures', page: '/', description: 'No link metadata preview visible after entering URL in quick capture.', screenshot: screenshotPath('captures', '07-link-capture'), suggestion: 'Show title, favicon, description preview while scraping.' })
      }
    }
    await page.keyboard.press('Escape')
  }

  // ── 4. Dashboard feed ────────────────────────────────────
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: screenshotPath('captures', '08-dashboard-feed') })

  // Check insight/capture feed visible
  const feed = page.locator('text=/insight|capture|feed|recent/i').first()
  if (!(await feed.isVisible())) {
    findings.push({ severity: 'medium', type: 'missing-feature', domain: 'captures', page: '/', description: 'No visible insight or capture feed on dashboard.', screenshot: screenshotPath('captures', '08-dashboard-feed') })
  }

  // ── 5. Console/network errors ─────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'captures', page: page.url(), description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'captures', page: page.url(), description: err })
  }

  saveFindings('captures', findings)
})
```

**Step 2: Run the captures audit**

```bash
npx playwright test tests/audit/flows/captures.audit.ts --config tests/audit/playwright.config.ts --headed
```

**Step 3: Commit**

```bash
git add tests/audit/flows/captures.audit.ts
git commit -m "feat(audit): add captures and UnifiedSearch audit script"
```

---

## Task 9: Agents Audit Script

**Files:**
- Create: `tests/audit/flows/agents.audit.ts`

**Step 1: Create the agents audit script**

```ts
// tests/audit/flows/agents.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Agents: delegation and review flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Agents page ───────────────────────────────────────
  await page.goto('/agents')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('agents', '01-list') })

  const heading = page.getByRole('heading').first()
  if (!(await heading.isVisible())) {
    findings.push({ severity: 'medium', type: 'broken-ui', domain: 'agents', page: '/agents', description: 'No visible heading on /agents page.', screenshot: screenshotPath('agents', '01-list') })
  }

  // Check empty state
  const agentItems = page.locator('[data-agent-task], .agent-task-item').first()
  if (!(await agentItems.isVisible())) {
    const emptyMsg = page.locator('text=/no task|empty|delegate/i').first()
    if (!(await emptyMsg.isVisible())) {
      findings.push({ severity: 'medium', type: 'empty-state', domain: 'agents', page: '/agents', description: 'Agent tasks list is empty with no explanatory message or onboarding CTA.', screenshot: screenshotPath('agents', '01-list'), suggestion: 'Add empty state explaining how to delegate tasks to AI agents.' })
    }
  }

  // ── 2. Delegate task flow ────────────────────────────────
  // First create a task to delegate
  await page.goto('/tasks')
  await page.waitForLoadState('networkidle')

  const createBtn = page.getByRole('button', { name: /new task|add task|create/i }).first()
  if (await createBtn.isVisible()) {
    await createBtn.click()
    await page.waitForTimeout(500)
    const dialog = page.getByRole('dialog')
    if (await dialog.isVisible()) {
      const titleField = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/title|task/i)).first()
      if (await titleField.isVisible()) {
        await titleField.fill('Audit: Test AI Delegation')
        await dialog.getByRole('button', { name: /create|save|add/i }).first().click()
        await page.waitForTimeout(800)
      }
    }
  }

  // Find delegate button on a task
  const delegateBtn = page.getByRole('button', { name: /delegate/i }).first()
  if (!(await delegateBtn.isVisible())) {
    // Try opening task detail first
    const taskItem = page.locator('[data-task-id], .task-item').first()
    if (await taskItem.isVisible()) {
      await taskItem.click()
      await page.waitForTimeout(400)
      const innerDelegate = page.getByRole('button', { name: /delegate/i }).first()
      if (!(await innerDelegate.isVisible())) {
        findings.push({ severity: 'high', type: 'ux-friction', domain: 'agents', page: '/tasks', description: 'Delegate to AI button not visible on task or task detail.', screenshot: screenshotPath('agents', '02-delegate-missing'), suggestion: 'Add "Delegate to AI" as a secondary action in task row hover menu or task detail.' })
        await page.screenshot({ path: screenshotPath('agents', '02-delegate-missing') })
      }
    }
  } else {
    await delegateBtn.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('agents', '02-delegate-dialog') })

    const delegateDialog = page.getByRole('dialog')
    if (!(await delegateDialog.isVisible())) {
      findings.push({ severity: 'critical', type: 'dead-end', domain: 'agents', page: '/tasks', description: 'Clicking "Delegate" did not open delegation dialog.', screenshot: screenshotPath('agents', '02-delegate-dialog') })
    } else {
      // Check all 6 agent types listed
      const agentTypes = ['Dev', 'Writer', 'Researcher', 'Marketer', 'Analyst', 'Assistant']
      for (const agentType of agentTypes) {
        const agentOpt = delegateDialog.locator(`text=/${agentType}/i`).first()
        if (!(await agentOpt.isVisible())) {
          findings.push({ severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/tasks', description: `Agent type "${agentType}" not listed in delegation dialog.`, screenshot: screenshotPath('agents', '02-delegate-dialog') })
        }
      }

      // Check instructions field
      const instructions = delegateDialog.locator('textarea, [placeholder*="instruction" i]').first()
      if (!(await instructions.isVisible())) {
        findings.push({ severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/tasks', description: 'No instructions textarea in delegation dialog.', screenshot: screenshotPath('agents', '02-delegate-dialog') })
      }

      await page.keyboard.press('Escape')
    }
  }

  // ── 3. Agent review panel ────────────────────────────────
  await page.goto('/agents')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('agents', '03-review-panel') })

  // If there are completed tasks, check review panel
  const awaitingReview = page.locator('text=/awaiting review|approve|revise/i').first()
  if (await awaitingReview.isVisible()) {
    await awaitingReview.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: screenshotPath('agents', '04-review-actions') })

    // Check approve/revise/reject actions visible
    for (const action of ['Approve', 'Revise', 'Reject']) {
      const btn = page.getByRole('button', { name: new RegExp(action, 'i') }).first()
      if (!(await btn.isVisible())) {
        findings.push({ severity: 'high', type: 'missing-feature', domain: 'agents', page: '/agents', description: `"${action}" action button not visible in agent review panel.`, screenshot: screenshotPath('agents', '04-review-actions') })
      }
    }

    // Check save-as-note option
    const saveAsNote = page.getByRole('button', { name: /save as note|save to note/i }).first()
    if (!(await saveAsNote.isVisible())) {
      findings.push({ severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/agents', description: '"Save as Note" button not visible in agent review panel for approved tasks.', suggestion: 'Show "Save as Note" after approval, not before.' })
    }
  } else {
    findings.push({ severity: 'info', type: 'empty-state', domain: 'agents', page: '/agents', description: 'No tasks awaiting review — approve/revise/reject flow not testable without delegated tasks.' })
  }

  // ── 4. Console/network errors ─────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'agents', page: page.url(), description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'agents', page: page.url(), description: err })
  }

  saveFindings('agents', findings)
})
```

**Step 2: Run the agents audit**

```bash
npx playwright test tests/audit/flows/agents.audit.ts --config tests/audit/playwright.config.ts --headed
```

**Step 3: Commit**

```bash
git add tests/audit/flows/agents.audit.ts
git commit -m "feat(audit): add AI agents delegation flow audit script"
```

---

## Task 10: Mobile Audit Script

**Files:**
- Create: `tests/audit/responsive/mobile.audit.ts`

**Step 1: Create the mobile audit script**

```ts
// tests/audit/responsive/mobile.audit.ts
import { test, expect } from '../setup/fixtures'
import { Finding, saveFindings, screenshotPath } from '../setup/findings'

const VIEWPORTS = [
  { name: 'iphone', width: 375, height: 812 },
  { name: 'ipad', width: 768, height: 1024 },
]

const PAGES = [
  { path: '/', name: 'dashboard' },
  { path: '/notes', name: 'notes' },
  { path: '/tasks', name: 'tasks' },
  { path: '/projects', name: 'projects' },
  { path: '/agents', name: 'agents' },
]

// Minimum touch target size per WCAG / Apple HIG
const MIN_TOUCH_PX = 44

for (const viewport of VIEWPORTS) {
  test(`Mobile audit — ${viewport.name} (${viewport.width}×${viewport.height})`, async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const { path, name } of PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      const screenshotName = `${viewport.name}-${name}`
      await page.screenshot({ path: screenshotPath('mobile', screenshotName), fullPage: false })

      // Check horizontal overflow
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > window.innerWidth
      )
      if (overflow) {
        findings.push({
          severity: 'high', type: 'mobile-issue', domain: 'mobile', page: path,
          description: `Horizontal overflow at ${viewport.width}px on ${name} page.`,
          screenshot: screenshotPath('mobile', screenshotName),
          suggestion: 'Use overflow-x-hidden on root or fix the overflowing element.',
        })
      }

      // Check sidebar is hidden on mobile (should only show on lg+)
      if (viewport.width < 1024) {
        const sidebar = page.locator('nav[aria-label="sidebar"], aside, .sidebar').first()
        if (await sidebar.isVisible()) {
          findings.push({
            severity: 'medium', type: 'mobile-issue', domain: 'mobile', page: path,
            description: `Sidebar visible at ${viewport.width}px — should be hidden below lg breakpoint.`,
            screenshot: screenshotPath('mobile', screenshotName),
          })
        }
      }

      // Check bottom nav on mobile (<1024px)
      if (viewport.width < 1024) {
        const bottomNav = page.locator('nav[aria-label*="bottom" i], .bottom-nav, [data-bottom-nav]').first()
        if (!(await bottomNav.isVisible())) {
          findings.push({
            severity: 'high', type: 'mobile-issue', domain: 'mobile', page: path,
            description: `Bottom navigation not visible at ${viewport.width}px on ${name} page.`,
            screenshot: screenshotPath('mobile', screenshotName),
            suggestion: 'Ensure bottom nav renders on all dashboard pages on mobile.',
          })
        }

        // Check FAB (capture button)
        const fab = page.locator('button[aria-label*="capture" i], .fab, [data-fab]').first()
        if (!(await fab.isVisible())) {
          findings.push({
            severity: 'medium', type: 'mobile-issue', domain: 'mobile', page: path,
            description: `Floating action button (quick capture) not visible at ${viewport.width}px.`,
            screenshot: screenshotPath('mobile', screenshotName),
          })
        }
      }

      // Touch target size audit — check all buttons
      const buttons = page.locator('button, a[role="button"], [role="tab"]')
      const buttonCount = await buttons.count()
      const smallTargets: string[] = []

      for (let i = 0; i < Math.min(buttonCount, 30); i++) {
        const btn = buttons.nth(i)
        if (!(await btn.isVisible())) continue
        const box = await btn.boundingBox()
        if (box && (box.height < MIN_TOUCH_PX || box.width < MIN_TOUCH_PX)) {
          const label = await btn.getAttribute('aria-label') ?? await btn.textContent()
          smallTargets.push(`"${label?.trim().slice(0, 30)}" (${Math.round(box.width)}×${Math.round(box.height)}px)`)
        }
      }

      if (smallTargets.length > 0) {
        findings.push({
          severity: 'medium', type: 'mobile-issue', domain: 'mobile', page: path,
          description: `${smallTargets.length} touch targets below ${MIN_TOUCH_PX}px minimum at ${viewport.width}px: ${smallTargets.slice(0, 5).join(', ')}${smallTargets.length > 5 ? ' ...' : ''}`,
          screenshot: screenshotPath('mobile', screenshotName),
          suggestion: `Add min-h-[44px] min-w-[44px] to small interactive elements.`,
        })
      }
    }

    // ── Dialog → Sheet behavior on mobile ─────────────────
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')
    const createBtn = page.getByRole('button', { name: /new task|add task|create/i }).first()
    if (await createBtn.isVisible()) {
      await createBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: screenshotPath('mobile', `${viewport.name}-task-sheet`) })

      const dialog = page.getByRole('dialog')
      if (await dialog.isVisible()) {
        // On mobile, dialog should render as a bottom sheet
        const box = await dialog.boundingBox()
        if (box && box.width < viewport.width - 32) {
          findings.push({
            severity: 'medium', type: 'mobile-issue', domain: 'mobile', page: '/tasks',
            description: `Task create dialog at ${viewport.width}px renders as a small dialog (${Math.round(box.width)}px wide) instead of a full-width bottom sheet.`,
            screenshot: screenshotPath('mobile', `${viewport.name}-task-sheet`),
            suggestion: 'Use Sheet component (full-width) instead of Dialog on mobile breakpoints.',
          })
        }
        await page.keyboard.press('Escape')
      }
    }

    // ── Console/network errors ────────────────────────────
    for (const err of consoleErrors) {
      findings.push({ severity: 'high', type: 'js-error', domain: 'mobile', page: page.url(), description: err })
    }
    for (const err of networkErrors) {
      findings.push({ severity: 'medium', type: 'network-error', domain: 'mobile', page: page.url(), description: err })
    }

    saveFindings(`mobile-${viewport.name}`, findings)
  })
}
```

**Step 2: Run the mobile audit**

```bash
npx playwright test tests/audit/responsive/mobile.audit.ts --config tests/audit/playwright.config.ts --headed
```

**Step 3: Commit**

```bash
git add tests/audit/responsive/mobile.audit.ts
git commit -m "feat(audit): add mobile responsiveness audit script"
```

---

## Task 11: Report Generator

**Files:**
- Create: `tests/audit/reporter/generate.ts`

**Step 1: Create the report generator**

```ts
// tests/audit/reporter/generate.ts
import * as fs from 'fs'
import * as path from 'path'

const FINDINGS_DIR = path.join(process.cwd(), 'tests/audit/findings')
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  info: '#6b7280',
}

interface Finding {
  severity: string
  type: string
  domain: string
  page: string
  description: string
  screenshot?: string
  suggestion?: string
}

interface FindingsFile {
  domain: string
  findings: Finding[]
  generatedAt: string
}

function loadAllFindings(): Finding[] {
  const files = fs.readdirSync(FINDINGS_DIR).filter(f => f.endsWith('.json'))
  const all: Finding[] = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(FINDINGS_DIR, file), 'utf-8')
    const data: FindingsFile = JSON.parse(raw)
    all.push(...data.findings)
  }
  return all.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  )
}

function groupByDomain(findings: Finding[]): Record<string, Finding[]> {
  return findings.reduce((acc, f) => {
    ;(acc[f.domain] = acc[f.domain] ?? []).push(f)
    return acc
  }, {} as Record<string, Finding[]>)
}

function generateMarkdown(findings: Finding[]): string {
  const grouped = groupByDomain(findings)
  const total = findings.length
  const bySeverity = Object.entries(SEVERITY_ORDER).map(([s]) => ({
    severity: s,
    count: findings.filter(f => f.severity === s).length,
  }))

  let md = `# Brain Portal — UX Audit Report\n\n`
  md += `**Generated:** ${new Date().toISOString()}\n\n`
  md += `## Summary\n\n`
  md += `**Total findings:** ${total}\n\n`
  md += `| Severity | Count |\n|---|---|\n`
  for (const { severity, count } of bySeverity) {
    if (count > 0) md += `| ${severity.toUpperCase()} | ${count} |\n`
  }
  md += `\n---\n\n`

  for (const [domain, items] of Object.entries(grouped)) {
    md += `## ${domain.charAt(0).toUpperCase() + domain.slice(1)}\n\n`
    for (const f of items) {
      md += `### [${f.severity.toUpperCase()}] ${f.type} — \`${f.page}\`\n\n`
      md += `${f.description}\n\n`
      if (f.suggestion) md += `**Suggestion:** ${f.suggestion}\n\n`
      if (f.screenshot) md += `**Screenshot:** \`${path.relative(process.cwd(), f.screenshot)}\`\n\n`
      md += `---\n\n`
    }
  }
  return md
}

function generateHtml(findings: Finding[]): string {
  const grouped = groupByDomain(findings)
  const total = findings.length

  const domainSections = Object.entries(grouped).map(([domain, items]) => {
    const findingCards = items.map(f => {
      const color = SEVERITY_COLORS[f.severity] ?? '#6b7280'
      const screenshotTag = f.screenshot && fs.existsSync(f.screenshot)
        ? `<img src="${path.relative(path.join(process.cwd(), 'tests/audit/findings'), f.screenshot)}" style="max-width:100%;border-radius:4px;margin-top:8px;" />`
        : ''
      return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <span style="background:${color};color:white;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:4px;text-transform:uppercase;">${f.severity}</span>
            <span style="background:#f3f4f6;font-size:11px;padding:2px 8px;border-radius:4px;">${f.type}</span>
            <code style="font-size:12px;color:#6b7280;">${f.page}</code>
          </div>
          <p style="margin:0 0 8px;">${f.description}</p>
          ${f.suggestion ? `<p style="margin:0;color:#2563eb;font-size:13px;"><strong>Suggestion:</strong> ${f.suggestion}</p>` : ''}
          ${screenshotTag}
        </div>`
    }).join('')

    return `
      <details open>
        <summary style="cursor:pointer;font-size:18px;font-weight:bold;padding:8px 0;">${domain.charAt(0).toUpperCase() + domain.slice(1)} (${items.length})</summary>
        ${findingCards}
      </details>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Brain Portal UX Audit</title>
  <style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#111827;} code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:13px;}</style>
</head>
<body>
  <h1>Brain Portal — UX Audit Report</h1>
  <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
  <p><strong>Total findings:</strong> ${total}</p>
  <hr>
  ${domainSections}
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────
const findings = loadAllFindings()
const md = generateMarkdown(findings)
const html = generateHtml(findings)

fs.writeFileSync(path.join(FINDINGS_DIR, 'report.md'), md)
fs.writeFileSync(path.join(FINDINGS_DIR, 'report.html'), html)

console.log(`\n✅ Report generated:`)
console.log(`   ${path.join(FINDINGS_DIR, 'report.md')}`)
console.log(`   ${path.join(FINDINGS_DIR, 'report.html')}`)
console.log(`\n📊 ${findings.length} total findings across ${Object.keys(groupByDomain(findings)).length} domains`)
```

**Step 2: Test report generation (after running at least one audit script)**

```bash
npx tsx tests/audit/reporter/generate.ts
```

Expected: prints `✅ Report generated` with paths, creates `report.html` and `report.md`.

Open report:
```bash
xdg-open tests/audit/findings/report.html
```

**Step 3: Commit**

```bash
git add tests/audit/reporter/generate.ts
git commit -m "feat(audit): add HTML + Markdown report generator"
```

---

## Task 12: Run the Full Audit

**Step 1: Start the dev server (in a separate terminal)**

```bash
npm run dev
```

Wait for: `✓ Ready in X.Xs` on port 3000.

**Step 2: Run all audit scripts**

```bash
npx playwright test tests/audit/ --config tests/audit/playwright.config.ts --headed
```

Or run domain-by-domain if you want to watch each:
```bash
npx playwright test tests/audit/flows/notes.audit.ts --config tests/audit/playwright.config.ts --headed
npx playwright test tests/audit/flows/tasks.audit.ts --config tests/audit/playwright.config.ts --headed
npx playwright test tests/audit/flows/projects.audit.ts --config tests/audit/playwright.config.ts --headed
npx playwright test tests/audit/flows/captures.audit.ts --config tests/audit/playwright.config.ts --headed
npx playwright test tests/audit/flows/agents.audit.ts --config tests/audit/playwright.config.ts --headed
npx playwright test tests/audit/responsive/mobile.audit.ts --config tests/audit/playwright.config.ts --headed
```

**Step 3: Generate the report**

```bash
npx tsx tests/audit/reporter/generate.ts
```

**Step 4: Open the report**

```bash
xdg-open tests/audit/findings/report.html
```

**Step 5: Review findings** — the report shows all issues grouped by domain with severity. Use this to file bugs or UX improvements.

---

## Success Criteria

- [ ] All 6 audit scripts run without crashing
- [ ] `tests/audit/findings/*.json` files exist for each domain
- [ ] `tests/audit/findings/report.html` opens in browser and shows grouped findings
- [ ] `tests/audit/findings/report.md` contains readable summary
- [ ] Screenshots captured for key states
