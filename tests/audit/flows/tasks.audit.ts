import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Tasks: full flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Tasks list (default view) ────────────────────────────────────────
  await page.goto('/tasks')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('tasks', '01-list') })

  // Check view switcher tabs
  const listTab = page.getByRole('tab', { name: /list/i }).or(page.getByRole('button', { name: /^list$/i })).first()
  const calendarTab = page.getByRole('tab', { name: /calendar/i }).or(page.getByRole('button', { name: /calendar/i })).first()
  const kanbanTab = page.getByRole('tab', { name: /kanban|board/i }).or(page.getByRole('button', { name: /kanban|board/i })).first()

  for (const [name, tab] of [['List', listTab], ['Calendar', calendarTab], ['Kanban', kanbanTab]] as [string, typeof listTab][]) {
    if (!(await tab.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'tasks', page: '/tasks',
        description: `"${name}" view tab not visible in task view switcher.`,
        screenshot: screenshotPath('tasks', '01-list'),
      })
    }
  }

  // ── 2. Calendar view ────────────────────────────────────────────────────
  if (await calendarTab.isVisible()) {
    await calendarTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: screenshotPath('tasks', '02-calendar') })

    const calGrid = page.locator('[role="grid"], table').first()
    if (!(await calGrid.isVisible())) {
      findings.push({
        severity: 'high', type: 'broken-ui', domain: 'tasks', page: '/tasks',
        description: 'Calendar grid ([role="grid"] or table) not visible after switching to calendar view.',
        screenshot: screenshotPath('tasks', '02-calendar'),
      })
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    if (overflow) {
      findings.push({
        severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks',
        description: 'Horizontal overflow detected in calendar view at 1280px.',
        screenshot: screenshotPath('tasks', '02-calendar'),
        suggestion: 'Constrain calendar columns to viewport width with overflow-x-hidden.',
      })
    }
  }

  // ── 3. Kanban view ───────────────────────────────────────────────────────
  if (await kanbanTab.isVisible()) {
    await kanbanTab.click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: screenshotPath('tasks', '03-kanban') })

    // Count kanban columns - look for common selectors
    const columns = page.locator('[data-column], [data-status]').or(
      page.locator('.kanban-column')
    )
    const colCount = await columns.count()
    if (colCount < 2) {
      findings.push({
        severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks',
        description: `Kanban view shows ${colCount} columns (expected at least 2: pending + done).`,
        screenshot: screenshotPath('tasks', '03-kanban'),
      })
    }
  }

  // ── 4. Create task dialog ────────────────────────────────────────────────
  // Go back to list view
  if (await listTab.isVisible()) {
    await listTab.click()
    await page.waitForTimeout(400)
  } else {
    await page.goto('/tasks')
    await page.waitForLoadState('networkidle')
  }

  const createBtn = page.getByRole('button', { name: /new task|add task/i }).first()
  const plusBtn = page.locator('button[aria-label*="create" i], button[aria-label*="new task" i]').first()

  const createVisible = await createBtn.isVisible() || await plusBtn.isVisible()
  if (!createVisible) {
    findings.push({
      severity: 'critical', type: 'dead-end', domain: 'tasks', page: '/tasks',
      description: 'No visible "New Task" / "Add Task" button on /tasks page.',
      screenshot: screenshotPath('tasks', '01-list'),
      suggestion: 'Add a prominent CTA button in the page header.',
    })
  } else {
    const btn = (await createBtn.isVisible()) ? createBtn : plusBtn
    await btn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('tasks', '04-create-dialog') })

    const dialog = page.getByRole('dialog')
    if (!(await dialog.isVisible())) {
      findings.push({
        severity: 'critical', type: 'broken-ui', domain: 'tasks', page: '/tasks',
        description: 'Clicking "New Task" button did not open task create dialog.',
        screenshot: screenshotPath('tasks', '04-create-dialog'),
      })
    } else {
      // Title field
      const titleField = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/title|task name/i)).first()
      if (!(await titleField.isVisible())) {
        findings.push({
          severity: 'high', type: 'broken-ui', domain: 'tasks', page: '/tasks',
          description: 'Title field not visible in task create dialog.',
          screenshot: screenshotPath('tasks', '04-create-dialog'),
        })
      }

      // Priority selector
      const priority = dialog.getByText(/priority/i).first()
      if (!(await priority.isVisible())) {
        findings.push({
          severity: 'low', type: 'missing-feature', domain: 'tasks', page: '/tasks',
          description: 'Priority selector not visible in task create dialog.',
          screenshot: screenshotPath('tasks', '04-create-dialog'),
        })
      }

      // Due date picker
      const dueDateBtn = dialog.getByRole('button', { name: /due date|date/i }).first()
      if (!(await dueDateBtn.isVisible())) {
        findings.push({
          severity: 'medium', type: 'missing-feature', domain: 'tasks', page: '/tasks',
          description: 'Due date picker button not visible in task create dialog.',
          screenshot: screenshotPath('tasks', '04-create-dialog'),
        })
      } else {
        await dueDateBtn.click()
        await page.waitForTimeout(400)
        const calPopover = page.locator('.rdp, [role="dialog"] [role="grid"]').first()
        if (!(await calPopover.isVisible())) {
          findings.push({
            severity: 'medium', type: 'broken-ui', domain: 'tasks', page: '/tasks',
            description: 'Date picker popover did not open after clicking due date button.',
            screenshot: screenshotPath('tasks', '04-create-dialog'),
          })
        } else {
          await page.keyboard.press('Escape')
          await page.waitForTimeout(200)
        }
      }

      // Recurrence
      const recurrence = dialog.getByText(/recur|repeat/i).first()
      if (!(await recurrence.isVisible())) {
        findings.push({
          severity: 'low', type: 'missing-feature', domain: 'tasks', page: '/tasks',
          description: 'Recurrence picker not visible in task create dialog.',
          screenshot: screenshotPath('tasks', '04-create-dialog'),
        })
      }

      // Submit a task
      const titleInput = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/title|task name/i)).first()
      if (await titleInput.isVisible()) {
        await titleInput.fill('Audit Test Task')
        const submitBtn = dialog.getByRole('button', { name: /create|save|add/i }).first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
          await page.waitForTimeout(1000)
          await page.screenshot({ path: screenshotPath('tasks', '05-after-create') })
          if (await dialog.isVisible()) {
            findings.push({
              severity: 'high', type: 'dead-end', domain: 'tasks', page: '/tasks',
              description: 'Task create dialog did not close after submitting — task may not have been created.',
              screenshot: screenshotPath('tasks', '05-after-create'),
            })
            await page.keyboard.press('Escape')
          }
        }
      } else {
        await page.keyboard.press('Escape')
      }
    }
  }

  // ── 5. Complete a task ────────────────────────────────────────────────────
  await page.waitForTimeout(500)
  const checkbox = page.locator('[type="checkbox"]').first()
  if (await checkbox.isVisible()) {
    await checkbox.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('tasks', '06-completed') })

    // Expect some visual completion state
    const completed = page.locator('s, .line-through, [data-completed="true"], [data-status="completed"]').first()
    if (!(await completed.isVisible())) {
      findings.push({
        severity: 'medium', type: 'ux-friction', domain: 'tasks', page: '/tasks',
        description: 'Completing a task shows no visible strikethrough or completion state change.',
        screenshot: screenshotPath('tasks', '06-completed'),
        suggestion: 'Apply line-through styling and dim completed tasks for clear visual feedback.',
      })
    }
  } else {
    findings.push({
      severity: 'info', type: 'empty-state', domain: 'tasks', page: '/tasks',
      description: 'No checkboxes visible on task list — cannot test task completion flow.',
    })
  }

  // ── 6. Bulk select ────────────────────────────────────────────────────────
  const taskRows = page.locator('[data-task-id], [role="listitem"]')
  const rowCount = await taskRows.count()
  if (rowCount >= 2) {
    await taskRows.nth(0).click()
    await page.keyboard.down('Shift')
    await taskRows.nth(1).click()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(400)
    await page.screenshot({ path: screenshotPath('tasks', '07-bulk') })

    const bulkToolbar = page.locator('[data-bulk-toolbar]')
      .or(page.getByText(/selected/i).first().locator('xpath=ancestor::div[1]'))
    if (!(await bulkToolbar.isVisible())) {
      findings.push({
        severity: 'medium', type: 'ux-friction', domain: 'tasks', page: '/tasks',
        description: 'Shift+clicking 2 tasks did not surface a bulk action toolbar.',
        screenshot: screenshotPath('tasks', '07-bulk'),
        suggestion: 'Show bulk toolbar with count + action buttons when 2+ tasks selected.',
      })
    }
    await page.keyboard.press('Escape')
  }

  // ── 7. Console/network errors ─────────────────────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'tasks', page: 'see description', description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'tasks', page: 'see description', description: err })
  }

  saveFindings('tasks', findings)
})
