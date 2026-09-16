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
  fs.writeFileSync(
    file,
    JSON.stringify(
      { domain, findings, generatedAt: new Date().toISOString() },
      null,
      2
    )
  )
  console.log(`\n📋 ${domain}: ${findings.length} findings saved to ${file}`)
}

export function screenshotPath(domain: string, name: string): string {
  ensureDirs()
  return path.join(SCREENSHOTS_DIR, `${domain}-${name}.png`)
}
