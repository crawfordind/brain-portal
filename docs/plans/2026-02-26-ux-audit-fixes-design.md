# UX Audit Fixes — Design Document

**Date:** 2026-02-26
**Source:** Playwright UX audit — 168 raw findings collapsed to 8 confirmed real issues.

---

## Confirmed Issues

### P1: Bugs (fix immediately)

**1. Non-serializable Server→Client props**
`Only plain objects can be passed to Client Components from Server Components` fires ~60× per page load. A non-plain value (Date object, class instance, or similar) is being passed through a Server Component boundary. Causes React hydration warnings and potential runtime failures.
Fix: Find the Server Component passing non-plain data, convert Date/class values to primitives (ISO strings, plain objects) before passing as props.

**2. Nested `<button>` elements**
`In HTML, <button> cannot be a descendant of <button>` fires on the dashboard. An interactive element is wrapping another interactive element. Causes broken click behaviour and hydration errors.
Fix: Find the nested button in the component tree, restructure so interactive elements are siblings not children.

**3. `DialogContent` missing `DialogTitle`**
All dialogs (task create, project create, agent delegation, mobile sheet) fire `DialogContent requires a DialogTitle`. Screen readers can't announce the dialog purpose.
Fix: Add `<DialogTitle>` (visible or visually-hidden with `sr-only`) to every `DialogContent` in the codebase.

### P2: UX Friction

**4. Notes `/notes/new` no slug redirect**
After typing and auto-saving a new note, the URL stays at `/notes/new`. Users cannot bookmark, share, or refresh without losing context. The note IS saved (auto-save works) but the URL never updates.
Fix: In the new note page, once a slug is assigned after first save, use `router.replace('/notes/[slug]')` to update the URL without adding to history.

**5. Mobile search button 40×40px**
The header search icon button measures 40×40px at both 375px and 768px — 4px below the 44px WCAG 2.5.5 / Apple HIG minimum. Affects every page on mobile.
Fix: Add `min-h-[44px] min-w-[44px]` to the search button in the mobile header component.

**6. Task create dialog not a Sheet on mobile**
At 768px the task create dialog renders as a floating 448px-wide centered popup. On mobile, full-screen bottom sheets are the expected pattern (already used for other dialogs in the app per CLAUDE.md).
Fix: Wrap the task create trigger in a responsive component that renders `<Dialog>` on desktop and `<Sheet>` on mobile (using the `useIsMobile` hook already in the codebase).

### P3: Polish

**7. No save status in note editor**
After typing, there is no visual feedback that the note was auto-saved. Users have no confidence their work is persisted. The auto-save logic exists (`SaveStatus` component exists in the codebase) but may not be wired to the new-note editor.
Fix: Ensure `SaveStatus` (or equivalent) is rendered in the note editor toolbar and reflects the current save state.

**8. `/agents` empty state**
When no agent tasks exist, the page renders a blank area with no explanation. New users don't understand what the feature does or how to start.
Fix: Add an empty state component with a heading ("No agent tasks yet"), a brief description of what AI delegation does, and a CTA button linking to `/tasks` to create and delegate a task.

---

## Architecture Notes

- No new tables or API routes needed — all fixes are UI-layer changes.
- The `useIsMobile` hook (from `src/hooks/use-mobile.ts`) handles breakpoint detection for issue 6.
- The `SaveStatus` component (`src/components/editor/`) handles issue 7.
- Radix UI `DialogTitle` accepts `className="sr-only"` for visually-hidden accessible titles (issue 3).
- For issue 1 (serialization), the fix location needs to be found by tracing the console error stack — likely in a dashboard Server Component passing dates.

---

## Out of Scope

- Issues 5–7 from the original 14 (calendar grid, kanban columns, notes filter tabs, etc.) — confirmed false positives.
- Keyboard shortcut detection failures — Linux `Meta` ≠ Mac `Cmd`, audit environment limitation.
- Agent Revise/Reject and project health card — present in code, conditionally shown by design.
