# FloatingActions

**Component:** `src/components/modals/floating-actions.tsx`
**Purpose:** Mobile-optimized floating action buttons

## Overview

FloatingActions provides a fixed-position button bar optimized for mobile sheets. Ensures actions are always accessible even when content scrolls, with proper safe area padding.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| actions | Action[] | required | Array of action button configurations |

### Action Type

```typescript
type Action = {
  label: string;           // Button text
  onClick: () => void;     // Click handler
  variant?: 'primary' | 'secondary' | 'destructive'; // Button style
  disabled?: boolean;      // Whether button is disabled
  className?: string;      // Additional button classes
};
```

## Usage Examples

### Basic Two-Button Footer

```tsx
import { FloatingActions } from '@/components/modals/floating-actions';

<FloatingActions
  actions={[
    { label: 'Cancel', onClick: handleClose, variant: 'secondary' },
    { label: 'Save', onClick: handleSave, variant: 'primary' }
  ]}
/>
```

### Single Primary Action

```tsx
<FloatingActions
  actions={[
    { label: 'Close', onClick: handleClose, variant: 'primary' }
  ]}
/>
```

### Three Actions

```tsx
<FloatingActions
  actions={[
    { label: 'Delete', onClick: handleDelete, variant: 'destructive' },
    { label: 'Share', onClick: handleShare, variant: 'secondary' },
    { label: 'Download', onClick: handleDownload, variant: 'primary' }
  ]}
/>
```

### With Disabled State

```tsx
<FloatingActions
  actions={[
    { label: 'Cancel', onClick: handleClose, variant: 'secondary' },
    {
      label: 'Submit',
      onClick: handleSubmit,
      variant: 'primary',
      disabled: !isValid
    }
  ]}
/>
```

## Styling

**Container Classes:**
- Position: `fixed bottom-0 left-0 right-0`
- Background: `bg-background/95 backdrop-blur-sm`
- Border: `border-t`
- Padding: `p-4 pb-safe` (safe area padding for notched devices)
- Shadow: `shadow-lg`

**Button Layout:**
- Display: `flex gap-2`
- Single button: Full width
- Two buttons: 50/50 split
- Three+ buttons: Horizontal scroll if needed

## Mobile Optimization

**Safe Area Support:**
- Uses `pb-safe` for devices with notches/home indicators
- Ensures buttons are above gesture areas
- Proper spacing from screen edge

**Touch Targets:**
- Minimum 44px height for accessibility
- Full-width buttons for easy tapping
- Adequate spacing between buttons (8px gap)

## Best Practices

**Do:**
- ✅ Use for mobile sheets with important actions
- ✅ Limit to 2-3 actions maximum
- ✅ Put primary action on the right
- ✅ Use semantic variant names (primary/secondary/destructive)

**Don't:**
- ❌ Don't use on desktop (use regular footer instead)
- ❌ Don't put more than 3 actions
- ❌ Don't hide critical actions in overflow
- ❌ Don't forget disabled states

## Accessibility

**Touch Targets:**
- All buttons meet 44px minimum height
- Adequate spacing prevents mis-taps
- Full-width buttons easy to hit

**Screen Reader:**
- Buttons announced with labels
- Disabled state communicated
- Action order logical (secondary → primary)

**Keyboard Navigation:**
- Tab moves through buttons left to right
- Enter activates focused button

## Related Components

- [ModalFooter](./modal-footer.md) - Desktop alternative
- [AttachmentViewer](../../src/components/attachments/attachment-viewer.tsx) - Example usage

## Examples in Codebase

**Attachment Viewer (Mobile Sheet):**
```
src/components/attachments/attachment-viewer.tsx
src/components/attachments/attachment-bottom-sheet.tsx
```

Uses FloatingActions for Share, Download, Close actions on immersive content view.

---

**Next:** [ModalDragHandle](./modal-drag-handle.md)
