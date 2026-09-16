# Keyboard Shortcuts Reference

**Purpose:** Complete keyboard interaction reference
**Audience:** Developers and users

## Overview

All modals in the system support comprehensive keyboard navigation for accessibility and power user workflows.

## Global Shortcuts

These work in all modals:

| Shortcut | Action | Notes |
|----------|--------|-------|
| **Escape** | Close modal | Returns focus to trigger element |
| **Tab** | Next focusable element | Wraps around within modal (focus trap) |
| **Shift+Tab** | Previous focusable element | Wraps around within modal |

## Form Controls

Standard HTML form element shortcuts:

| Element | Shortcut | Action |
|---------|----------|--------|
| **Button** | Enter or Space | Activate button |
| **Text Input** | Enter | Submit form (if in form) |
| **Checkbox** | Space | Toggle checked state |
| **Radio Button** | Arrow keys | Select option in group |
| **Select Dropdown** | Arrow keys | Navigate options |
| **Select Dropdown** | Enter or Space | Open/close dropdown |

## Modal-Specific Shortcuts

### Create Dialogs

**Quick Capture Dialog:**
```
Ctrl/Cmd+K        Open quick capture
Enter             Submit capture
Escape            Close without saving
Tab               Move between fields
```

**Task Create Dialog:**
```
Tab               Title → Project → Priority → Tags → Create
Shift+Tab         Reverse tab order
Enter             Submit form
Escape            Cancel and close
```

**Project Create Dialog:**
```
Tab               Name → Description → Color → Status → Create
Enter             Submit form
Escape            Cancel and close
```

### Attachment Picker

```
Tab               Navigate grid items
Space/Enter       Select/deselect attachment
Arrow keys        Navigate grid (when focused)
Ctrl/Cmd+A        Select all (future enhancement)
Escape            Close picker
```

### Filter Sheet

```
Tab               Navigate through sections
Space             Toggle checkbox
Arrow keys        Navigate within section
Enter             Apply filters
Escape            Close without applying
```

### Attachment Viewer (Immersive)

```
Escape            Close viewer
Left Arrow        Previous attachment (future)
Right Arrow       Next attachment (future)
Space             Play/pause video (if video)
F                 Toggle fullscreen (future)
```

## Collapsible Sections

When using ModalSection with `collapsible`:

```
Tab               Focus section header
Enter or Space    Toggle section expand/collapse
```

## Focus Order

### Standard Dialog Flow

```
1. Close button (×)
2. First form field
3. Second form field
4. ...
5. Cancel button
6. Submit button
7. (Wraps back to close button)
```

### Sheet with Floating Actions

```
1. Drag handle (decorative, skipped)
2. Close button
3. Form/content fields
4. ...
5. Floating action buttons (bottom)
6. (Wraps back to close button)
```

## Screen Reader Shortcuts

### NVDA (Windows)

```
H                 Next heading (navigate sections)
B                 Next button
F                 Next form field
T                 Next table
NVDA+Space        Toggle focus/browse mode
Insert+Down       Read from current position
```

### VoiceOver (macOS)

```
VO+Right Arrow    Next item
VO+Left Arrow     Previous item
VO+Space          Activate item
VO+U              Open rotor (navigate by type)
VO+A              Read from current position
VO+H H            Next heading
```

## Power User Workflows

### Quick Task Creation

```
1. Ctrl/Cmd+K              Open quick capture
2. Type task title
3. Tab                     Move to project field
4. Arrow keys              Select project
5. Tab                     Move to priority
6. Arrow keys              Select priority
7. Enter                   Submit
```

### Rapid Filtering

```
1. Click filter button
2. Space                   Toggle first filter
3. Tab                     Next section
4. Space                   Toggle option
5. Enter                   Apply filters
```

### Attachment Selection

```
1. Tab                     Focus first attachment
2. Space                   Select
3. Tab                     Next attachment
4. Space                   Select
5. Tab to "Attach" button
6. Enter                   Attach selected
```

## Custom Shortcuts (Future Enhancement)

Potential additions in Phase 5:

```
Ctrl/Cmd+Enter    Quick submit (in forms)
Ctrl/Cmd+W        Close modal (alternative to Escape)
Alt+Left          Previous in multi-step
Alt+Right         Next in multi-step
Ctrl/Cmd+F        Focus search field (in pickers)
```

## Implementation Details

### Focus Trap

Automatically handled by Dialog/Sheet primitives:

```tsx
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent>
    {/* Focus automatically trapped within */}
  </DialogContent>
</Dialog>
```

### Form Submission

Handle Enter key in forms:

```tsx
<form onSubmit={(e) => {
  e.preventDefault();
  handleSubmit();
}}>
  <Input /> {/* Enter triggers submit */}
  <Button type="submit">Submit</Button>
</form>
```

### Escape Key Handling

Automatically handled by Dialog/Sheet:

```tsx
<Dialog open={open} onOpenChange={onClose}>
  {/* Escape automatically calls onClose */}
</Dialog>
```

To prevent Escape from closing:

```tsx
<Dialog
  open={open}
  onOpenChange={(open) => {
    if (!open && isDirty) {
      // Show confirmation first
      setShowConfirmation(true);
    } else {
      onClose();
    }
  }}
>
```

## Accessibility Testing

### Keyboard Navigation Test

```
1. Open modal
2. Do NOT use mouse
3. Tab through all elements
4. Verify:
   - All interactive elements reachable
   - Focus indicators visible
   - Tab order logical
   - No focus escaping modal
5. Press Escape
6. Verify modal closes
7. Verify focus returns to trigger
```

### Screen Reader Test

```
1. Enable screen reader (NVDA/VoiceOver)
2. Open modal
3. Verify title announced
4. Tab through elements
5. Verify each element announced correctly
6. Verify buttons announce role
7. Verify form fields announce labels
```

## Common Issues and Solutions

### Issue: Focus Escapes Modal

**Cause:** Not using Dialog/Sheet primitives
**Solution:** Use shadcn/ui Dialog or Sheet components (automatic focus trap)

### Issue: Tab Order Wrong

**Cause:** DOM order doesn't match visual order
**Solution:** Reorder elements in DOM to match visual layout

### Issue: Enter Doesn't Submit

**Cause:** Input not in a `<form>` element
**Solution:** Wrap inputs in `<form>` with `onSubmit` handler

### Issue: Escape Doesn't Close

**Cause:** Not using `onOpenChange` prop
**Solution:** Pass `onOpenChange` to Dialog/Sheet

```tsx
<Dialog open={open} onOpenChange={onClose}>
```

## Browser Compatibility

All shortcuts work in:
- ✅ Chrome/Edge (Chromium)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile Safari (iOS)
- ✅ Chrome Mobile (Android)

**Note:** Mobile devices may handle some shortcuts differently due to virtual keyboards.

## Related Documentation

- [Accessibility Guide](../guides/accessibility.md) - Full a11y checklist
- [Testing Guide](../guides/testing.md) - Keyboard navigation tests
- [Accessibility Testing Guide](../accessibility-testing-guide.md) - Manual testing procedures

---

**See Also:**
- [Creating New Modal](../guides/creating-new-modal.md)
- [Examples](./examples.md)
