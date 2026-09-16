# Accessibility Guide

**Target:** WCAG 2.1 AA Compliance
**Audience:** Developers creating or modifying modals

## Overview

This guide ensures all modals meet accessibility standards. Follow this checklist for every new modal.

## Quick Checklist

Before marking a modal complete, verify:

- ✅ Modal title has proper ARIA attributes
- ✅ All form controls have labels
- ✅ Keyboard navigation works (Tab, Enter, Escape)
- ✅ Focus trapped within modal
- ✅ Focus returns to trigger on close
- ✅ Color contrast meets 4.5:1 (text) or 3:1 (UI)
- ✅ Touch targets ≥44×44px on mobile
- ✅ No automated accessibility violations (vitest-axe)

## ARIA Attributes

### Modal Container

The Dialog/Sheet components from shadcn/ui automatically provide:

```html
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <!-- Content -->
</div>
```

✅ **No action needed** - handled by primitives

### ModalHeader

ModalHeader automatically provides proper ARIA:

```tsx
<ModalHeader
  title="My Dialog"
  onClose={handleClose}
/>
```

Renders:
```html
<h2 id="[auto-generated]" role="heading" aria-level="2">
  My Dialog
</h2>
<button aria-label="Close dialog">×</button>
```

✅ **No action needed** - handled by component

### Form Labels

**Required:** Every input must have an associated label.

❌ **Bad:**
```tsx
<Input placeholder="Enter your name" />
```

✅ **Good:**
```tsx
<Label htmlFor="name">Name</Label>
<Input id="name" placeholder="Enter your name" />
```

✅ **Also Good (aria-label):**
```tsx
<Input aria-label="Name" placeholder="Enter your name" />
```

### Sections

Use ModalSection for grouped content:

```tsx
<ModalSection title="Basic Information">
  {/* Fields */}
</ModalSection>
```

Automatically provides:
```html
<div role="group" aria-labelledby="section-title">
  <h3 id="section-title">Basic Information</h3>
  <!-- Content -->
</div>
```

## Keyboard Navigation

### Required Shortcuts

| Key | Action | Implementation |
|-----|--------|----------------|
| Escape | Close modal | Handled by Dialog/Sheet |
| Tab | Next element | Handled by Dialog/Sheet |
| Shift+Tab | Previous element | Handled by Dialog/Sheet |
| Enter | Submit form / Activate button | Native browser behavior |
| Space | Activate button | Native browser behavior |

### Focus Trap

The Dialog/Sheet components automatically trap focus:

```tsx
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent>
    {/* Focus stays within this container */}
  </DialogContent>
</Dialog>
```

✅ **No action needed** - handled automatically

### Focus Return

When modal closes, focus returns to the trigger element:

```tsx
// Trigger button
<Button onClick={() => setIsOpen(true)}>
  Open Dialog
</Button>

// On close, focus returns to Button automatically
```

✅ **No action needed** - handled by Dialog/Sheet

### Focus Indicators

All interactive elements must have visible focus indicators:

```tsx
<Button className="focus-visible:ring-2 focus-visible:ring-ring">
  Click Me
</Button>
```

ModalHeader and ModalSection already include focus styles.

**Custom elements need focus styles:**
```tsx
<button className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
  Custom Button
</button>
```

## Color Contrast

### Text Requirements

- **Normal text:** 4.5:1 minimum
- **Large text (18px+):** 3.0:1 minimum
- **Placeholder text:** 3.0:1 minimum

### UI Components

- **Buttons:** 3.0:1 minimum
- **Focus indicators:** 3.0:1 minimum
- **Borders:** 3.0:1 minimum

### Testing Contrast

**Automated:**
```tsx
import { axe } from '../setup-axe';

test('has sufficient contrast', async () => {
  const { container } = render(<MyDialog open={true} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Manual:**
1. Open Chrome DevTools
2. Inspect element
3. Check Accessibility pane → Contrast ratio
4. Verify ratio meets requirements

## Touch Targets (Mobile)

### Size Requirements

All interactive elements must be:
- **Minimum:** 44×44px
- **Recommended:** 48×48px

### Implementation

Use Tailwind classes:

```tsx
// Buttons
<Button className="min-h-11">Submit</Button> // 44px

// Input fields
<Input className="h-11" /> // 44px

// Custom touch targets
<button className="min-h-11 min-w-11">
  <Icon />
</button>
```

### Spacing

Minimum 8px between touch targets:

```tsx
<div className="flex gap-2"> {/* 8px gap */}
  <Button>Cancel</Button>
  <Button>Submit</Button>
</div>
```

## Screen Reader Testing

### Automated Testing

Run vitest-axe on all modals:

```tsx
import { axe } from '../../setup-axe';

describe('MyDialog Accessibility', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <MyDialog open={true} onClose={vi.fn()} />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### Manual Testing

Follow the [Accessibility Testing Guide](../accessibility-testing-guide.md) for:
- NVDA testing (Windows)
- VoiceOver testing (macOS/iOS)
- Manual keyboard navigation

## Common Issues and Fixes

### Issue: Missing Label

❌ **Error:** "Form elements must have labels"

✅ **Fix:**
```tsx
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" />
```

### Issue: Insufficient Contrast

❌ **Error:** "Elements must have sufficient color contrast"

✅ **Fix:** Use semantic colors from theme:
```tsx
// Instead of custom colors
<p className="text-gray-400">Text</p>

// Use theme colors
<p className="text-muted-foreground">Text</p>
```

### Issue: Touch Target Too Small

❌ **Error:** Button is 32×32px on mobile

✅ **Fix:**
```tsx
<Button
  size={isMobile ? "default" : "sm"}
  className="min-h-11" // Ensure 44px minimum
>
  Submit
</Button>
```

### Issue: Focus Not Visible

❌ **Error:** No visible focus ring on button

✅ **Fix:**
```tsx
<button className="focus-visible:ring-2 focus-visible:ring-ring">
  Click
</button>
```

## Testing Workflow

### 1. Automated Tests

```bash
# Run accessibility tests
npm test -- --grep="a11y|Accessibility"
```

Expected: All tests pass with 0 violations

### 2. Keyboard Navigation

1. Open modal with mouse
2. Press Tab repeatedly
3. Verify:
   - Focus stays in modal
   - All interactive elements reachable
   - Focus order is logical
   - Focus indicators visible
4. Press Escape
5. Verify modal closes and focus returns

### 3. Screen Reader (Optional but Recommended)

**Windows (NVDA):**
1. Download NVDA (free)
2. Open modal
3. Listen to announcements
4. Navigate with Tab
5. Verify all content readable

**macOS (VoiceOver):**
1. Press Cmd+F5 to enable
2. Open modal
3. Navigate with Control+Option+Arrow
4. Verify all content readable

### 4. Mobile Testing

1. Open in Chrome DevTools device mode
2. Test iPhone SE (375px width)
3. Verify:
   - Touch targets ≥44px
   - Sheet appears from bottom
   - All actions accessible
   - Text readable without zoom

## Documentation

After verifying accessibility:

```bash
git commit -m "feat: add accessible MyDialog

- All form fields have labels
- WCAG 2.1 AA compliant (vitest-axe)
- Keyboard navigation working
- Touch targets meet 44px minimum
- Color contrast verified
- Screen reader tested

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

## Resources

**Internal:**
- [Accessibility Testing Guide](../accessibility-testing-guide.md) - Manual testing procedures
- [Accessibility Audit Results](../accessibility-audit-results.md) - Current compliance status

**External:**
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

---

**Next:** [Testing Guide](./testing.md)
