# Modal System Documentation

**Version:** 4.0 (Phase 4 Complete)
**Last Updated:** 2026-01-20

## Overview

The Brain Portal modal system provides a consistent, accessible, and performant way to display dialogs, sheets, and overlays across the application.

**Key Features:**
- ✅ **Accessible:** WCAG 2.1 AA compliant with full screen reader support
- ✅ **Responsive:** Adapts seamlessly between desktop dialogs and mobile sheets
- ✅ **Performant:** Lazy-loaded components, 60fps animations
- ✅ **Consistent:** Unified patterns across all modals
- ✅ **Flexible:** Three size variants (compact, standard, immersive)

## Quick Start

### Creating a Simple Dialog

```tsx
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ModalHeader } from '@/components/modals/modal-header';

function MyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        <ModalHeader title="My Dialog" onClose={onClose} />
        <p>Dialog content goes here</p>
      </DialogContent>
    </Dialog>
  );
}
```

### Creating a Responsive Dialog (Desktop + Mobile)

See [Responsive Dialog Pattern](./patterns/responsive-dialogs.md)

## Documentation Structure

### Components
- [ModalHeader](./components/modal-header.md) - Dialog/sheet header with title and close button
- [ModalFooter](./components/modal-footer.md) - Action buttons for dialogs
- [ModalSection](./components/modal-section.md) - Collapsible content sections
- [FloatingActions](./components/floating-actions.md) - Mobile-optimized action buttons
- [ModalDragHandle](./components/modal-drag-handle.md) - Visual indicator for draggable sheets

### Patterns
- [Responsive Dialogs](./patterns/responsive-dialogs.md) - Desktop dialog + mobile sheet pattern
- [Compact Modals](./patterns/compact-modals.md) - Quick forms (75vh mobile)
- [Standard Modals](./patterns/standard-modals.md) - Multi-step flows (85vh mobile)
- [Immersive Modals](./patterns/immersive-modals.md) - Content viewers (90vh mobile)

### Guides
- [Creating a New Modal](./guides/creating-new-modal.md) - Step-by-step guide
- [Accessibility](./guides/accessibility.md) - WCAG compliance checklist
- [Testing](./guides/testing.md) - Testing patterns and examples
- [Migration](./guides/migration.md) - Migrating old modals

### Reference
- [Size Variants](./reference/size-variants.md) - Compact/Standard/Immersive specs
- [Keyboard Shortcuts](./reference/keyboard-shortcuts.md) - All keyboard interactions
- [Examples](./reference/examples.md) - Common use cases with code

## Architecture

See [Architecture Document](./architecture.md) for detailed system design.

**Phase 1:** Foundation components (ModalHeader, ModalFooter, ModalSection)
**Phase 2:** Attachment viewer redesign (immersive modal pattern)
**Phase 3:** Standardization (7 modals migrated)
**Phase 4:** Polish (accessibility, performance, documentation) ← **Current**

## Getting Help

**Have questions?**
1. Check the [Examples](./reference/examples.md) for common patterns
2. See the [Creating New Modal Guide](./guides/creating-new-modal.md)
3. Review existing modals in `src/components/*/`

**Found a bug?**
- Check [Accessibility Testing Guide](./accessibility-testing-guide.md)
- Review [Audit Results](./accessibility-audit-results.md)
- Open an issue with reproduction steps

## Contributing

When creating new modals:
1. Follow the [Responsive Dialog Pattern](./patterns/responsive-dialogs.md)
2. Use [ModalHeader](./components/modal-header.md) for consistency
3. Write tests following [Testing Guide](./guides/testing.md)
4. Verify accessibility with [Accessibility Guide](./guides/accessibility.md)
5. Use [LazyDialog](./reference/examples.md#lazy-loading) for performance

---

**Next:** Start with [Creating a New Modal](./guides/creating-new-modal.md)
