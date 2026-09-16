import * as fs from 'fs'
import * as path from 'path'

const FINDINGS_DIR = path.join(process.cwd(), 'tests/audit/findings')

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

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
  if (!fs.existsSync(FINDINGS_DIR)) {
    console.error(`No findings directory found at ${FINDINGS_DIR}. Run audit scripts first.`)
    process.exit(1)
  }
  const files = fs.readdirSync(FINDINGS_DIR).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    console.error('No findings JSON files found. Run audit scripts first.')
    process.exit(1)
  }
  const all: Finding[] = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(FINDINGS_DIR, file), 'utf-8')
    const data: FindingsFile = JSON.parse(raw)
    all.push(...data.findings)
  }
  return all.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  )
}

function groupByDomain(findings: Finding[]): Record<string, Finding[]> {
  return findings.reduce(
    (acc, f) => {
      ;(acc[f.domain] = acc[f.domain] ?? []).push(f)
      return acc
    },
    {} as Record<string, Finding[]>
  )
}

function generateMarkdown(findings: Finding[]): string {
  const grouped = groupByDomain(findings)
  const bySeverity = Object.keys(SEVERITY_ORDER).map((s) => ({
    severity: s,
    count: findings.filter((f) => f.severity === s).length,
  }))

  let md = `# Brain Portal — UX Audit Report\n\n`
  md += `**Generated:** ${new Date().toISOString()}\n\n`
  md += `## Summary\n\n`
  md += `**Total findings:** ${findings.length}\n\n`
  md += `| Severity | Count |\n|---|---|\n`
  for (const { severity, count } of bySeverity) {
    if (count > 0) md += `| ${severity.toUpperCase()} | ${count} |\n`
  }
  md += `\n---\n\n`

  for (const [domain, items] of Object.entries(grouped)) {
    md += `## ${domain.charAt(0).toUpperCase() + domain.slice(1)} (${items.length})\n\n`
    for (const f of items) {
      md += `### [${f.severity.toUpperCase()}] ${f.type} — \`${f.page}\`\n\n`
      md += `${f.description}\n\n`
      if (f.suggestion) md += `**Suggestion:** ${f.suggestion}\n\n`
      if (f.screenshot) {
        const rel = path.relative(process.cwd(), f.screenshot)
        md += `**Screenshot:** \`${rel}\`\n\n`
      }
      md += `---\n\n`
    }
  }
  return md
}

function screenshotTag(screenshotAbs: string | undefined): string {
  if (!screenshotAbs) return ''
  if (!fs.existsSync(screenshotAbs)) return ''
  const rel = path.relative(FINDINGS_DIR, screenshotAbs)
  return `<img src="${rel}" style="max-width:100%;border-radius:4px;margin-top:8px;" loading="lazy" />`
}

function generateHtml(findings: Finding[]): string {
  const grouped = groupByDomain(findings)
  const bySeverity = Object.keys(SEVERITY_ORDER).map((s) => ({
    severity: s,
    count: findings.filter((f) => f.severity === s).length,
  }))

  const summaryRows = bySeverity
    .filter(({ count }) => count > 0)
    .map(
      ({ severity, count }) =>
        `<tr><td><span style="background:${SEVERITY_COLORS[severity]};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;">${severity.toUpperCase()}</span></td><td style="padding-left:12px;font-weight:bold;">${count}</td></tr>`
    )
    .join('\n')

  const domainSections = Object.entries(grouped)
    .map(([domain, items]) => {
      const cards = items
        .map((f) => {
          const color = SEVERITY_COLORS[f.severity] ?? '#6b7280'
          return `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;background:#fafafa;">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
            <span style="background:${color};color:white;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:4px;text-transform:uppercase;white-space:nowrap;">${f.severity}</span>
            <span style="background:#f3f4f6;font-size:11px;padding:2px 8px;border-radius:4px;white-space:nowrap;">${f.type}</span>
            <code style="font-size:12px;color:#6b7280;">${f.page}</code>
          </div>
          <p style="margin:0 0 8px;line-height:1.5;">${f.description}</p>
          ${f.suggestion ? `<p style="margin:0 0 8px;color:#2563eb;font-size:13px;"><strong>Suggestion:</strong> ${f.suggestion}</p>` : ''}
          ${screenshotTag(f.screenshot)}
        </div>`
        })
        .join('\n')

      return `
    <details open style="margin-bottom:24px;">
      <summary style="cursor:pointer;font-size:20px;font-weight:700;padding:10px 0;list-style:none;display:flex;align-items:center;gap:12px;">
        ${domain.charAt(0).toUpperCase() + domain.slice(1)}
        <span style="font-size:14px;font-weight:normal;color:#6b7280;">${items.length} finding${items.length !== 1 ? 's' : ''}</span>
      </summary>
      <div style="padding-top:8px;">
        ${cards}
      </div>
    </details>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Brain Portal — UX Audit Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 24px; color: #111827; }
    h1 { font-size: 28px; margin-bottom: 4px; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 13px; font-family: monospace; }
    table { border-collapse: collapse; }
    td { padding: 6px 8px; }
    details > summary::-webkit-details-marker { display: none; }
  </style>
</head>
<body>
  <h1>Brain Portal — UX Audit Report</h1>
  <p style="color:#6b7280;margin-top:4px;">Generated: ${new Date().toISOString()}</p>
  <p><strong>Total findings:</strong> ${findings.length}</p>

  <table style="margin:16px 0;">
    ${summaryRows}
  </table>

  <hr style="margin:32px 0;" />

  ${domainSections}
</body>
</html>`
}

// ── Main ──────────────────────────────────────────────────────────────────────
const findings = loadAllFindings()
const md = generateMarkdown(findings)
const html = generateHtml(findings)

fs.writeFileSync(path.join(FINDINGS_DIR, 'report.md'), md)
fs.writeFileSync(path.join(FINDINGS_DIR, 'report.html'), html)

const grouped = groupByDomain(findings)

console.log(`\n✅ Report generated:`)
console.log(`   ${path.join(FINDINGS_DIR, 'report.md')}`)
console.log(`   ${path.join(FINDINGS_DIR, 'report.html')}`)
console.log(`\n📊 ${findings.length} total findings across ${Object.keys(grouped).length} domain(s)`)

const bySev = Object.keys(SEVERITY_ORDER).filter(
  (s) => findings.some((f) => f.severity === s)
)
for (const s of bySev) {
  const count = findings.filter((f) => f.severity === s).length
  console.log(`   ${s.padEnd(8)} ${count}`)
}
