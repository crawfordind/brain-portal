# ModalDragHandle

**Component:** `src/components/modals/modal-drag-handle.tsx`
**Purpose:** Visual affordance for draggable mobile sheets

## Overview

ModalDragHandle provides a visual indicator that a mobile sheet can be dragged to dismiss. Currently decorative, with drag-to-dismiss functionality planned for Phase 5.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| className | string | undefined | Additional CSS classes |

## Usage Examples

### Basic Usage

```tsx
import { ModalDragHandle } from '@/components/modals/modal-drag-handle';

<SheetContent>
  <ModalDragHandle />
  <ModalHeader title="Sheet Title" onClose={handleClose} />
  {/* Sheet content */}
</SheetContent>
```

### In Mobile Sheet Pattern

```tsx
{isMobile ? (
  <Sheet open={open} onOpenChange={onClose}>
    <SheetContent className="h-[90vh]">
      <ModalDragHandle />
      <div className="flex-1 overflow-y-auto">
        <ModalHeader title="Content" onClose={onClose} />
        {/* Content */}
      </div>
      <FloatingActions actions={actions} />
    </SheetContent>
  </Sheet>
) : (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="immersive">
      <ModalHeader title="Content" onClose={onClose} />
      {/* Content */}
    </DialogContent>
  </Dialog>
)}
```

## Styling

**Visual Design:**
- Width: 32px
- Height: 4px
- Border radius: Fully rounded (rounded-full)
- Color: `bg-muted`
- Position: Centered horizontally
- Margin: 8px top and bottom

**Container:**
```tsx
<div className="flex justify-center py-2">
  <div className="w-8 h-1 bg-muted rounded-full" />
</div>
```

## Accessibility

**Current Implementation:**
- Purely decorative (no interactive behavior)
- Not in tab order
- Not announced by screen readers

**Future (Phase 5):**
- Will support touch drag gestures
- Will announce "Swipe down to close" to screen readers
- Will provide alternative close methods

## Best Practices

**Do:**
- ✅ Use at top of all mobile sheets
- ✅ Place before ModalHeader
- ✅ Use consistent styling across sheets

**Don't:**
- ❌ Don't use on desktop dialogs
- ❌ Don't make interactive yet (Phase 5)
- ❌ Don't hide or customize size significantly

## Future Enhancement (Phase 5)

Planned drag-to-dismiss functionality:

```tsx
// Future API (not yet implemented)
<ModalDragHandle
  onDragStart={() => console.log('Started dragging')}
  onDragEnd={(dismissed) => dismissed && handleClose()}
  threshold={100} // Pixels to drag before dismissing
/>
```

## Related Components

- [FloatingActions](./floating-actions.md) - Pair together in mobile sheets
- [Sheet](../patterns/responsive-dialogs.md) - Container component

## Examples in Codebase

**Attachment Viewer (Mobile):**
```
src/components/attachments/attachment-viewer.tsx
src/components/attachments/attachment-bottom-sheet.tsx
```

Uses ModalDragHandle at top of immersive mobile sheet for visual consistency.

---

**Next:** [Patterns Overview](../patterns/responsive-dialogs.md)
