# UX Audit Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 confirmed UX issues discovered by the Playwright audit — 3 P1 bugs, 3 P2 friction points, 2 P3 polish items.

**Architecture:** All fixes are UI-layer changes. No new DB tables or API routes required. Affects `src/lib/db/client.ts`, several `src/components/` files, and `src/app/(dashboard)/notes/new/page.tsx`.

**Tech Stack:** Next.js 16 App Router, React, shadcn/ui (Radix primitives), Tailwind CSS 4, `@libsql/client` (Turso), TanStack Query.

**Design doc:** `docs/plans/2026-02-26-ux-audit-fixes-design.md`

---

## Task 1: Fix DB row serialization (P1)

**Files:**
- Modify: `src/lib/db/client.ts:34`

**Context:**
`@libsql/client`'s `execute()` returns `result.rows` as `Row[]` — these are `ArrayLike` objects with a prototype chain, not plain `{}` objects. React Server Components require all cross-boundary props to be plain serializable objects. This fires `Only plain objects can be passed to Client Components from Server Components` ~60× per dashboard page load.

The single fix is in the `query` helper — spreading each row into a new `{}` makes every downstream caller return plain objects automatically.

**Step 1: Open the file and locate the return statement**

Read `src/lib/db/client.ts`. The current line 34 is:
```typescript
return result.rows as T[];
```

**Step 2: Apply the fix**

Change line 34 to:
```typescript
return result.rows.map(row => ({ ...row })) as T[];
```

**Step 3: Verify the app loads without the console error**

```bash
npm run dev
```

Open http://localhost:3000 in the browser. Open DevTools Console. Confirm zero occurrences of `Only plain objects can be passed`.

**Step 4: Commit**

```bash
git add src/lib/db/client.ts
git commit -m "fix: spread libsql Row objects to plain objects in query helper"
```

---

## Task 2: Find and fix nested `<button>` (P1)

**Files:**
- Investigate: `src/components/dashboard/` (likely culprit)
- Modify: whichever file has the nested button

**Context:**
The audit fired `In HTML, <button> cannot be a descendant of <button>` on the dashboard. Radix's `Checkbox` component renders as `<button role="checkbox">`. If a `Checkbox` (or any interactive element) is placed inside a wrapper that also renders a `<button>`, React will warn and the browser will split the buttons.

Common pattern to look for: a `<button onClick>` wrapper div rendered as a button (via `asChild`) that contains a `Checkbox` or another `Button`.

**Step 1: Find the nested button using React DevTools or console error stack**

Run the dev server and open the browser console on the dashboard (`/`). The React error includes a component stack — read it to find the exact component.

Alternatively, search for patterns where a button-like element wraps a `Checkbox` or another `Button`:

```bash
grep -rn "Checkbox\|<button" src/components/dashboard/ --include="*.tsx"
```

Look specifically for `<button>` (lowercase HTML) that contains child components which themselves render a `<button>`. Also check `<Button asChild>` with a child that contains an interactive element.

**Step 2: Restructure to remove the nesting**

The fix depends on what you find. Typical solutions:

*If a clickable card/row wraps a Checkbox:*
```tsx
// Before: button wrapping a button
<button onClick={handleRowClick}>
  <Checkbox checked={...} />  {/* also a button */}
  <span>Task title</span>
</button>

// After: div as row, checkbox as sibling
<div className="... cursor-pointer" onClick={handleRowClick}>
  <div onClick={e => e.stopPropagation()}>
    <Checkbox checked={...} />
  </div>
  <span>Task title</span>
</div>
```

*If a Button uses `asChild` and the child contains another button:*
```tsx
// Before: Button asChild wrapping a div that has a Button inside
<Button asChild>
  <div>
    <Button>inner</Button>  {/* nested button */}
  </div>
</Button>

// After: remove asChild or restructure so buttons are siblings
```

**Step 3: Confirm the console warning is gone**

Reload the dashboard and verify the `<button> cannot be descendant` warning no longer appears.

**Step 4: Commit**

```bash
git add <modified files>
git commit -m "fix: remove nested button element on dashboard"
```

---

## Task 3: Add `DialogTitle` to all `DialogContent` usages (P1)

**Files:**
- Modify: `src/components/tasks/task-create-dialog.tsx`
- Modify: `src/components/tasks/delegate-task-dialog.tsx`
- Modify: `src/components/tasks/task-edit-dialog.tsx`
- Modify: `src/components/projects/project-create-dialog.tsx`
- Modify: `src/components/layout/quick-capture-dialog.tsx`
- Modify: `src/components/captures/capture-create-dialog.tsx`
- Modify: `src/components/tasks/save-task-as-note-dialog.tsx`
- Modify: `src/components/attachments/attachment-picker.tsx`
- Modify: `src/components/attachments/attachment-viewer.tsx`
- Modify: `src/components/agents/agent-review-focus-panel.tsx`

