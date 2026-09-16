import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Captures: quick capture and UnifiedSearch audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('captures', '01-dashboard') })

  // ── 1. UnifiedSearch (Cmd+K) ──────────────────────────────────────────────
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(600)
  await page.screenshot({ path: screenshotPath('captures', '02-search-open') })

  const searchOverlay = page.locator('[cmdk-root]')
    .or(page.locator('[role="dialog"]').filter({ hasText: /search/i })).first()
  const searchOpen = await searchOverlay.isVisible()

  if (!searchOpen) {
    findings.push({
      severity: 'critical', type: 'dead-end', domain: 'captures', page: '/',
      description: 'Cmd+K (Meta+K) did not open the UnifiedSearch overlay.',
      screenshot: screenshotPath('captures', '02-search-open'),
      suggestion: 'Verify the Meta+K keybinding is registered globally on all pages.',
    })
  } else {
    // Quick actions shown when search is empty
    const quickActions = page.getByText(/quick action|new note|new task|capture/i).first()
    if (!(await quickActions.isVisible())) {
      findings.push({
        severity: 'medium', type: 'ux-friction', domain: 'captures', page: '/',
        description: 'UnifiedSearch shows empty state with no quick actions when query is blank.',
        screenshot: screenshotPath('captures', '02-search-open'),
        suggestion: 'Show quick action shortcuts in the empty state for discoverability.',
      })
    }

    // Type a query
    const input = page.locator('[cmdk-input], input[placeholder*="search" i]').first()
    if (await input.isVisible()) {
      await input.fill('test')
      await page.waitForTimeout(700)
      await page.screenshot({ path: screenshotPath('captures', '03-search-results') })

      const results = page.locator('[cmdk-item], [role="option"]')
      const resultCount = await results.count()
      if (resultCount === 0) {
        findings.push({
          severity: 'medium', type: 'empty-state', domain: 'captures', page: '/',
          description: 'Search for "test" returns 0 results — no "No results found" message shown.',
          screenshot: screenshotPath('captures', '03-search-results'),
          suggestion: 'Show a "No results" message with a CTA to create content.',
        })
      }
    }

    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  // ── 2. Quick Capture (Cmd+Shift+C) ──────────────────────────────────────
  await page.keyboard.press('Meta+Shift+c')
  await page.waitForTimeout(600)
  await page.screenshot({ path: screenshotPath('captures', '04-quick-capture') })

  const captureOverlay = page.locator('[data-quick-capture]')
    .or(page.getByRole('dialog')).first()
  const captureOpen = await captureOverlay.isVisible()

  if (!captureOpen) {
    findings.push({
      severity: 'critical', type: 'dead-end', domain: 'captures', page: '/',
      description: 'Cmd+Shift+C (Meta+Shift+C) did not open the Quick Capture overlay.',
      screenshot: screenshotPath('captures', '04-quick-capture'),
      suggestion: 'Verify Meta+Shift+C keybinding is globally registered.',
    })
  } else {
    // Type selector
    const typeSelector = page.getByText(/thought|insight|link/i).first()
    if (!(await typeSelector.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'captures', page: '/',
        description: 'Capture type selector (thought/insight/link) not visible in quick capture.',
        screenshot: screenshotPath('captures', '04-quick-capture'),
      })
    }

    // Input field
    const captureInput = captureOverlay.locator('textarea, [contenteditable="true"]').first()
    if (await captureInput.isVisible()) {
      await captureInput.fill('UX audit test capture — verifying thought capture flow works end to end')
      await page.screenshot({ path: screenshotPath('captures', '05-capture-typed') })

      const submitBtn = captureOverlay.getByRole('button', { name: /save|capture|add/i }).first()
      if (!(await submitBtn.isVisible())) {
        findings.push({
          severity: 'high', type: 'dead-end', domain: 'captures', page: '/',
          description: 'No save/submit button visible in quick capture overlay.',
          screenshot: screenshotPath('captures', '05-capture-typed'),
        })
      } else {
        await submitBtn.click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: screenshotPath('captures', '06-after-capture') })
        if (await captureOverlay.isVisible()) {
          findings.push({
            severity: 'high', type: 'dead-end', domain: 'captures', page: '/',
            description: 'Quick capture overlay did not close after saving.',
            screenshot: screenshotPath('captures', '06-after-capture'),
          })
          await page.keyboard.press('Escape')
        }
      }
    } else {
      findings.push({
        severity: 'critical', type: 'broken-ui', domain: 'captures', page: '/',
        description: 'No textarea or contenteditable input visible in quick capture overlay.',
        screenshot: screenshotPath('captures', '04-quick-capture'),
      })
      await page.keyboard.press('Escape')
    }
  }

  // ── 3. URL capture — metadata scraping ───────────────────────────────────
  await page.keyboard.press('Meta+Shift+c')
  await page.waitForTimeout(600)
  const captureOverlay2 = page.getByRole('dialog').first()
  if (await captureOverlay2.isVisible()) {
    const input2 = captureOverlay2.locator('textarea').first()
    if (await input2.isVisible()) {
      await input2.fill('https://example.com')
      await page.waitForTimeout(2500)
      await page.screenshot({ path: screenshotPath('captures', '07-link-capture') })

      const preview = captureOverlay2.getByText(/example|loading|title/i).first()
      if (!(await preview.isVisible())) {
        findings.push({
          severity: 'medium', type: 'ux-friction', domain: 'captures', page: '/',
          description: 'No link metadata preview visible 2.5s after entering a URL in quick capture.',
          screenshot: screenshotPath('captures', '07-link-capture'),
          suggestion: 'Show title, favicon, description preview while scraping.',
        })
      }
    }
    await page.keyboard.press('Escape')
  }

  // ── 4. Dashboard feed ─────────────────────────────────────────────────────
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: screenshotPath('captures', '08-dashboard-feed') })

  const feed = page.getByText(/insight|capture|feed|recent/i).first()
  if (!(await feed.isVisible())) {
    findings.push({
      severity: 'medium', type: 'missing-feature', domain: 'captures', page: '/',
      description: 'No visible insight or capture feed section on dashboard.',
      screenshot: screenshotPath('captures', '08-dashboard-feed'),
    })
  }

  // ── 5. Console/network errors ─────────────────────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'captures', page: 'see description', description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'captures', page: 'see description', description: err })
  }

  saveFindings('captures', findings)
})
