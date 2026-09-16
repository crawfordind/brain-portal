import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Projects: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Projects list ─────────────────────────────────────────────────────
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('projects', '01-list') })

  const projectLinks = page.locator('a[href*="/projects/"]')
  const projectCount = await projectLinks.count()

  if (projectCount === 0) {
    // Empty state — check for a CTA
    const cta = page.getByRole('button', { name: /new project|create/i })
      .or(page.getByRole('link', { name: /new project/i })).first()
    if (!(await cta.isVisible())) {
      findings.push({
        severity: 'high', type: 'empty-state', domain: 'projects', page: '/projects',
        description: 'No projects exist and no CTA to create the first project is visible.',
        screenshot: screenshotPath('projects', '01-list'),
        suggestion: 'Add an empty state with a "Create your first project" button.',
      })
    }
  }

  // ── 2. Create project dialog ──────────────────────────────────────────────
  const createBtn = page.getByRole('button', { name: /new project|add project/i }).first()
  if (!(await createBtn.isVisible())) {
    findings.push({
      severity: 'critical', type: 'dead-end', domain: 'projects', page: '/projects',
      description: 'No visible "New Project" button on /projects page.',
      screenshot: screenshotPath('projects', '01-list'),
    })
  } else {
    await createBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('projects', '02-create-dialog') })

    const dialog = page.getByRole('dialog')
    if (!(await dialog.isVisible())) {
      findings.push({
        severity: 'critical', type: 'broken-ui', domain: 'projects', page: '/projects',
        description: '"New Project" button did not open a dialog.',
        screenshot: screenshotPath('projects', '02-create-dialog'),
      })
    } else {
      // Fill and submit
      const nameField = dialog.getByLabel(/name/i).or(dialog.getByPlaceholder(/project name/i)).first()
      if (await nameField.isVisible()) {
        await nameField.fill('Audit Test Project')
        const submitBtn = dialog.getByRole('button', { name: /create|save/i }).first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
          await page.waitForTimeout(1200)
          await page.screenshot({ path: screenshotPath('projects', '03-after-create') })
        }
      }
      if (await dialog.isVisible()) {
        findings.push({
          severity: 'high', type: 'dead-end', domain: 'projects', page: '/projects',
          description: 'Project create dialog did not close after submission.',
          screenshot: screenshotPath('projects', '03-after-create'),
        })
        await page.keyboard.press('Escape')
      }
    }
  }

  // ── 3. Project detail page ────────────────────────────────────────────────
  await page.goto('/projects')
  await page.waitForLoadState('networkidle')
  const firstProject = page.locator('a[href*="/projects/"]').first()

  if (await firstProject.isVisible()) {
    const href = await firstProject.getAttribute('href') ?? '/projects/[slug]'
    await firstProject.click()
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: screenshotPath('projects', '04-detail') })

    // Stats card
    const statsKeywords = page.getByText(/tasks|notes|captures/i).first()
    if (!(await statsKeywords.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'projects', page: href,
        description: 'Stats card (tasks/notes/captures count) not visible on project detail page.',
        screenshot: screenshotPath('projects', '04-detail'),
      })
    }

    // Health card
    const health = page.getByText(/health/i).first()
    if (!(await health.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'projects', page: href,
        description: 'Project health card not visible on project detail page.',
        screenshot: screenshotPath('projects', '04-detail'),
      })
    }

    // Activity timeline
    const activity = page.getByText(/activity|timeline/i).first()
    if (!(await activity.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'projects', page: href,
        description: 'Activity timeline section not visible on project detail page.',
        screenshot: screenshotPath('projects', '04-detail'),
      })
    }

    // Subprojects
    const subprojects = page.getByText(/subproject|sub-project/i).first()
    if (!(await subprojects.isVisible())) {
      findings.push({
        severity: 'info', type: 'missing-feature', domain: 'projects', page: href,
        description: 'Subprojects section not visible on project detail page.',
        screenshot: screenshotPath('projects', '04-detail'),
      })
    }

    // Recommendations
    const recs = page.getByText(/recommendation|suggest/i).first()
    if (!(await recs.isVisible())) {
      findings.push({
        severity: 'info', type: 'missing-feature', domain: 'projects', page: href,
        description: 'Recommendations section not visible on project detail page.',
        screenshot: screenshotPath('projects', '04-detail'),
      })
    }

    // Scroll down to check if anything cuts off
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(400)
    await page.screenshot({ path: screenshotPath('projects', '05-detail-bottom') })
  } else {
    findings.push({
      severity: 'info', type: 'empty-state', domain: 'projects', page: '/projects',
      description: 'No existing projects available to test the detail page.',
    })
  }

  // ── 4. Console/network errors ──────────────────────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'projects', page: 'see description', description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'projects', page: 'see description', description: err })
  }

  saveFindings('projects', findings)
})
