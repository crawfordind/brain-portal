# P1 Features Design: NL Task Creation + Project Health Insights

**Date:** 2026-02-22
**Status:** Approved

---

## Context

Two real P1 items remain. Two others were discovered to already be built:
- ✅ **Markdown Export** — `GET /api/export/markdown` already ships full Obsidian-compatible ZIP
- ✅ **Agent Activity Dashboard** — `AgentDashboard` component already live in `/agents → Dashboard` tab

Real P1 work:
1. **Natural Language Task Creation** — LLM-powered on-submit parsing
2. **Project Health Insights** — rule-based health scoring + AI summary on project page + dashboard feed

---

## Feature 1: Natural Language Task Creation

### Problem

The current `detectAgentFromText()` function in `task-create-dialog.tsx` uses keyword regex only. It cannot parse dates ("by Friday"), priority keywords ("urgent"), or structured tags from free-form text. Users must manually fill in Priority, Due Date, and agent separately.

### Design

**On-submit LLM parsing.** When a user submits a task, the server calls the `fast_llm` tier to extract structured fields from the raw text before saving.

**Data flow:**
1. User types `"Write blog post about AI by Friday urgent"` → clicks Create Task
2. `POST /api/tasks` receives `content` as before
3. Server calls `parseTaskNL(content, today)` from `src/lib/tasks/parse.ts`
4. LLM returns JSON: `{title, dueDate, priority, agent, tags}`
5. Parsed fields used for insert — clean title replaces raw content
6. Response includes `parsed` object
7. Frontend toast: `"Task created · due Fri Feb 27 · urgent · Writer"`
8. Silent fallback if LLM fails: save raw content with `priority: 'medium'`

**LLM prompt (fast_llm, ~$0.30/M tokens):**
```
Today is ${today}. Parse this task description and return JSON only, no explanation:
{
  "title": "cleaned task title without date/priority/agent keywords",
  "dueDate": "YYYY-MM-DD or null",
  "priority": "low|medium|high|urgent or null",
  "agent": "code|copy|research|marketing|analyst|general or null",
  "tags": ["tag1", "tag2"]
}
Task: "${content}"
```

**Caching:** Results cached in `ai_cache` table with key `parse:${sha256(content)}`, TTL 24h. Identical task text never re-parsed.

### Files Changed

| File | Change |
|------|--------|
| `src/lib/tasks/parse.ts` | **New** — `parseTaskNL(content: string, today: string): Promise<ParsedTask \| null>` |
| `src/app/api/tasks/route.ts` | POST handler calls `parseTaskNL`, merges parsed fields into insert |
| `src/components/tasks/task-create-dialog.tsx` | Reads `parsed` from response, builds descriptive toast; removes `detectAgentFromText()` |

### Error Handling

- Wrap `parseTaskNL` in try/catch — returns `null` on any failure
- If null: proceed with `{title: content, priority: 'medium', dueDate: null, agent: null, tags: []}`
- No user-visible error; task is created normally

### Testing

- Unit: `parseTaskNL` with mocked `complete()` returning valid JSON
- Unit: `parseTaskNL` fallback when `complete()` throws or returns malformed JSON
- Unit: `parseTaskNL` fallback when `complete()` returns non-JSON text
- Integration: POST `/api/tasks` with NL content verifies parsed fields saved

---

## Feature 2: Project Health Insights

### Problem

Projects can go stale without any visual signal. Users only discover a project is neglected when they manually open it. There's no proactive "this project needs attention" signal on the project page or dashboard.

### Design

**Rule-based health scoring** (instant SQL, no LLM for basic check) + **optional AI summary** (LLM, 48h cache) when at-risk.

**Health rules:**

| Rule | Condition | Severity |
|------|-----------|----------|
| No activity | `MAX(notes.updated_at) < now - 7d` AND open tasks exist | `warning` |
| Overdue pressure | Overdue tasks count > 3 | `warning` |
| Stalled | No task completed in 14d AND project `status = 'active'` | `at-risk` |

`healthy: true` when no rules fire.

**Project page data flow:**
1. Project detail page fetches `GET /api/projects/[id]/health`
2. Route runs 3 fast SQL queries
3. If any rule fires: calls `full_llm` for 1-sentence risk summary, cached 48h in `ai_cache` (key: `health:${project_id}:${flagHash}`)
4. Returns `{healthy, flags, summary, stats}` where `stats = {openTasks, overdueTasks, lastNoteDate, lastCompletionDate}`
5. `<ProjectHealthCard>` renders above existing CollapsibleSections when `!healthy`
6. Card hidden entirely when `healthy: true`

**Dashboard feed data flow:**
1. `/api/projects/[id]/health` upserts an `insights` record when at-risk: `insight_type = 'gap'`, `metadata = {project_id, health_flags, project_name}`
2. When health clears, marks insight as `is_dismissed = true`
3. Existing dashboard AI Insights feed renders this automatically — no dashboard component changes needed

**`insights` table note:** Uses existing `insight_type = 'gap'` (no schema change needed). The CHECK constraint already includes `'gap'`.

### Files Changed

| File | Change |
|------|--------|
| `src/app/api/projects/[id]/health/route.ts` | **New** — GET handler, 3 rule queries + LLM summary + insight upsert |
| `src/components/projects/project-health-card.tsx` | **New** — compact card with severity badge, flag list, AI summary, stats |
| `src/app/(dashboard)/projects/[slug]/page.tsx` | Add `<ProjectHealthCard projectId={project.id} />` above CollapsibleSections |

### ProjectHealthCard Component

```
┌─────────────────────────────────────────────┐
│ ⚠ Project Health                  at-risk   │
│                                             │
│ No notes updated in 8 days                  │
│ 5 overdue tasks                             │
│                                             │
│ "This project has stalled — last task       │
│  completed 16 days ago with 5 open items."  │
└─────────────────────────────────────────────┘
```

- `warning` severity: amber badge
- `at-risk` severity: red badge
- AI summary shown only when available (graceful degradation if LLM fails)

### Error Handling

- If LLM summary fails: show rule-based flags without summary (card still renders)
- If health API fails: project page renders normally without health card (silent failure)
- Insight upsert failure: log, don't block health response

### Testing

- Unit: each health rule fires correctly with mock data
- Unit: `healthy: true` when no rules match
- Unit: insight upsert called when at-risk; dismiss called when healthy
- Unit: LLM summary skipped when healthy
- Integration: GET `/api/projects/[id]/health` returns correct structure

---

## Bundled Fix

**`task-edit-dialog.tsx`** — deduplicate `recurrenceRule` and `recurrenceEndDate` state declarations (currently declared twice at lines 54-55 and 57-58, causing TypeScript error).

---

## Implementation Notes

- Both features use graceful degradation — LLM failures never block core functionality
- `fast_llm` for task parsing (~0.30/M), `full_llm` for health summary (~$1.50/M, 48h cached)
- No new DB tables — leverages existing `ai_cache` and `insights`
- `detectAgentFromText()` regex removed entirely from `task-create-dialog.tsx` (LLM supersedes it)
