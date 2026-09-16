# Migration Guide

**Audience:** Developers updating old modals to new system
**Estimated Time:** 15-30 minutes per modal

## Overview

This guide walks through migrating existing modals to use the new modal system with ModalHeader, responsive patterns, and accessibility features.

## Migration Checklist

For each modal you migrate:

- ✅ Replace custom header with ModalHeader
- ✅ Add responsive Dialog/Sheet pattern
- ✅ Update to use size variants
- ✅ Add proper ARIA attributes
- ✅ Implement lazy loading
- ✅ Write tests
- ✅ Verify accessibility

## Step 1: Identify Modal Type

Determine the appropriate size variant:

**Compact (max-w-md, 75vh mobile):**
- Quick forms with 3-5 fields
- Simple confirmations

**Standard (max-w-2xl, 85vh mobile):**
- Multi-step flows
- Content browsing/selection

**Immersive (max-w-7xl, 90vh mobile):**
- Media viewing
- Rich content display

## Step 2: Update Imports

### Before

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
```

### After

```tsx
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
```

## Step 3: Replace Custom Header

### Before

```tsx
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Create Task</DialogTitle>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```

### After

```tsx
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent size="compact">
    <ModalHeader
      title="Create Task"
      subtitle="Add a new task to your list"
      onClose={onClose}
    />
    {/* Content */}
  </DialogContent>
