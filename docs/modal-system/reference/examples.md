# Examples Reference

**Purpose:** Complete code examples for common use cases
**Audience:** Developers implementing modals

## Table of Contents

1. [Simple Confirmation Dialog](#simple-confirmation-dialog)
2. [Form with Validation](#form-with-validation)
3. [Multi-Step Wizard](#multi-step-wizard)
4. [Content Picker/Browser](#content-pickerbrowser)
5. [Filter Panel](#filter-panel)
6. [Image Viewer](#image-viewer)
7. [Lazy Loading](#lazy-loading)
8. [Loading States](#loading-states)
9. [Error Handling](#error-handling)
10. [Mobile Optimizations](#mobile-optimizations)

---

## Simple Confirmation Dialog

**Use Case:** Confirm destructive actions

```tsx
'use client';

import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  variant = 'default'
}: ConfirmDialogProps) {
  const isMobile = useMobile();

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const content = (
    <>
      <ModalHeader title={title} onClose={onClose} />
      <p className="py-4 text-sm text-muted-foreground">{message}</p>
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={variant} onClick={handleConfirm}>
          {confirmText}
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

// Usage
function MyComponent() {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = async () => {
    await deleteItem(itemId);
    toast.success('Item deleted');
  };

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setShowConfirm(true)}
      >
        Delete
      </Button>

      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
      />
    </>
  );
}
```

---

## Form with Validation

**Use Case:** Create/edit forms with field validation

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
import { Textarea } from '@/components/ui/textarea';

interface FormData {
  title: string;
  description: string;
  email: string;
}

export function FormDialog({ open, onClose, onSubmit }) {
  const isMobile = useMobile();
  const [formData, setFormData] = useState<FormData>({
    title: '',
    description: '',
    email: ''
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      setFormData({ title: '', description: '', email: '' });
      onClose();
    } catch (error) {
      setErrors({ title: 'Failed to submit. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const content = (
    <>
      <ModalHeader
        title="Create Item"
        subtitle="Fill in the details below"
        onClose={onClose}
      />

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="Enter title"
            className={errors.title ? 'border-destructive' : ''}
          />
          {errors.title && (
            <p className="text-sm text-destructive">{errors.title}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="Enter description"
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="your@email.com"
            className={errors.email ? 'border-destructive' : ''}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!formData.title.trim() || isSubmitting}
        >
          {isSubmitting ? 'Creating...' : 'Create'}
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

---

## Multi-Step Wizard

**Use Case:** Multi-step form flows

```tsx
'use client';

import { useState } from 'react';
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export function WizardDialog({ open, onClose, onComplete }) {
  const isMobile = useMobile();
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ step1: '', step2: '', step3: '' });

  const totalSteps = 3;
  const progress = (step / totalSteps) * 100;

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete(data);
      setStep(1);
      setData({ step1: '', step2: '', step3: '' });
      onClose();
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const isStepValid = () => {
    if (step === 1) return data.step1.trim() !== '';
    if (step === 2) return data.step2.trim() !== '';
    if (step === 3) return data.step3.trim() !== '';
    return false;
  };

  const content = (
    <>
      <ModalHeader
        title={`Step ${step} of ${totalSteps}`}
        subtitle="Complete all steps to finish"
        onClose={onClose}
      />

      <div className="py-4">
        <Progress value={progress} className="mb-4" />

        {step === 1 && (
          <div className="space-y-2">
            <Label>First Step</Label>
            <Input
              value={data.step1}
              onChange={(e) => setData({ ...data, step1: e.target.value })}
              placeholder="Enter information"
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <Label>Second Step</Label>
            <Input
              value={data.step2}
              onChange={(e) => setData({ ...data, step2: e.target.value })}
              placeholder="Enter more information"
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <Label>Final Step</Label>
            <Input
              value={data.step3}
              onChange={(e) => setData({ ...data, step3: e.target.value })}
              placeholder="Enter final information"
            />
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4 border-t">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={step === 1}
        >
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleNext} disabled={!isStepValid()}>
            {step === totalSteps ? 'Finish' : 'Next'}
          </Button>
        </div>
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

---

## Lazy Loading

**Use Case:** Load dialog only when opened for better performance

```tsx
import { LazyDialog } from '@/components/ui/lazy-dialog';

// Component file (task-create-dialog.tsx)
export function TaskCreateDialog({ open, onClose, projects }) {
  // ... dialog implementation
}

// Page file
function TasksPage() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setIsCreateOpen(true)}>
        New Task
      </Button>

      <LazyDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        loader={() => import('@/components/tasks/task-create-dialog').then(m => ({
          default: m.TaskCreateDialog
        }))}
        projects={projects}
      />
    </>
  );
}
```

**Benefits:**
- Reduces initial bundle size
- Faster page load
- Dialog loads in <100ms on demand

---

## Complete Examples in Codebase

For full working examples, see:

**Compact Dialogs:**
- `src/components/tasks/task-create-dialog.tsx`
- `src/components/projects/project-create-dialog.tsx`
- `src/components/ui/quick-capture-dialog.tsx`

**Standard Dialogs:**
- `src/components/attachments/attachment-picker.tsx`
- `src/components/filters/filter-sheet.tsx`

**Immersive Dialogs:**
- `src/components/attachments/attachment-viewer.tsx`

---

**See Also:**
- [Creating New Modal Guide](../guides/creating-new-modal.md)
- [Size Variants](./size-variants.md)
- [Keyboard Shortcuts](./keyboard-shortcuts.md)
