# Creating a New Modal - Step-by-Step Guide

**Audience:** Developers adding new modal dialogs
**Time:** 15-30 minutes

## Overview

This guide walks you through creating a new modal dialog from scratch, including responsive behavior, accessibility, and testing.

## Step 1: Choose the Right Pattern

First, determine which size variant fits your use case:

- **Compact (max-w-md, 75vh mobile)** - Quick forms with 3-5 fields
- **Standard (max-w-2xl, 85vh mobile)** - Multi-step flows or content browsing
- **Immersive (max-w-7xl, 90vh mobile)** - Media viewing or rich content

See [Size Variants Reference](../reference/size-variants.md) for detailed specs.

## Step 2: Create the Component File

Create your dialog component in the appropriate directory:

```bash
# For task-related dialogs
src/components/tasks/my-dialog.tsx

# For note-related dialogs
src/components/notes/my-dialog.tsx

# For generic dialogs
src/components/ui/my-dialog.tsx
```

## Step 3: Write the Component Structure

Start with this template (compact example):

```tsx
'use client';

import { useState } from 'react';
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: MyData) => void | Promise<void>;
}

export function MyDialog({ open, onClose, onSubmit }: MyDialogProps) {
  const isMobile = useMobile();
  const [formData, setFormData] = useState({
    field1: '',
    field2: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      setFormData({ field1: '', field2: '' }); // Reset form
      onClose();
    } catch (error) {
      console.error('Submit failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = formData.field1.trim() !== '';

  const content = (
    <>
      <ModalHeader
        title="My Dialog Title"
        subtitle="Brief description of what this does"
        onClose={onClose}
      />

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="field1">Field 1</Label>
          <Input
            id="field1"
            value={formData.field1}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              field1: e.target.value
            }))}
            placeholder="Enter value"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="field2">Field 2 (Optional)</Label>
          <Input
            id="field2"
            value={formData.field2}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              field2: e.target.value
            }))}
            placeholder="Enter optional value"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Submit'}
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

## Step 4: Add to Parent Component

Use the dialog in your page or component:

```tsx
'use client';

import { useState } from 'react';
import { MyDialog } from '@/components/my-dialog';
import { Button } from '@/components/ui/button';

export default function MyPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleSubmit = async (data) => {
    // Save data to API
    await fetch('/api/endpoint', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  };

  return (
    <div>
      <Button onClick={() => setIsDialogOpen(true)}>
        Open Dialog
      </Button>

      <MyDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

## Step 5: Add Lazy Loading (Optional but Recommended)

For better performance, lazy load your dialog:

```tsx
import { LazyDialog } from '@/components/ui/lazy-dialog';

<LazyDialog
  open={isDialogOpen}
  onClose={() => setIsDialogOpen(false)}
  loader={() => import('@/components/my-dialog').then(m => ({
    default: m.MyDialog
  }))}
  onSubmit={handleSubmit}
/>
```

## Step 6: Write Tests

Create test file at `tests/components/my-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyDialog } from '@/components/my-dialog';
import '@testing-library/jest-dom';

describe('MyDialog', () => {
  it('renders when open', () => {
    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('My Dialog Title')).toBeInTheDocument();
  });

  it('calls onSubmit when form is valid', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Field 1'), 'Test value');
    await user.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        field1: 'Test value',
        field2: ''
      });
    });
  });

  it('does not submit when invalid', async () => {
    const onSubmit = vi.fn();

    render(<MyDialog open={true} onClose={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByText('Submit')).toBeDisabled();
  });

  it('calls onClose when cancelled', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<MyDialog open={true} onClose={onClose} onSubmit={vi.fn()} />);

    await user.click(screen.getByText('Cancel'));

    expect(onClose).toHaveBeenCalled();
  });
});
```

Run tests:
```bash
npm test tests/components/my-dialog.test.tsx
```

## Step 7: Add Accessibility Tests (Recommended)

Add accessibility tests:

```tsx
import { axe } from '../setup-axe';

describe('MyDialog Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <MyDialog open={true} onClose={vi.fn()} onSubmit={vi.fn()} />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

## Step 8: Verify Accessibility Manually

Follow the [Accessibility Guide](./accessibility.md) checklist:

- ✅ Title has proper ARIA attributes
- ✅ All form fields have labels
- ✅ Tab order is logical
- ✅ Escape closes dialog
- ✅ Focus returns to trigger on close
- ✅ Submit button disabled when invalid

## Step 9: Test Responsive Behavior

1. Run dev server: `npm run dev`
2. Open dialog on desktop (>768px width)
3. Verify it appears as centered Dialog
4. Resize to mobile (<768px width)
5. Verify it appears as bottom Sheet
6. Test on actual mobile device if possible

## Step 10: Document and Commit

Add your dialog to relevant documentation:

```bash
git add src/components/my-dialog.tsx tests/components/my-dialog.test.tsx
git commit -m "feat: add MyDialog component

- Responsive dialog with compact pattern
- Form validation and submission
- Lazy loading support
- Full test coverage
- WCAG 2.1 AA compliant

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Common Patterns

### Multi-Step Dialog

```tsx
const [step, setStep] = useState(1);

// Footer with Back/Next buttons
<div className="flex justify-between pt-4 border-t">
  <Button
    variant="outline"
    onClick={() => setStep(step - 1)}
    disabled={step === 1}
  >
    Back
  </Button>
  <div className="flex gap-2">
    <Button variant="outline" onClick={onClose}>
      Cancel
    </Button>
    <Button onClick={step === 3 ? handleSubmit : () => setStep(step + 1)}>
      {step === 3 ? 'Finish' : 'Next'}
    </Button>
  </div>
</div>
```

### Confirmation Dialog

```tsx
<ModalHeader title="Confirm Action" onClose={onClose} />

<p className="py-4">
  Are you sure you want to proceed? This action cannot be undone.
</p>

<div className="flex gap-2 justify-end pt-4 border-t">
  <Button variant="outline" onClick={onClose}>
    Cancel
  </Button>
  <Button variant="destructive" onClick={handleConfirm}>
    Confirm
  </Button>
</div>
```

### Loading State

```tsx
{isLoading ? (
  <div className="py-8 text-center">
    <Spinner />
    <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
  </div>
) : (
  <div className="space-y-4 py-4">
    {/* Content */}
  </div>
)}
```

## Troubleshooting

**Dialog doesn't close:**
- Ensure `onClose` is called in both Cancel button and onOpenChange

**Mobile view not showing:**
- Check `useMobile()` import and usage
- Verify breakpoint in dev tools (768px)

**Focus not trapped:**
- Dialog/Sheet components handle this automatically
- Ensure you're using shadcn/ui Dialog/Sheet

**Form doesn't submit:**
- Check validation logic
- Verify `disabled` prop on submit button
- Check for async errors

## Next Steps

- Review [Accessibility Guide](./accessibility.md) for compliance
- Check [Testing Guide](./testing.md) for more test patterns
- See [Examples](../reference/examples.md) for more use cases

---

**See Also:**
- [Responsive Dialog Pattern](../patterns/responsive-dialogs.md)
- [Size Variants](../reference/size-variants.md)
- [Accessibility Guide](./accessibility.md)