</Dialog>
```

## Step 4: Add Responsive Pattern

### Before (Desktop Only)

```tsx
export function TaskDialog({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <ModalHeader title="Create Task" onClose={onClose} />
        <div className="space-y-4">
          {/* Form fields */}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### After (Desktop + Mobile)

```tsx
export function TaskDialog({ open, onClose }) {
  const isMobile = useMobile();

  const content = (
    <>
      <ModalHeader
        title="Create Task"
        subtitle="Add a new task to your list"
        onClose={onClose}
      />
      <div className="space-y-4 py-4">
        {/* Form fields */}
      </div>
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit}>Create</Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[75vh]">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Step 5: Add Size Variant

Choose the appropriate size:

```tsx
// Compact
<DialogContent size="compact">

// Standard
<DialogContent size="standard">

// Immersive
<DialogContent size="immersive">
```

Match mobile height to desktop size:

```tsx
// Compact → 75vh
<SheetContent className="h-[75vh]">

// Standard → 85vh
<SheetContent className="h-[85vh]">

// Immersive → 90vh
<SheetContent className="h-[90vh]">
```

## Step 6: Update Form Labels

Ensure all inputs have labels:

### Before

```tsx
<Input placeholder="Task title" />
```

### After

```tsx
<div className="space-y-2">
  <Label htmlFor="title">Task Title</Label>
  <Input id="title" placeholder="Enter task title" />
</div>
```

## Step 7: Add Lazy Loading

### Before (Eager Import)

```tsx
import { TaskDialog } from '@/components/tasks/task-dialog';

function TasksPage() {
  return <TaskDialog open={isOpen} onClose={handleClose} />;
}
```

### After (Lazy Import)

```tsx
import { LazyDialog } from '@/components/ui/lazy-dialog';

function TasksPage() {
  return (
    <LazyDialog
      open={isOpen}
      onClose={handleClose}
      loader={() => import('@/components/tasks/task-dialog').then(m => ({
        default: m.TaskDialog
      }))}
    />
  );
}
```

## Step 8: Write Tests

Add test file at `tests/components/[your-dialog].test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '../setup-axe';
import { TaskDialog } from '@/components/tasks/task-dialog';
import '@testing-library/jest-dom';

describe('TaskDialog', () => {
  it('renders when open', () => {
    render(<TaskDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Create Task')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <TaskDialog open={true} onClose={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

Run tests:
```bash
npm test tests/components/your-dialog.test.tsx
```

## Step 9: Verify Accessibility

Run automated checks:
```bash
npm test -- --grep="a11y"
```

Manual checks:
1. Open dialog with keyboard (Enter/Space on trigger)
2. Tab through all elements
3. Verify focus indicators visible
4. Press Escape to close
5. Verify focus returns to trigger

## Step 10: Update Documentation

Commit your changes:

```bash
git add src/components/tasks/task-dialog.tsx tests/components/task-dialog.test.tsx
git commit -m "refactor: migrate TaskDialog to new modal system

- Replace custom header with ModalHeader
- Add responsive Desktop/Mobile pattern
- Add proper ARIA attributes
- Implement lazy loading
- Add comprehensive tests
- WCAG 2.1 AA compliant

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Common Migration Patterns

### Pattern 1: Simple Confirmation Dialog

**Before:**
```tsx
<AlertDialog open={open} onOpenChange={setOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleConfirm}>Confirm</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**After:**
```tsx
const isMobile = useMobile();

const content = (
  <>
    <ModalHeader
      title="Are you sure?"
      subtitle="This action cannot be undone."
      onClose={() => setOpen(false)}
    />
    <div className="flex gap-2 justify-end pt-4 border-t">
      <Button variant="outline" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button variant="destructive" onClick={handleConfirm}>
        Confirm
      </Button>
    </div>
  </>
);

if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="h-[75vh]">{content}</SheetContent>
    </Sheet>
  );
}

return (
  <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent size="compact">{content}</DialogContent>
  </Dialog>
);
```

### Pattern 2: Multi-Section Dialog

**Before:**
```tsx
<Dialog>
  <DialogContent>
    <h3>Section 1</h3>
    <div>{/* Content */}</div>

    <h3>Section 2</h3>
    <div>{/* Content */}</div>
  </DialogContent>
</Dialog>
```

**After:**
```tsx
import { ModalSection } from '@/components/modals/modal-section';

<DialogContent size="standard">
  <ModalHeader title="Settings" onClose={onClose} />

  <div className="space-y-4 py-4">
    <ModalSection title="Section 1">
      {/* Content */}
    </ModalSection>

    <ModalSection title="Section 2">
      {/* Content */}
    </ModalSection>

    <ModalSection title="Advanced" collapsible defaultOpen={false}>
      {/* Optional content */}
    </ModalSection>
  </div>
</DialogContent>
```

### Pattern 3: Immersive Content Viewer

**Before:**
```tsx
<Dialog>
  <DialogContent className="max-w-6xl">
    <img src={image} alt="Preview" />
    <Button onClick={handleDownload}>Download</Button>
  </DialogContent>
</Dialog>
```

**After:**
```tsx
const isMobile = useMobile();

if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="h-[90vh] p-0">
        <ModalDragHandle />
        <div className="h-full flex flex-col">
          <div className="px-4 pt-2">
            <ModalHeader title="Image Preview" onClose={onClose} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <img src={image} alt="Preview" className="w-full" />
          </div>
          <FloatingActions
            actions={[
              { label: 'Download', onClick: handleDownload, variant: 'primary' }
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="immersive" className="p-0">
      <div className="p-6">
        <ModalHeader title="Image Preview" onClose={onClose} />
      </div>
      <div className="px-6 pb-6">
        <img src={image} alt="Preview" className="max-w-full h-auto mx-auto" />
      </div>
      <div className="px-6 pb-6 flex gap-2 justify-end border-t pt-4">
        <Button onClick={handleDownload}>Download</Button>
      </div>
    </DialogContent>
  </Dialog>
);
```

## Troubleshooting

**Issue: Mobile view not working**
- Solution: Check `useMobile()` is imported and used correctly
- Verify breakpoint in browser DevTools (768px)

**Issue: Tests failing**
- Solution: Update test to use new component structure
- Check that `ModalHeader` is imported in test

**Issue: Accessibility violations**
- Solution: Ensure all inputs have labels
- Verify ModalHeader is used (provides ARIA attributes)
- Run `npm test -- --grep="a11y"` to find specific issues

## Completed Migrations (Phase 3)

Reference these for examples:
- ✅ `src/components/tasks/task-create-dialog.tsx`
- ✅ `src/components/projects/project-create-dialog.tsx`
- ✅ `src/components/captures/capture-create-dialog.tsx`
- ✅ `src/components/attachments/attachment-picker.tsx`
- ✅ `src/components/filters/filter-sheet.tsx`
- ✅ `src/components/attachments/attachment-viewer.tsx`
- ✅ `src/components/ui/quick-capture-dialog.tsx`

## Next Steps

After migration:
1. Verify all tests pass: `npm test`
2. Check TypeScript: `npm run typecheck`
3. Test manually on desktop and mobile
4. Update any documentation referencing old pattern

---

**See Also:**
- [Creating New Modal](./creating-new-modal.md) - For new modals
- [Accessibility Guide](./accessibility.md) - Compliance checklist
- [Testing Guide](./testing.md) - Test patterns
