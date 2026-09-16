import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Notes: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Notes list page ────────────────────────────────────────────────────
  await page.goto('/notes')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('notes', '01-list') })

  // Check heading visible
  const heading = page.getByRole('heading').first()
  if (!(await heading.isVisible())) {
    findings.push({
      severity: 'high', type: 'broken-ui', domain: 'notes', page: '/notes',
      description: 'No visible heading on /notes page.',
      screenshot: screenshotPath('notes', '01-list'),
    })
  }

  // Check empty state has a CTA
  const noteLinks = page.locator('a[href*="/notes/"]')
  const noteCount = await noteLinks.count()
  if (noteCount === 0) {
    const cta = page.getByRole('link', { name: /new note|create/i })
      .or(page.getByRole('button', { name: /new note|create/i }))
    if (!(await cta.first().isVisible())) {
      findings.push({
        severity: 'high', type: 'empty-state', domain: 'notes', page: '/notes',
        description: 'Notes list is empty with no visible CTA to create the first note.',
        screenshot: screenshotPath('notes', '01-list'),
        suggestion: 'Add an empty state component with a "Create your first note" button.',
      })
    }
  }

  // Check filter tabs (all / daily / regular)
  const tabs = page.getByRole('tab')
  const tabCount = await tabs.count()
  if (tabCount < 2) {
    findings.push({
      severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes',
      description: `Expected filter tabs (all/daily/regular), found ${tabCount}.`,
      screenshot: screenshotPath('notes', '01-list'),
    })
  } else {
    // Click through each tab
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)
    }
  }

  // ── 2. New note page ──────────────────────────────────────────────────────
  await page.goto('/notes/new')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('notes', '02-new') })

  // Editor must be present
  const editor = page.locator('[contenteditable="true"]')
  const editorVisible = await editor.isVisible()
  if (!editorVisible) {
    findings.push({
      severity: 'critical', type: 'broken-ui', domain: 'notes', page: '/notes/new',
      description: 'TipTap editor (contenteditable) not visible on /notes/new.',
      screenshot: screenshotPath('notes', '02-new'),
    })
  }

  // Formatting toolbar
  const toolbar = page.locator('[role="toolbar"]').first()
  if (!(await toolbar.isVisible())) {
    findings.push({
      severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes/new',
      description: 'Formatting toolbar [role="toolbar"] not visible in note editor.',
      screenshot: screenshotPath('notes', '02-new'),
      suggestion: 'Ensure toolbar renders immediately, not only on focus.',
    })
  }

  // ── 3. Type content → check auto-save ────────────────────────────────────
  if (editorVisible) {
    await editor.click()
    await page.keyboard.type('UX Audit Test Note — checking auto-save behavior and editor responsiveness')
    await page.waitForTimeout(2000) // wait for debounced auto-save
    await page.screenshot({ path: screenshotPath('notes', '03-typed') })

    // Save status indicator
    const saveText = page.getByText(/saved|saving/i)
    if (!(await saveText.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'notes', page: '/notes/new',
        description: 'No auto-save status indicator visible after typing (looked for text matching /saved|saving/i).',
        screenshot: screenshotPath('notes', '03-typed'),
        suggestion: 'Show "Saving..." / "Saved X seconds ago" status near the editor toolbar.',
      })
    }

    // Check URL redirect after save
    await page.waitForTimeout(2000)
    const currentUrl = page.url()
    if (currentUrl.endsWith('/notes/new') || currentUrl.endsWith('/notes/new/')) {
      findings.push({
        severity: 'medium', type: 'ux-friction', domain: 'notes', page: '/notes/new',
        description: 'URL still shows /notes/new after typing — no automatic slug redirect after save.',
        screenshot: screenshotPath('notes', '03-typed'),
        suggestion: 'Redirect to /notes/[slug] once the note is saved so users can bookmark/share it.',
      })
    }
  }

  // ── 4. Attachment panel ────────────────────────────────────────────────────
  const attachBtn = page.getByRole('button', { name: /attach/i })
    .or(page.locator('[aria-label*="attachment" i]')).first()
  if (!(await attachBtn.isVisible())) {
    findings.push({
      severity: 'low', type: 'missing-feature', domain: 'notes', page: '/notes/new',
      description: 'No attachment button visible in note editor at 1280px viewport.',
      screenshot: screenshotPath('notes', '03-typed'),
    })
  } else {
    await attachBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('notes', '04-attachments') })

    // Check panel opened
    const panelOpen = await page.locator('[data-panel="attachments"], [aria-label*="attachment" i]')
      .or(page.locator('.attachment-panel')).first().isVisible()
    if (!panelOpen) {
      findings.push({
        severity: 'medium', type: 'broken-ui', domain: 'notes', page: '/notes/new',
        description: 'Clicking attachment button did not open the attachment panel.',
        screenshot: screenshotPath('notes', '04-attachments'),
      })
    }
    await page.keyboard.press('Escape')
  }

  // ── 5. Navigate to existing note ──────────────────────────────────────────
  await page.goto('/notes')
  await page.waitForLoadState('networkidle')

  const firstNote = page.locator('a[href*="/notes/"]').first()
  if (await firstNote.isVisible()) {
    const href = await firstNote.getAttribute('href') ?? '/notes/[slug]'
    await firstNote.click()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: screenshotPath('notes', '05-detail') })

    // Editor should load with content
    const noteEditor = page.locator('[contenteditable="true"]')
    if (!(await noteEditor.isVisible())) {
      findings.push({
        severity: 'critical', type: 'broken-ui', domain: 'notes', page: href,
        description: 'Editor not visible on note detail page.',
        screenshot: screenshotPath('notes', '05-detail'),
      })
    }

    // Note connections / related notes
    const connections = page.getByText(/connection|related|similar/i).first()
    if (!(await connections.isVisible())) {
      findings.push({
        severity: 'info', type: 'missing-feature', domain: 'notes', page: href,
        description: 'No note connections / related notes section visible on note detail page.',
        suggestion: 'Show related notes panel once embeddings are generated.',
      })
    }

    // Share button → share dialog
    const shareBtn = page.getByRole('button', { name: /share/i }).first()
    if (!(await shareBtn.isVisible())) {
      findings.push({
        severity: 'low', type: 'missing-feature', domain: 'notes', page: href,
        description: 'Share button not visible on note detail page.',
      })
    } else {
      await shareBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: screenshotPath('notes', '06-share-dialog') })
      const dialog = page.getByRole('dialog')
      if (!(await dialog.isVisible())) {
        findings.push({
          severity: 'medium', type: 'broken-ui', domain: 'notes', page: href,
          description: 'Share button click did not open share dialog.',
          screenshot: screenshotPath('notes', '06-share-dialog'),
        })
      }
      await page.keyboard.press('Escape')
    }
  } else {
    findings.push({
      severity: 'info', type: 'empty-state', domain: 'notes', page: '/notes',
      description: 'No existing notes available to test note detail page navigation.',
    })
  }

  // ── 6. Log any console/network errors accumulated ────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'notes', page: 'see description', description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'notes', page: 'see description', description: err })
  }

  saveFindings('notes', findings)
})
