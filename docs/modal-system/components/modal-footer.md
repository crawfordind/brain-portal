# ModalFooter

**Component:** Pattern (not a standalone component)
**Purpose:** Consistent action buttons at bottom of dialogs

## Overview

ModalFooter is a pattern for organizing action buttons in dialogs. Currently implemented as direct footer divs rather than a reusable component (discovered during Phase 3).

## Pattern Structure

```tsx
<div className="flex gap-2 justify-end pt-4 border-t">
  <Button variant="outline" onClick={onClose}>
    Cancel
  </Button>
  <Button onClick={onSubmit} disabled={!isValid}>
    Submit
  </Button>
</div>
```

## Common Patterns

### Standard Form Footer

```tsx
<div className="flex gap-2 justify-end pt-4 border-t">
  <Button variant="outline" onClick={handleCancel}>
    Cancel
  </Button>
  <Button onClick={handleSubmit} disabled={isSubmitting}>
    {isSubmitting ? 'Creating...' : 'Create'}
  </Button>
</div>
```

### Destructive Action Footer

```tsx
<div className="flex gap-2 justify-end pt-4 border-t">
  <Button variant="outline" onClick={onClose}>
    Cancel
  </Button>
  <Button variant="destructive" onClick={handleDelete}>
    Delete
  </Button>
</div>
```

### Multi-Step Navigation Footer

```tsx
<div className="flex justify-between pt-4 border-t">
  <Button variant="outline" onClick={handleBack} disabled={step === 1}>
    Back
  </Button>
  <div className="flex gap-2">
    <Button variant="outline" onClick={onClose}>
      Cancel
    </Button>
    <Button onClick={handleNext}>
      {step === totalSteps ? 'Finish' : 'Next'}
    </Button>
  </div>
</div>
```

## Mobile Optimization

For mobile sheets, consider FloatingActions instead of ModalFooter:

```tsx
const isMobile = useMobile();

{isMobile ? (
  <FloatingActions
    actions={[
      { label: 'Cancel', onClick: onClose, variant: 'secondary' },
      { label: 'Submit', onClick: onSubmit, variant: 'primary' }
    ]}
  />
) : (
  <div className="flex gap-2 justify-end pt-4 border-t">
    <Button variant="outline" onClick={onClose}>Cancel</Button>
    <Button onClick={onSubmit}>Submit</Button>
  </div>
)}
```

## Styling Guidelines

**Default Classes:**
- Container: `flex gap-2 justify-end pt-4 border-t`
- Gap: `gap-2` for button spacing
- Padding: `pt-4` for separation from content
- Border: `border-t` to visually separate

**Button Order:**
- Cancel/Secondary action on left
- Primary action on right
- Destructive actions on right (with confirmation)

## Accessibility

**Best Practices:**
- Primary action should be a submit button in forms
- Cancel button should have clear label
- Destructive actions should require confirmation
- Disabled buttons should indicate why (via tooltip or helper text)

**Keyboard Navigation:**
- Tab moves between buttons left to right
- Enter activates focused button
- Escape closes dialog (handled by Dialog/Sheet)

## Future Consideration

A dedicated ModalFooter component could be extracted if patterns become more complex. Current approach works well for existing use cases.

## Related Components

- [FloatingActions](./floating-actions.md) - Mobile alternative
- [Button](../../src/components/ui/button.tsx) - Button primitive

## Examples in Codebase

**Create Dialogs:**
```
src/components/tasks/task-create-dialog.tsx
src/components/projects/project-create-dialog.tsx
src/components/captures/capture-create-dialog.tsx
```

All use the standard form footer pattern with Cancel + Create buttons.

---

**Next:** [FloatingActions](./floating-actions.md)
