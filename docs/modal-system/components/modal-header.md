# ModalHeader

**Component:** `src/components/modals/modal-header.tsx`
**Purpose:** Standardized header for all dialogs and sheets

## Overview

ModalHeader provides a consistent header across all modals with title, optional subtitle, and close button. Includes proper ARIA attributes for accessibility.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | string | required | Main heading text displayed prominently |
| subtitle | string | undefined | Optional descriptive text below title |
| showClose | boolean | true | Whether to show close button |
| onClose | () => void | undefined | Callback when close button clicked |
| id | string | auto-generated | Custom ID for aria-labelledby reference |
| className | string | undefined | Additional CSS classes |

## Usage Examples

### Basic Usage

```tsx
import { ModalHeader } from '@/components/modals/modal-header';

<ModalHeader
  title="Create Task"
  onClose={() => setIsOpen(false)}
/>
```

### With Subtitle

```tsx
<ModalHeader
  title="Attachment Picker"
  subtitle="Select files to attach to your note"
  onClose={() => setIsOpen(false)}
/>
```

### Without Close Button

```tsx
<ModalHeader
  title="Processing..."
  showClose={false}
/>
```

### Custom ID for ARIA

```tsx
<Dialog aria-labelledby="custom-dialog-title">
  <DialogContent>
    <ModalHeader
      id="custom-dialog-title"
      title="My Dialog"
      onClose={handleClose}
    />
  </DialogContent>
</Dialog>
```

## Accessibility

**ARIA Attributes:**
- `role="heading"` on title element
- `aria-level="2"` on title element
- `id` attribute for `aria-labelledby` reference
- `aria-label="Close dialog"` on close button

**Keyboard Support:**
- Close button focusable with Tab
- Enter or Space activates close button
- Escape key closes (handled by Dialog/Sheet)

**Screen Reader:**
- Title announced when dialog opens
- Close button announced as "Close dialog, button"
- Subtitle announced after title

## Styling

**Default Classes:**
- Container: `flex items-start justify-between gap-4 border-b pb-4`
- Title: `text-lg font-semibold leading-none tracking-tight truncate`
- Subtitle: `text-sm text-muted-foreground mt-1.5`

**Customization:**
```tsx
<ModalHeader
  title="Custom Styled"
  className="border-none pb-2" // Override border and padding
  onClose={handleClose}
/>
```

## Best Practices

**Do:**
- ✅ Use in every dialog and sheet
- ✅ Keep titles concise (1-5 words)
- ✅ Use subtitle for context when needed
- ✅ Always provide onClose callback

**Don't:**
- ❌ Don't skip ModalHeader (breaks consistency)
- ❌ Don't use very long titles (they truncate)
- ❌ Don't hide close button unless necessary
- ❌ Don't forget aria-labelledby reference

## Related Components

- [Dialog](../patterns/responsive-dialogs.md) - Use ModalHeader in Dialog
- [Sheet](../patterns/responsive-dialogs.md) - Use ModalHeader in Sheet
- [ModalFooter](./modal-footer.md) - Pair with ModalHeader for actions
- [ModalSection](./modal-section.md) - Use for content organization

## Examples in Codebase

**Compact Dialog:**
```
src/components/tasks/task-create-dialog.tsx
src/components/projects/project-create-dialog.tsx
```

**Standard Dialog:**
```
src/components/attachments/attachment-picker.tsx
src/components/filters/filter-sheet.tsx
```

**Immersive Dialog:**
```
src/components/attachments/attachment-viewer.tsx
```

---

**Next:** [ModalSection](./modal-section.md)
