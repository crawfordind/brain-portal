# Rebrand: Brain Portal → DC Brain Portal

**Date:** 2026-02-26
**Status:** Approved

## Summary

Rebrand the application from "Brain Portal" to "DC Brain Portal" across all user-facing text. Internal code identifiers (class names, package.json name, directory) are left unchanged.

## Decisions

| Question | Decision |
|---|---|
| Short name for tight spaces | `DC` |
| Code internals (class names, package name) | Leave unchanged |
| Hardcoded URLs (`brain-portal.vercel.app`, `brain-portal.app`) | Remove entirely |
| Voice wake phrase | `Hey DC` |
| Implementation approach | Manual targeted edits (surgical, low risk) |

## String Mapping

| Old | New | Context |
|---|---|---|
| `Brain Portal` | `DC Brain Portal` | Full name contexts |
| `Brain Portal` (short/title) | `DC` | Nav sidebar, browser tab short title |
| `brain-portal-vault-*.zip` | `dc-vault-*.zip` | Export filenames |
| `brain-portal-export-*.json` | `dc-export-*.json` | Export filenames |
| `Hey Brain Portal` | `Hey DC` | Voice wake phrase |
| `https://brain-portal.vercel.app` | *(removed)* | Shared page, User-Agent |
| `https://brain-portal.app` | *(removed)* | Export markdown header |
| `A systems designer's second brain` | `DC Brain Portal — personal knowledge system` | App description |

## Files to Edit

### UI / Layout
- `src/app/layout.tsx` — page title, description metadata
- `src/app/manifest.ts` — PWA `name`, `short_name`
- `src/components/layout/responsive-layout.tsx` — nav sidebar title
- `src/app/auth/login/page.tsx` — login card title

### Auth / Email
- `src/app/api/auth/login/route.ts` — magic link email subject and body
- `src/lib/email/index.ts` — email from name

### Export
- `src/lib/export/markdown-export.ts` — vault export header text, filename
- `src/app/api/export/markdown/route.ts` — Content-Disposition filename
- `src/app/(dashboard)/settings/page.tsx` — export filenames, description text

### Voice
- `src/components/voice/voice-settings-panel.tsx` — wake phrase label

### Services / AI
- `src/lib/services/link-metadata.ts` — User-Agent string (remove URL)
- `src/lib/services/link-scraper.ts` — User-Agent string (remove URL)
- `src/lib/navigation.ts` — app name constant
- `src/lib/ai/client.ts` — X-Title header

### Shared Page
- `src/app/shared/[token]/page.tsx` — "Shared with DC Brain Portal", remove URL and CTA button

### Skip (comments only, no functional impact)
- `src/lib/db/schema.ts`
- `src/lib/import/obsidian.ts`
- `src/lib/ai/prompts.ts`
- `src/components/filters/index.ts`
- `src/components/voice/README.md`

## Out of Scope

- Directory/repository name (`brain-portal/`)
- `package.json` name field
- Internal class names (`BrainPortalDB`)
- Database schema or migrations
