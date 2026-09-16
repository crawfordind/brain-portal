import { test as base, type Page } from '@playwright/test'
import { createTestSession, SESSION_COOKIE_NAME } from './auth'
import { type Finding, ensureDirs } from './findings'

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
        sameSite: 'Lax',
      },
    ])

    const page = await context.newPage()

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[console.error] ${msg.text()} @ ${page.url()}`)
      }
    })

    page.on('requestfailed', (req) => {
      networkErrors.push(
        `[net fail] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`
      )
    })

    await use(page)

    await context.close()
    await cleanup()
  },
})

export { expect } from '@playwright/test'