**Context:**
Radix UI fires `DialogContent requires a DialogTitle` for every dialog that doesn't have one. Screen readers announce dialog purpose from `DialogTitle`. The fix is to add a `<DialogTitle>` (or `<SheetTitle>`) to every `DialogContent`/`SheetContent` that lacks one. Use `className="sr-only"` to hide it visually when it would clutter the UI.

`DialogTitle` is already exported from `@/components/ui/dialog`. `SheetTitle` is exported from `@/components/ui/sheet`.

**Step 1: Find all DialogContent usages missing a DialogTitle**

```bash
# Files with DialogContent
grep -rl "DialogContent" src/components --include="*.tsx"

# Files with DialogTitle (already compliant)
grep -rl "DialogTitle" src/components --include="*.tsx"

# Diff to find non-compliant files
```

The non-compliant files are those in the first list but not the second (excluding `src/components/ui/dialog.tsx` itself).

**Step 2: Add DialogTitle to each dialog**

For each file, import `DialogTitle` (or `SheetTitle`) and add it as the first child of `DialogContent`/`SheetContent`. Use `sr-only` when the title would be redundant with visible header text.

Pattern for dialogs that already have a visible heading via `ModalHeader`:
```tsx
// Before
import { Dialog, DialogContent } from '@/components/ui/dialog';

<DialogContent>
  <ModalHeader title="Create Task" ... />
  {formContent}
</DialogContent>

// After
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

<DialogContent>
  <DialogTitle className="sr-only">Create Task</DialogTitle>
  <ModalHeader title="Create Task" ... />
  {formContent}
</DialogContent>
```

Pattern for SheetContent (task-create-dialog mobile branch):
```tsx
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

<SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
  <SheetTitle className="sr-only">Create Task</SheetTitle>
  <div className="flex flex-col h-full">
    ...
  </div>
</SheetContent>
```

**Step 3: Verify no more DialogTitle warnings**

Open browser DevTools console. Navigate to:
- `/` (dashboard) — open any task dialog
- `/projects` — open project create dialog
- `/tasks` — open task create and delegate dialogs

Confirm zero `DialogContent requires a DialogTitle` warnings.

**Step 4: Commit**

```bash
git add src/components/tasks/ src/components/projects/ src/components/layout/ src/components/captures/ src/components/attachments/ src/components/agents/
git commit -m "fix: add DialogTitle/SheetTitle to all dialogs for accessibility"
```

---

## Task 4: Fix notes URL redirect after save (P2)

**Files:**
- Modify: `src/app/(dashboard)/notes/new/page.tsx`

**Context:**
Two sub-issues:

1. **Auto-save condition too strict** (line 90): `enabled: title.trim() !== "" && content.trim() !== ""` requires BOTH title and content. If the user types only a title (common workflow), auto-save never fires and the URL stays `/notes/new`.

2. **Manual save navigates to `/notes` list** (line 122): When the user clicks the Save button, it navigates to `/notes` regardless of whether the note has a slug. Should navigate to `/notes/[slug]`.

**Step 1: Relax auto-save condition to only require a title**

Current (line 90):
```typescript
enabled: title.trim() !== "" && content.trim() !== "",
```

Change to:
```typescript
enabled: title.trim() !== "",
```

This allows auto-save (and URL update) as soon as a title is typed, matching user expectations.

**Step 2: Fix manual save to navigate to the note slug**

Current `handleSave` (around line 120-122):
```typescript
toast.success(createdNoteId ? "Note saved!" : "Note created!");
router.push("/notes");
```

Change the navigation logic:
```typescript
// Navigate to note slug (use existing slug if auto-save already created it,
// or extract from the just-created response)
if (createdNoteSlug) {
  // Note was already auto-created, navigate to its slug
  toast.success("Note saved!");
  router.push(`/notes/${createdNoteSlug}`);
} else {
  // Note hasn't been auto-saved yet — optimistically navigate
  // (the background save below will create it)
  toast.success("Note created!");
  router.push("/notes");
}
```

But since the manual save path also creates the note (when `createdNoteId` is null), update the background fetch to extract the slug and navigate after creation:

```typescript
const handleSave = async () => {
  if (!title.trim()) {
    toast.error("Please enter a title");
    return;
  }
  if (isSaving) return;

  autoSave.cancelPending();

  const noteData = {
    title: title.trim(),
    content,
    projectId: projectId || null,
  };

  setIsSaving(true);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const url = createdNoteId ? `/api/notes/${createdNoteId}` : "/api/notes";
    const method = createdNoteId ? "PUT" : "POST";

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(noteData),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const result = await response.json();
      const slug = createdNoteSlug || result.note?.slug;
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      toast.success(createdNoteId ? "Note saved!" : "Note created!");
      router.push(slug ? `/notes/${slug}` : "/notes");
    } else {
      throw new Error("Server error");
    }
  } catch {
    addToQueue({
      type: "note",
      operation: createdNoteId ? "update" : "create",
      data: createdNoteId ? { id: createdNoteId, ...noteData } : noteData,
    });
    toast.success(createdNoteId ? "Note saved!" : "Note created (queued)!");
    router.push(createdNoteSlug ? `/notes/${createdNoteSlug}` : "/notes");
  } finally {
    setIsSaving(false);
  }
};
```

**Step 3: Verify the redirect**

1. Open `/notes/new`
2. Type a title (no content) — after 1 second, URL should update to `/notes/[slug]` in the browser address bar
3. Open `/notes/new` again, type title + content, click the Save button — should navigate to `/notes/[slug]` not `/notes`

**Step 4: Commit**

```bash
git add src/app/'(dashboard)'/notes/new/page.tsx
git commit -m "fix: update URL after auto-save and navigate to slug on manual save"
```

---

## Task 5: Fix mobile search button touch target (P2)

**Files:**
- Modify: `src/components/layout/unified-search.tsx:224`

**Context:**
The header search button measures 40×40px (Tailwind `h-10 w-10`) on mobile, 4px below the 44px WCAG 2.5.5 / Apple HIG minimum touch target. Line 224:
```typescript
className="h-10 w-10"
```

**Step 1: Update the button className**

In `src/components/layout/unified-search.tsx`, find the mobile search button (around line 219-227):

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={() => setIsMobileOverlayOpen(true)}
  aria-label="Open search"
  className="h-10 w-10"
>
  <Search className="h-6 w-6" />
</Button>
```

Change `className="h-10 w-10"` to `className="min-h-[44px] min-w-[44px]"`:

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={() => setIsMobileOverlayOpen(true)}
  aria-label="Open search"
  className="min-h-[44px] min-w-[44px]"
>
  <Search className="h-6 w-6" />
</Button>
```

**Step 2: Verify**

Open DevTools → toggle mobile view (375px). Inspect the search button. Confirm computed height and width ≥ 44px.

**Step 3: Commit**

```bash
git add src/components/layout/unified-search.tsx
git commit -m "fix: increase mobile search button to 44px minimum touch target"
```

---

## Task 6: Fix task create dialog on tablet (768px) (P2)

**Files:**
- Modify: `src/hooks/use-mobile.ts`
- Modify: `src/components/tasks/task-create-dialog.tsx:26,56`

**Context:**
`useMobile()` in `src/hooks/use-mobile.ts` uses `MOBILE_BREAKPOINT = 640` (Tailwind `sm`). `task-create-dialog.tsx` calls `useMobile()` to decide whether to render a `<Sheet>` (mobile) or `<Dialog>` (desktop). At 768px (iPad/tablet), `isMobile` is `false`, so the dialog appears as a floating popup instead of a bottom sheet.

The fix: add an optional `breakpoint` parameter to `useMobile` so the task dialog can opt into the wider `md`-breakpoint (768px) without changing behaviour for all other callers.

**Step 1: Add optional breakpoint parameter to `useMobile`**

Current `src/hooks/use-mobile.ts`:
```typescript
const MOBILE_BREAKPOINT = 640; // Tailwind 'sm' breakpoint

export function useMobile(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
      ...
    },
    () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches,
    () => false
  );
}
```

Change to:
```typescript
const MOBILE_BREAKPOINT = 640; // Tailwind 'sm' breakpoint

export function useMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mediaQuery = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
      mediaQuery.addEventListener('change', callback);
      return () => mediaQuery.removeEventListener('change', callback);
    },
    () => window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches,
    () => false
  );
}
```

**Step 2: Update `task-create-dialog.tsx` to use 768px breakpoint**

Current line 56:
```typescript
const isMobile = useMobile();
```

Change to:
```typescript
const isMobile = useMobile(768); // Show Sheet for phones AND tablets (< md)
```

**Step 3: Verify at 768px viewport**

