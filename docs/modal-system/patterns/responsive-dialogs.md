# Responsive Dialog Pattern

**Pattern:** Desktop Dialog + Mobile Sheet
**Use Case:** All modal interactions

## Overview

The responsive dialog pattern provides seamless adaptation between desktop dialogs (centered overlays) and mobile sheets (bottom slide-up). This is the foundation pattern for all modals in the system.

## Pattern Structure

```tsx
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';

function ResponsiveDialog({ open, onClose, children }) {
  const isMobile = useMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[75vh]">
          <ModalHeader title="Mobile Sheet" onClose={onClose} />
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        <ModalHeader title="Desktop Dialog" onClose={onClose} />
        {children}
      </DialogContent>
    </Dialog>
  );
}
```

## Complete Example

```tsx
import { useState } from 'react';
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function CreateTaskDialog({ open, onClose, onSubmit }) {
  const isMobile = useMobile();
  const [title, setTitle] = useState('');

  const handleSubmit = () => {
    onSubmit({ title });
    setTitle('');
    onClose();
  };

  const content = (
    <>
      <ModalHeader
        title="Create Task"
        subtitle="Add a new task to your list"
        onClose={onClose}
      />
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="title">Task Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter task title"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!title.trim()}>
          Create
        </Button>
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

## Key Principles

### 1. Single Content Definition
Define content once, render in appropriate container:

```tsx
const content = (
  <>
    <ModalHeader title="..." onClose={onClose} />
    {/* Form fields */}
    {/* Footer buttons */}
  </>
);

// Then use in Dialog or Sheet
```

### 2. Consistent Heights
Use vh-based heights on mobile for predictable sizing:
- Compact: `h-[75vh]`
- Standard: `h-[85vh]`
- Immersive: `h-[90vh]`

### 3. Mobile Breakpoint
Use `useMobile()` hook which checks for `md` breakpoint (768px):

```tsx
const isMobile = useMobile(); // true when < 768px
```

## Size Variants

### Compact (max-w-md, 75vh mobile)

```tsx
<DialogContent size="compact">
  {/* Quick forms, simple dialogs */}
</DialogContent>
```

### Standard (max-w-2xl, 85vh mobile)

```tsx
<DialogContent size="standard">
  {/* Multi-step flows, content browsing */}
</DialogContent>
```

### Immersive (max-w-7xl, 90vh mobile)

```tsx
<DialogContent size="immersive">
  {/* Content viewing, galleries */}
</DialogContent>
```

## Best Practices

**Do:**
- ✅ Always use `useMobile()` hook for detection
- ✅ Keep content definition DRY (don't duplicate)
- ✅ Use ModalHeader in both Dialog and Sheet
- ✅ Test on both desktop and mobile viewports

**Don't:**
- ❌ Don't hardcode mobile checks (use hook)
- ❌ Don't duplicate content between Dialog and Sheet
- ❌ Don't forget mobile height classes on Sheet
- ❌ Don't use different content on mobile vs desktop

## Advanced: With Mobile Optimizations

```tsx
function AdvancedDialog({ open, onClose }) {
  const isMobile = useMobile();

  const content = (
    <>
      <ModalHeader title="Advanced" onClose={onClose} />
      <div className="space-y-4 py-4">
        {/* Content */}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[85vh]">
          <ModalDragHandle />
          {content}
          <FloatingActions
            actions={[
              { label: 'Cancel', onClick: onClose, variant: 'secondary' },
              { label: 'Save', onClick: handleSave, variant: 'primary' }
            ]}
          />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        {content}
        <div className="flex gap-2 justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## Related Patterns

- [Compact Modals](./compact-modals.md) - Quick forms
- [Standard Modals](./standard-modals.md) - Multi-step flows
- [Immersive Modals](./immersive-modals.md) - Content viewers

## Examples in Codebase

All create dialogs use this pattern:
- `src/components/tasks/task-create-dialog.tsx`
- `src/components/projects/project-create-dialog.tsx`
- `src/components/captures/capture-create-dialog.tsx`
- `src/components/attachments/attachment-picker.tsx`

---

**Next:** [Compact Modals](./compact-modals.md)
