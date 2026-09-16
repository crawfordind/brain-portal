# Brain Portal — Feature Inventory
> Last updated: 2026-02-19

---

## Table of Contents

1. [Authentication & Users](#1-authentication--users)
2. [Core Content Management](#2-core-content-management)
3. [Task & Project Management](#3-task--project-management)
4. [AI & Intelligent Features](#4-ai--intelligent-features)
5. [AI Agent Delegation System](#5-ai-agent-delegation-system)
6. [Search & Discovery](#6-search--discovery)
7. [Knowledge Graph](#7-knowledge-graph)
8. [Voice Features](#8-voice-features)
9. [Offline & Sync](#9-offline--sync)
10. [Attachments & File Storage](#10-attachments--file-storage)
11. [Sharing](#11-sharing)
12. [Import & Migration](#12-import--migration)
13. [Dashboard & Views](#13-dashboard--views)
14. [UX & Accessibility](#14-ux--accessibility)
15. [Technical & Infrastructure](#15-technical--infrastructure)

---

## 1. Authentication & Users

| Feature | Status | Notes |
|---|---|---|
| Magic link (passwordless) email auth | ✅ Done | 15-min expiry, no passwords |
| HTTP-only session cookies | ✅ Done | 30-day session |
| Auto account creation on first login | ✅ Done | |
| Dev-mode auto-link generation | ✅ Done | No email needed in dev |

---

## 2. Core Content Management

### Notes

| Feature | Status | Notes |
|---|---|---|
| Full CRUD | ✅ Done | |
| TipTap markdown editor | ✅ Done | Real-time markdown shortcuts |
| Centered cursor (VS Code-like) | ✅ Done | |
| Auto-save | ✅ Done | |
| Note types: regular, daily, weekly, insight | ✅ Done | |
| Pin & archive | ✅ Done | |
| Frontmatter / metadata | ✅ Done | |
| Word count tracking | ✅ Done | |
| Full-text search (FTS5 / BM25 ranking) | ✅ Done | With highlighted snippets |
| Filter by project, type, pinned, archived | ✅ Done | |
| Share notes via public link | ✅ Done | Read-only, rate-limited |
| Voice input in editor | ✅ Done | |
| Inline attachment insertion | ✅ Done | |

### Daily Notes

| Feature | Status | Notes |
|---|---|---|
| One-per-day auto template | ✅ Done | |
| Morning focus field | ✅ Done | |
| Tasks checklist | ✅ Done | |
| Work log section | ✅ Done | |
| End-of-day reflection | ✅ Done | What went well, improvements, key insight |
| Mood & energy tracking (1–5) | ✅ Done | |
| Auto-link captures to daily note | ✅ Done | |

### Weekly Reviews

| Feature | Status | Notes |
|---|---|---|
| AI-generated weekly summary | ✅ Done | |
| Stats: tasks completed, notes created, captures | ✅ Done | |
| Stored as special note type | ✅ Done | |
| One-per-week constraint | ✅ Done | |

### Captures (Quick Thoughts)

| Feature | Status | Notes |
|---|---|---|
| Capture types: thought, idea, follow-up, task, quote, reference, link | ✅ Done | |
| Link capture with metadata scraping | ✅ Done | Title, description, favicon, OG image |
| Full page content scraping | ✅ Done | Word count of scraped content |
| Link to notes & projects | ✅ Done | |
| AI classification of capture type | ✅ Done | |
| Convert capture to task | ✅ Done | |

### Tags

| Feature | Status | Notes |
|---|---|---|
| Create & manage tags | ✅ Done | |
| Color-coded tags | ✅ Done | |
| Usage count tracking | ✅ Done | |
| Note-tag associations | ✅ Done | |

---

## 3. Task & Project Management

### Tasks

| Feature | Status | Notes |
|---|---|---|
| Full CRUD | ✅ Done | |
| Status: pending, in_progress, completed, cancelled | ✅ Done | |
| Priority: low, medium, high, urgent | ✅ Done | |
| Due dates & scheduled dates | ✅ Done | |
| Estimated completion with accuracy tracking | ✅ Done | |
| List view with filtering | ✅ Done | |
| Calendar view (week strip + day detail) | ✅ Done | |
| Kanban view (by status) | ✅ Done | |
| Backlog sidebar | ✅ Done | |
| Bulk operations (status, project, delete) | ✅ Done | |
| Task recommendations (AI-scanned) | ✅ Done | From notes, daily notes, captures |
| Delegate task to AI agent | ✅ Done | |
| Save AI output as note | ✅ Done | |
| Task tags (JSON array) | ✅ Done | |

### Task Recommendations

| Feature | Status | Notes |
|---|---|---|
| Auto-scan notes/captures for task candidates | ✅ Done | |
| Confidence score + priority + reasoning | ✅ Done | |
| User feedback: accept, reject, dismiss | ✅ Done | |
| 30-day auto-expiry | ✅ Done | |
| Deduplication | ✅ Done | |
| Recommendation learning from feedback | ✅ Done | |

### Projects

| Feature | Status | Notes |
|---|---|---|
| Full CRUD | ✅ Done | |
| Hierarchical (parent-child) | ✅ Done | Nested subprojects |
| Status: active, planning, stalled, completed, archived | ✅ Done | |
| Color & icon customization | ✅ Done | |
| Priority levels | ✅ Done | |
| Stats: note count, open task count, activity | ✅ Done | |
| Project-scoped captures, tasks, connections, insights | ✅ Done | |

---

## 4. AI & Intelligent Features

### Tiered Processing Architecture

| Tier | Cost | Cache TTL | What it Does |
|---|---|---|---|
| Local | Free | — | Link extraction, word count, structure analysis, wikilink extraction |
| Embedding | $0.02/M tokens | 7 days | 1536-dim vector embeddings, semantic similarity |
| Fast LLM | $0.30/M tokens | 24h | Summaries, auto-tags (3–5), capture classification |
| Full LLM | $1.50/M tokens | 48h | Insights, weekly reviews, complex analysis |

### AI Capabilities

| Feature | Status | Notes |
|---|---|---|
| Semantic search (embeddings) | ✅ Done | Cosine similarity, configurable threshold |
| Similar note discovery | ✅ Done | |
| Auto-tagging (3–5 tags) | ✅ Done | |
| Note summaries (1–2 sentences) | ✅ Done | |
| Insight generation | ✅ Done | 8 insight types (connection, theme, action, question, pattern, summary, gap, leverage) |
| Weekly review generation | ✅ Done | |
| Capture classification | ✅ Done | |
| Task candidate detection | ✅ Done | |
| Context-aware AI agent delegation | ✅ Done | Pulls in top-3 related notes via embeddings |
| AI response caching | ✅ Done | Tier-based TTL, cost + hit tracking |
| Link metadata + full page scraping | ✅ Done | |

---

## 5. AI Agent Delegation System

### Agent Types

| Agent | Role |
|---|---|
| Code | Software development, debugging, documentation |
| Copy | Content creation, blog posts, emails |
| Research | Information gathering, analysis |
| Marketing | Ad copy, campaigns, conversion |
| Analyst | Data analysis, insights, recommendations |
| General | Brainstorming, planning, general tasks |
| UX | User experience, design, usability |

### Workflow

| Feature | Status | Notes |
|---|---|---|
| Create delegated task with agent type | ✅ Done | |
| Auto context building (task + linked notes + top-3 semantic notes) | ✅ Done | |
| URL context injection | ✅ Done | |
| Queued background processing | ✅ Done | |
| Status: queued → processing → awaiting_review → approved/rejected | ✅ Done | |
| Up to 5 revision rounds | ✅ Done | |
| Stuck task auto-reset | ✅ Done | |
| Review panel (approve / revise / reject) | ✅ Done | |
| Token & processing time tracking | ✅ Done | |
| Save approved output as note (with full metadata) | ✅ Done | |
| Bidirectional task ↔ agent_task linking | ✅ Done | |
| Automatic status sync | ✅ Done | |

---

## 6. Search & Discovery

| Feature | Status | Notes |
|---|---|---|
| Unified search (Cmd+K) | ✅ Done | Cross-entity, always accessible |
| FTS5 full-text search with BM25 ranking | ✅ Done | |
| LIKE-based fallback | ✅ Done | |
| Highlighted snippets in results | ✅ Done | |
| Search across: notes, captures, tasks, attachments | ✅ Done | |
| Filter by type, project, file type | ✅ Done | |
| Quick Actions on empty search | ✅ Done | Discoverability |
| Mobile full-screen search overlay | ✅ Done | |
| Keyboard shortcuts: Cmd+Shift+C, Cmd+Shift+D | ✅ Done | |

---

## 7. Knowledge Graph

| Feature | Status | Notes |
|---|---|---|
| Visual graph of note connections | ✅ Done | |
| Nodes color-coded by project | ✅ Done | |
| Node metadata: connection count, word count, pin status | ✅ Done | |
| Typed edges: related, references, extends, contradicts, supports | ✅ Done | |
| Manual vs. discovered connection distinction | ✅ Done | |
| Connection strength (0–1) | ✅ Done | |
| Interactive: drag, zoom, pan | ✅ Done | |
| Filter by project | ✅ Done | |
| Note preview on hover | ✅ Done | |

---

## 8. Voice Features

| Feature | Status | Notes |
|---|---|---|
| Voice capture (floating action button) | ✅ Done | Always accessible |
| Speech-to-text transcription | ✅ Done | |
| Voice commands for app navigation | ✅ Done | |
| Voice input directly in editor | ✅ Done | |
| Real-time transcript bubbles | ✅ Done | |
| Voice settings panel | ✅ Done | |
| First-time voice onboarding | ✅ Done | |

---

## 9. Offline & Sync

| Feature | Status | Notes |
|---|---|---|
| IndexedDB offline storage | ✅ Done | Notes, captures, tasks, projects, daily notes, tags |
| Temp ID system until synced | ✅ Done | |
| Bidirectional sync (push + pull) | ✅ Done | |
| Sync queue with status tracking | ✅ Done | pending → processing → completed/failed |
| Automatic retry on failure | ✅ Done | |
| Offline detection (navigator.onLine) | ✅ Done | |
| Offline fallback page | ✅ Done | |

---

## 10. Attachments & File Storage

| Feature | Status | Notes |
|---|---|---|
| File upload (Cloudflare R2) | ✅ Done | |
| Supported types: images, PDFs, audio, video, documents | ✅ Done | |
| PDF text extraction | ✅ Done | |
| AI-generated file descriptions | ✅ Done | |
| Image thumbnail generation | ✅ Done | |
| Content-hash deduplication | ✅ Done | |
| Attach to notes or projects | ✅ Done | |
| Pin attachments | ✅ Done | |
| Gallery view | ✅ Done | |
| Inline editor insertion | ✅ Done | |
| Side panel (desktop) / bottom sheet (mobile) | ✅ Done | |
| Signed URL secure access | ✅ Done | |
| File search | ✅ Done | Filter by image, pdf, document, audio, video |

---

## 11. Sharing

| Feature | Status | Notes |
|---|---|---|
| Share notes via unique token link | ✅ Done | |
| Read-only public rendering | ✅ Done | |
| SEO meta tags for shared notes | ✅ Done | |
| Rate limiting on public share access | ✅ Done | |
| HTML sanitization on shared content | ✅ Done | |

---

## 12. Import & Migration

| Feature | Status | Notes |
|---|---|---|
| Obsidian vault import | ✅ Done | Bulk import |
| Wikilink `[[note]]` preservation | ✅ Done | Auto-creates connections |
| Frontmatter metadata import | ✅ Done | |

---

## 13. Dashboard & Views

### Dashboard

| Feature | Status | Notes |
|---|---|---|
| Time-aware greeting | ✅ Done | Good morning/afternoon/evening |
| Stats: open tasks, completed today, total notes, active projects, captures this week, productivity % | ✅ Done | |
| Active projects hero section | ✅ Done | |
| Recent notes hero section | ✅ Done | |
| Today's tasks + upcoming scheduled tasks | ✅ Done | |
| Unified AI Insights feed | ✅ Done | All insight types, dismissible |
| Conditional sections (hidden when empty) | ✅ Done | |

### Activity Tracking

| Feature | Status | Notes |
|---|---|---|
| Activity log for all entity types | ✅ Done | |
| Before/after diff storage | ✅ Done | |
| Paginated recent activity endpoint | ✅ Done | |

### Settings

| Feature | Status | Notes |
|---|---|---|
| Theme: light, dark, system | ✅ Done | |
| Voice preferences | ✅ Done | |
| Full data export (JSON) | ✅ Done | |

---

## 14. UX & Accessibility

| Feature | Status | Notes |
|---|---|---|
| Mobile-first responsive design | ✅ Done | Breakpoint at 1024px |
| Desktop sidebar (256px) | ✅ Done | |
| Mobile: header + bottom nav | ✅ Done | |
| 56px minimum touch targets | ✅ Done | WCAG-compliant |
| Keyboard shortcuts (Cmd+K, Cmd+Shift+C, Cmd+Shift+D) | ✅ Done | |
| Toast notifications (success, error, info) | ✅ Done | Auto-dismiss + stackable |
| Skeleton loading states | ✅ Done | |
| Suspense boundaries | ✅ Done | |
| Optimistic UI updates | ✅ Done | |
| Drag-handle modals (mobile) | ✅ Done | |
| Bulk action toolbar | ✅ Done | |
| Error boundaries | ✅ Done | |

---

## 15. Technical & Infrastructure

| Area | Details |
|---|---|
| Framework | Next.js 16 App Router (server + client components) |
| Database | Turso (SQLite edge), FTS5, 13+ tables |
| AI Provider | OpenRouter (default: x-ai/grok-4.1-fast) |
| File Storage | Cloudflare R2 |
| Auth | Magic link via SMTP, HTTP-only cookies |
| Testing | Vitest + React Testing Library |
| Background Jobs | Processing queue with retry logic (max 3 attempts) |
| Caching | Multi-layer: React Query client-side + AI response cache |
| Rate Limiting | IP-based on public endpoints |
| Type Safety | TypeScript throughout, `@/` path alias |
| Embeddings | 1536-dim vectors, content-hash deduplication |
| API Surface | 58+ RESTful endpoints |

---
