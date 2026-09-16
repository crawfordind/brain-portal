# ModalSection

**Component:** `src/components/modals/modal-section.tsx`
**Purpose:** Organized content sections with optional collapse functionality

## Overview

ModalSection provides a way to group related content within modals with a clear heading. Supports collapsible sections for progressive disclosure.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | string | required | Section heading text |
| collapsible | boolean | false | Whether section can be collapsed |
| defaultOpen | boolean | true | Initial collapse state (if collapsible) |
| children | ReactNode | required | Section content |
| className | string | undefined | Additional CSS classes |

## Usage Examples

### Basic Section

```tsx
import { ModalSection } from '@/components/modals/modal-section';

<ModalSection title="Basic Information">
  <div>Content goes here</div>
</ModalSection>
```

### Collapsible Section

```tsx
<ModalSection title="Advanced Options" collapsible defaultOpen={false}>
  <div>These options are hidden by default</div>
</ModalSection>
```

### Multiple Sections in a Modal

```tsx
<DialogContent>
  <ModalHeader title="Filter Options" onClose={handleClose} />

  <ModalSection title="Status">
    <CheckboxGroup options={statusOptions} />
  </ModalSection>

  <ModalSection title="Priority">
    <CheckboxGroup options={priorityOptions} />
  </ModalSection>

  <ModalSection title="Advanced" collapsible defaultOpen={false}>
    <DateRangePicker />
  </ModalSection>
</DialogContent>
```

## Accessibility

**ARIA Attributes:**
- `role="group"` on section container
- `aria-labelledby` pointing to title element
- `aria-expanded` on collapsible button (true/false)

**Keyboard Support:**
- Collapsible button focusable with Tab
- Enter or Space toggles collapse state
- Content hidden when collapsed (not in tab order)

**Screen Reader:**
- Section announced as "group, [Title]"
- Collapsible button announces expand/collapse state
- Content inside section properly associated

## Styling

**Default Classes:**
- Container: `space-y-3`
- Title: `text-sm font-medium`
- Collapsible button: `flex items-center justify-between w-full`

**Collapse Icon:**
- Chevron rotates 180° when expanded
- Smooth transition with `transition-transform`

## Best Practices

**Do:**
- ✅ Use for grouping related form fields
- ✅ Use collapsible for advanced/optional sections
- ✅ Keep section titles short and clear
- ✅ Use consistent spacing between sections

**Don't:**
- ❌ Don't nest sections deeply (1 level max)
- ❌ Don't put critical content in collapsed sections
- ❌ Don't overuse collapsible sections
- ❌ Don't forget to test keyboard navigation

## Related Components

- [ModalHeader](./modal-header.md) - Main dialog header
- [FilterSheet](../../src/components/filters/filter-sheet.tsx) - Example usage

## Examples in Codebase

**Filter Sheet:**
```
src/components/filters/filter-sheet.tsx
```

Uses multiple ModalSection components to organize filter groups (Status, Priority, Tags, etc.)

---

**Next:** [ModalFooter](./modal-footer.md)