Open DevTools → set viewport to 768px width. Open the task create dialog. Confirm it renders as a bottom Sheet (not a centered popup).

Also verify at 400px (still Sheet) and 1024px (still Dialog) to ensure no regressions.

**Step 4: Commit**

```bash
git add src/hooks/use-mobile.ts src/components/tasks/task-create-dialog.tsx
git commit -m "fix: show task create dialog as Sheet on tablets (< 768px)"
```

---

## Task 7: Verify SaveStatus visibility in note editor (P3)

**Files:**
- Verify: `src/app/(dashboard)/notes/new/page.tsx:186`
- Verify: `src/components/ui/save-status.tsx`

**Context:**
The audit reported "No auto-save status indicator visible after typing" but the `SaveStatus` component is already imported and rendered at line 186 of `notes/new/page.tsx`. This may have been a false positive caused by the audit typing only content (no title), which kept `autoSave.status` in `'idle'` state.

After Task 4's fix (relaxing the auto-save condition to require only a title), the auto-save will fire sooner and `SaveStatus` should show `'saving'` → `'saved'` text.

**Step 1: Read the `SaveStatus` component to understand what text it renders**

Read `src/components/ui/save-status.tsx`. Check what text it shows in each state: `idle`, `saving`, `saved`, `error`.

**Step 2: Verify visually**

1. Open `/notes/new`
2. Type a title (5+ characters)
3. Wait 1 second — the `SaveStatus` indicator should appear near the toolbar showing "Saving..." or similar
4. Wait for save to complete — should show "Saved" or "Saved X seconds ago"

If the text shows correctly, **this task is done with no code changes needed**.

**Step 3: Fix if not showing (only if step 2 fails)**

If `SaveStatus` renders nothing in `idle` state and the transition to `saving` is too brief to notice:

- Ensure the component shows something even in `idle` after at least one save (e.g., "Saved" persists)
- Or adjust the `SaveStatus` component to always be visible once `lastSaved` is set

**Step 4: Commit (only if changes were made)**

```bash
git add src/components/ui/save-status.tsx
git commit -m "fix: ensure SaveStatus is visible after first save in note editor"
```

---

## Task 8: Add empty state to `/agents` page (P3)

**Files:**
- Modify: `src/components/agents/agent-queue.tsx:71-83`

**Context:**
When no agent tasks exist, `agent-queue.tsx` shows "No tasks found" with no explanation. New users don't understand what AI delegation does or how to start. The design calls for: heading, brief description, CTA button linking to `/tasks`.

**Step 1: Read the current empty state in `agent-queue.tsx`**

Lines 71-83 currently:
```tsx
<div className="space-y-3">
  {isLoading ? (
    <div className="text-center py-8 text-muted-foreground">Loading...</div>
  ) : tasks.length === 0 ? (
    <div className="text-center py-8 text-muted-foreground">
      No tasks found
    </div>
  ) : (
    tasks.map(...)
  )}
</div>
```

**Step 2: Replace the empty state with a proper component**

```tsx
import Link from "next/link";
import { Bot, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// ...in the render:
tasks.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
    <div className="rounded-full bg-muted p-4">
      <Bot className="h-8 w-8 text-muted-foreground" />
    </div>
    <div className="space-y-1">
      <h3 className="font-semibold text-lg">No agent tasks yet</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        Delegate tasks to AI agents — they can write, research, analyze, and code while you focus on other work.
      </p>
    </div>
    <Button asChild variant="default">
      <Link href="/tasks">
        Go to Tasks
        <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </Button>
  </div>
) : (
```

**Step 3: Verify the empty state renders**

Navigate to `/agents` with no existing agent tasks. Confirm:
- Bot icon is shown
- "No agent tasks yet" heading
- Description text
- "Go to Tasks" button links to `/tasks`

**Step 4: Commit**

```bash
git add src/components/agents/agent-queue.tsx
git commit -m "feat: add empty state to agents page with description and CTA"
```

---

## Final Verification

After all 8 tasks are complete:

1. Run the dev server: `npm run dev`
2. Open browser DevTools console
3. Navigate to `/` (dashboard) — confirm zero serialization errors, zero nested button errors, zero DialogTitle errors
4. Open `/notes/new`, type a title, confirm URL updates to `/notes/[slug]` after 1 second
5. Click mobile view (375px and 768px):
   - Header search button ≥ 44px touch target
   - Task create dialog opens as a bottom Sheet
6. Navigate to `/agents` with no tasks — confirm proper empty state

Run lint and typecheck:
```bash
npm run lint && npm run typecheck
```
