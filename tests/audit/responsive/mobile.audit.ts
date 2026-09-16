import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

const MIN_TOUCH_PX = 44

const PAGES = [
  { path: '/', name: 'dashboard' },
  { path: '/notes', name: 'notes' },
  { path: '/tasks', name: 'tasks' },
  { path: '/projects', name: 'projects' },
  { path: '/tasks?view=queue', name: 'agents' },
]

for (const vp of [
  { name: 'iphone', width: 375, height: 812 },
  { name: 'ipad', width: 768, height: 1024 },
]) {
  test(`Mobile audit — ${vp.name} (${vp.width}×${vp.height})`, async ({
    authedPage: page,
    consoleErrors,
    networkErrors,
    findings,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })

    // ── Per-page checks ──────────────────────────────────────────────────────
    for (const { path, name } of PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)

      const shot = `${vp.name}-${name}`
      await page.screenshot({ path: screenshotPath('mobile', shot), fullPage: false })

      // Horizontal overflow
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      )
      if (overflow) {
        findings.push({
          severity: 'high',
          type: 'mobile-issue',
          domain: 'mobile',
          page: path,
          description: `Horizontal overflow at ${vp.width}px on ${name} page.`,
          screenshot: screenshotPath('mobile', shot),
          suggestion: 'Use overflow-x-hidden on root or find and fix the overflowing element.',
        })
      }

      // Sidebar should be hidden below lg (1024px)
      if (vp.width < 1024) {
        const sidebar = page
          .locator('nav[aria-label*="sidebar" i], aside.sidebar, [data-sidebar]')
          .first()
        if (await sidebar.isVisible()) {
          findings.push({
            severity: 'medium',
            type: 'mobile-issue',
            domain: 'mobile',
            page: path,
            description: `Desktop sidebar is visible at ${vp.width}px — should be hidden below the lg breakpoint.`,
            screenshot: screenshotPath('mobile', shot),
          })
        }

        // Bottom nav must be present
        const bottomNav = page
          .locator('[data-bottom-nav], nav[aria-label*="bottom" i]')
          .or(page.locator('nav').filter({ has: page.locator('a[href="/"]') }).last())
          .first()
        if (!(await bottomNav.isVisible())) {
          findings.push({
            severity: 'high',
            type: 'mobile-issue',
            domain: 'mobile',
            page: path,
            description: `Bottom navigation not visible at ${vp.width}px on ${name} page.`,
            screenshot: screenshotPath('mobile', shot),
            suggestion: 'Ensure bottom nav renders on all dashboard pages on mobile.',
          })
        }

        // FAB (quick capture floating button)
        const fab = page
          .locator('button[aria-label*="capture" i], [data-fab]')
          .or(page.locator('button.fab'))
          .first()
        if (!(await fab.isVisible())) {
          findings.push({
            severity: 'medium',
            type: 'mobile-issue',
            domain: 'mobile',
            page: path,
            description: `Quick capture FAB not visible at ${vp.width}px on ${name} page.`,
            screenshot: screenshotPath('mobile', shot),
          })
        }
      }

      // Touch target size audit (check up to 30 buttons)
      const buttons = page.locator('button, a[role="button"], [role="tab"]')
      const buttonCount = await buttons.count()
      const smallTargets: string[] = []
      for (let i = 0; i < Math.min(buttonCount, 30); i++) {
        const btn = buttons.nth(i)
        if (!(await btn.isVisible())) continue
        const box = await btn.boundingBox()
        if (box && (box.height < MIN_TOUCH_PX || box.width < MIN_TOUCH_PX)) {
          const label =
            (await btn.getAttribute('aria-label')) ??
            (await btn.textContent())?.trim().slice(0, 30) ??
            'unlabelled'
          smallTargets.push(`"${label}" (${Math.round(box.width)}×${Math.round(box.height)}px)`)
        }
      }
      if (smallTargets.length > 0) {
        findings.push({
          severity: 'medium',
          type: 'mobile-issue',
          domain: 'mobile',
          page: path,
          description: `${smallTargets.length} touch targets below ${MIN_TOUCH_PX}px on ${name} at ${vp.width}px: ${smallTargets.slice(0, 5).join(', ')}${smallTargets.length > 5 ? ' …' : ''}`,
          screenshot: screenshotPath('mobile', shot),
          suggestion: `Add min-h-[44px] min-w-[44px] to small interactive elements.`,
        })
      }
    }

    // ── Dialog → Sheet check on /tasks ──────────────────────────────────────
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')
    const createBtn = page
      .getByRole('button', { name: /new task|add task/i })
      .first()
    if (await createBtn.isVisible()) {
      await createBtn.click()
      await page.waitForTimeout(600)
      await page.screenshot({
        path: screenshotPath('mobile', `${vp.name}-task-sheet`),
      })
      const dialog = page.getByRole('dialog')
      if (await dialog.isVisible()) {
        const box = await dialog.boundingBox()
        if (box && box.width < vp.width - 32) {
          findings.push({
            severity: 'medium',
            type: 'mobile-issue',
            domain: 'mobile',
            page: '/tasks',
            description: `Task create dialog at ${vp.width}px renders as a narrow dialog (${Math.round(box.width)}px wide) instead of a full-width bottom sheet.`,
            screenshot: screenshotPath('mobile', `${vp.name}-task-sheet`),
            suggestion:
              'Use the Sheet component (full-width slide-up) instead of Dialog on mobile breakpoints.',
          })
        }
        await page.keyboard.press('Escape')
      }
    }

    // ── Console/network errors ────────────────────────────────────────────────
    for (const err of consoleErrors) {
      findings.push({
        severity: 'high',
        type: 'js-error',
        domain: 'mobile',
        page: 'see description',
        description: err,
      })
    }
    for (const err of networkErrors) {
      findings.push({
        severity: 'medium',
        type: 'network-error',
        domain: 'mobile',
        page: 'see description',
        description: err,
      })
    }

    saveFindings(`mobile-${vp.name}`, findings)
  })
}
