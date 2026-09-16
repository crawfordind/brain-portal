import { test } from '../setup/fixtures'
import { saveFindings, screenshotPath } from '../setup/findings'

test.use({ viewport: { width: 1280, height: 800 } })

test('Agents: delegation and review flow audit', async ({ authedPage: page, consoleErrors, networkErrors, findings }) => {
  // ── 1. Agents page ────────────────────────────────────────────────────────
  await page.goto('/tasks?view=queue')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('agents', '01-list') })

  // Heading
  const heading = page.getByRole('heading').first()
  if (!(await heading.isVisible())) {
    findings.push({
      severity: 'medium', type: 'broken-ui', domain: 'agents', page: '/tasks?view=queue',
      description: 'No visible heading on /tasks?view=queue page.',
      screenshot: screenshotPath('agents', '01-list'),
    })
  }

  // Empty state
  const agentItems = page.locator('[data-agent-task]').first()
  if (!(await agentItems.isVisible())) {
    const emptyMsg = page.getByText(/no task|delegate|empty/i).first()
    if (!(await emptyMsg.isVisible())) {
      findings.push({
        severity: 'medium', type: 'empty-state', domain: 'agents', page: '/tasks?view=queue',
        description: 'Agent tasks list appears empty with no explanatory message or onboarding CTA.',
        screenshot: screenshotPath('agents', '01-list'),
        suggestion: 'Add empty state explaining how to delegate a task to an AI agent.',
      })
    }
  }

  // ── 2. Create a task and look for delegate button ─────────────────────────
  await page.goto('/tasks')
  await page.waitForLoadState('networkidle')

  const createBtn = page.getByRole('button', { name: /new task|add task/i }).first()
  if (await createBtn.isVisible()) {
    await createBtn.click()
    await page.waitForTimeout(600)
    const dialog = page.getByRole('dialog')
    if (await dialog.isVisible()) {
      const titleField = dialog.getByLabel(/title/i).or(dialog.getByPlaceholder(/title|task/i)).first()
      if (await titleField.isVisible()) {
        await titleField.fill('Audit: Test AI Delegation')
        const submitBtn = dialog.getByRole('button', { name: /create|save|add/i }).first()
        if (await submitBtn.isVisible()) {
          await submitBtn.click()
          await page.waitForTimeout(1000)
        }
      } else {
        await page.keyboard.press('Escape')
      }
    }
  }

  // Look for delegate button (in task list or task detail)
  const delegateBtn = page.getByRole('button', { name: /delegate/i }).first()
  if (!(await delegateBtn.isVisible())) {
    // Try opening a task detail
    const taskItem = page.locator('[data-task-id]').first()
    if (await taskItem.isVisible()) {
      await taskItem.click()
      await page.waitForTimeout(500)
    }
    const innerDelegate = page.getByRole('button', { name: /delegate/i }).first()
    if (!(await innerDelegate.isVisible())) {
      await page.screenshot({ path: screenshotPath('agents', '02-delegate-missing') })
      findings.push({
        severity: 'high', type: 'ux-friction', domain: 'agents', page: '/tasks',
        description: 'Delegate to AI button not visible on task list or task detail.',
        screenshot: screenshotPath('agents', '02-delegate-missing'),
        suggestion: 'Add "Delegate to AI" as a secondary action in task row hover menu or task detail panel.',
      })
    } else {
      await innerDelegate.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: screenshotPath('agents', '02-delegate-dialog') })
      await checkDelegateDialog(page, findings)
    }
  } else {
    await delegateBtn.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('agents', '02-delegate-dialog') })
    await checkDelegateDialog(page, findings)
  }

  // ── 3. Agent review panel ─────────────────────────────────────────────────
  await page.goto('/tasks?view=queue')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: screenshotPath('agents', '03-review-panel') })

  const awaitingReview = page.getByText(/awaiting review/i).first()
  if (await awaitingReview.isVisible()) {
    await awaitingReview.click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: screenshotPath('agents', '04-review-actions') })

    for (const action of ['Approve', 'Revise', 'Reject']) {
      const btn = page.getByRole('button', { name: new RegExp(action, 'i') }).first()
      if (!(await btn.isVisible())) {
        findings.push({
          severity: 'high', type: 'missing-feature', domain: 'agents', page: '/tasks?view=queue',
          description: `"${action}" action button not visible in agent review panel.`,
          screenshot: screenshotPath('agents', '04-review-actions'),
        })
      }
    }

    const saveAsNote = page.getByRole('button', { name: /save as note|save to note/i }).first()
    if (!(await saveAsNote.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/tasks?view=queue',
        description: '"Save as Note" button not visible in agent review panel.',
        suggestion: 'Show "Save as Note" option for approved tasks.',
      })
    }
  } else {
    findings.push({
      severity: 'info', type: 'empty-state', domain: 'agents', page: '/tasks?view=queue',
      description: 'No tasks awaiting review — approve/revise/reject flow not fully testable without a completed agent task.',
    })
  }

  // ── 4. Console/network errors ─────────────────────────────────────────────
  for (const err of consoleErrors) {
    findings.push({ severity: 'high', type: 'js-error', domain: 'agents', page: 'see description', description: err })
  }
  for (const err of networkErrors) {
    findings.push({ severity: 'medium', type: 'network-error', domain: 'agents', page: 'see description', description: err })
  }

  saveFindings('agents', findings)
})

async function checkDelegateDialog(page: import('@playwright/test').Page, findings: import('../setup/findings').Finding[]) {
  const dialog = page.getByRole('dialog')
  if (!(await dialog.isVisible())) {
    findings.push({
      severity: 'critical', type: 'dead-end', domain: 'agents', page: '/tasks',
      description: 'Clicking "Delegate" did not open the delegation dialog.',
      screenshot: screenshotPath('agents', '02-delegate-dialog'),
    })
    return
  }

  // Check all 6 agent types
  for (const agentType of ['Dev', 'Writer', 'Researcher', 'Marketer', 'Analyst', 'Assistant']) {
    const opt = dialog.getByText(new RegExp(agentType, 'i')).first()
    if (!(await opt.isVisible())) {
      findings.push({
        severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/tasks',
        description: `Agent type "${agentType}" not listed in delegation dialog.`,
        screenshot: screenshotPath('agents', '02-delegate-dialog'),
      })
    }
  }

  // Instructions field
  const instructions = dialog.locator('textarea').first()
  if (!(await instructions.isVisible())) {
    findings.push({
      severity: 'medium', type: 'missing-feature', domain: 'agents', page: '/tasks',
      description: 'No instructions textarea in delegation dialog.',
      screenshot: screenshotPath('agents', '02-delegate-dialog'),
    })
  }

  await page.keyboard.press('Escape')
}
