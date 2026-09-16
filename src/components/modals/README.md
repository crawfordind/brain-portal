# Modal Components

Reusable modal patterns for consistent UI across the application.

## Components

### ModalHeader

Header component with title, optional subtitle, and close button.

**Usage:**
```tsx
<ModalHeader
  title="Create Task"
  subtitle="Add a new task to your project"
  onClose={() => setOpen(false)}
  showClose={true}
/>
```

**Props:**
- `title` (string, required): Main heading
- `subtitle` (string, optional): Descriptive text below title
- `showClose` (boolean, default: true): Show close button
- `onClose` (function, optional): Close handler

---

### ModalFooter

Footer component with primary and optional secondary action buttons.

**Usage:**
```tsx
<ModalFooter
  primaryAction={{
    label: 'Save',
    onClick: handleSave,
    loading: isSaving,
    loadingText: 'Saving...',
  }}
  secondaryAction={{
    label: 'Cancel',
    onClick: handleCancel,
  }}
  sticky={true}
/>
```

**Props:**
- `primaryAction` (ModalFooterAction, required): Primary button config
- `secondaryAction` (ModalFooterAction, optional): Secondary button config
- `sticky` (boolean, default: true): Stick to bottom of modal

**ModalFooterAction:**
- `label` (string): Button text
- `onClick` (function): Click handler
- `variant` (string, optional): Button variant
- `loading` (boolean, optional): Loading state
- `loadingText` (string, optional): Text shown when loading
- `disabled` (boolean, optional): Disabled state
- `icon` (ReactNode, optional): Icon before label

---

### ModalSection

Collapsible section for organizing modal content.

**Usage:**
```tsx
<ModalSection
  title="Advanced Options"
  collapsible={true}
  defaultOpen={false}
>
  <p>Section content</p>
</ModalSection>
```

**Props:**
- `title` (string, required): Section heading
- `collapsible` (boolean, default: false): Enable collapse
- `defaultOpen` (boolean, default: true): Initial state
- `children` (ReactNode, required): Section content

---

### FloatingActions

Floating action bar for overlay buttons (mobile viewers).

**Usage:**
```tsx
<FloatingActions
  actions={[
    {
      icon: <Download />,
      label: 'Download',
      onClick: handleDownload,
    },
    {
      icon: <Trash2 />,
      label: 'Delete',
      onClick: handleDelete,
      variant: 'destructive',
    },
  ]}
  position="bottom"
/>
```

**Props:**
- `actions` (FloatingAction[], required): Action buttons
- `position` ('top' | 'bottom', default: 'bottom'): Position

**FloatingAction:**
- `icon` (ReactNode): Button icon
- `label` (string): Accessible label
- `onClick` (function): Click handler
- `variant` (string, optional): Button variant
- `disabled` (boolean, optional): Disabled state

---

### ModalDragHandle

Visual drag indicator for bottom sheets.

**Usage:**
```tsx
<ModalDragHandle />
```

Simple component with no required props. Renders horizontal bar.

---

## Complete Example

```tsx
import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  ModalHeader,
  ModalFooter,
  ModalSection,
  ModalDragHandle,
} from '@/components/modals';

function CreateTaskModal({ open, onClose, onSave }) {
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    await onSave();
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact" dismissible={false}>
        {/* Mobile drag handle */}
        <ModalDragHandle className="sm:hidden" />

        <ModalHeader
          title="Create Task"
          subtitle="Add a new task to your project"
          onClose={onClose}
        />

        <div className="space-y-4 py-4">
          <ModalSection title="Basic Info">
            {/* Form fields */}
          </ModalSection>

          <ModalSection
            title="Advanced Options"
            collapsible
            defaultOpen={false}
          >
            {/* Optional fields */}
          </ModalSection>
        </div>

        <ModalFooter
          primaryAction={{
            label: 'Create Task',
            onClick: handleSave,
            loading,
            loadingText: 'Creating...',
          }}
          secondaryAction={{
            label: 'Cancel',
            onClick: onClose,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
```

## Design Guidelines

### Spacing
- Section gaps: `space-y-6` (24px)
- Form fields: `space-y-4` (16px)
- Related items: `space-y-2` (8px)

### Touch Targets
- Mobile minimum: 44px (`min-h-11`)
- Desktop minimum: 36px (`min-h-9`)

### Accessibility
- Always provide aria-label for icon buttons
- Use semantic heading levels
- Ensure keyboard navigation works
- Test with screen readers

## Testing

All components have unit tests in `tests/components/modals/`.

Run tests:
```bash
npm test -- tests/components/modals
```
