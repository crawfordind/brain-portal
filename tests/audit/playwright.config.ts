import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './',
  testMatch: '**/*.audit.ts',
  timeout: 60_000,
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
