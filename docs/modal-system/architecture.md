# Modal System Architecture

**Version:** 4.0
**Status:** Production Ready

## System Overview

The modal system is built on three layers:

```
┌─────────────────────────────────────────┐
│     Application Layer (Pages)          │
│  - TasksPage, ProjectsPage, etc.       │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    Pattern Layer (Dialog Components)   │
│  - TaskCreateDialog                     │
│  - AttachmentPicker                     │
│  - FilterSheet                          │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│   Foundation Layer (Base Components)   │
│  - ModalHeader, ModalFooter             │
│  - ModalSection, FloatingActions        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│     Primitive Layer (shadcn/ui)        │
│  - Dialog, Sheet (Radix UI wrappers)   │
└─────────────────────────────────────────┘
```

## Design Principles

### 1. Progressive Enhancement
Start simple, add complexity only when needed:
- Basic dialog → Add mobile sheet → Add lazy loading → Add voice input

### 2. Composition Over Configuration
Build complex modals from simple, reusable pieces:
- ModalHeader + Form + ModalFooter = TaskCreateDialog

### 3. Mobile-First Responsive
All modals work on mobile:
- Desktop: Dialog centered on screen
- Mobile: Sheet slides up from bottom

### 4. Accessibility By Default
WCAG 2.1 AA compliance built-in:
- ARIA attributes automatic
- Keyboard navigation works
- Screen readers supported

### 5. Performance-Conscious
Lazy load when possible:
- LazyDialog wrapper prevents unused imports
- Components load on-demand

## Component Hierarchy

### Foundation Components

**ModalHeader**
```
Purpose: Standardized header for all modals
Features: Title, subtitle, close button, ARIA attributes
Used by: Every dialog and sheet component
```

**ModalFooter**
```
Purpose: Consistent action buttons
Features: Primary/secondary actions, mobile optimization
Used by: Form dialogs, multi-step flows
Note: Currently using direct footer divs (Phase 3 discovery)
```

**ModalSection**
```
Purpose: Grouped content with optional collapse
Features: Title, collapsible, ARIA group role
Used by: FilterSheet, complex forms
```

**FloatingActions**
```
Purpose: Mobile-optimized floating buttons
Features: Fixed positioning, safe area support
Used by: AttachmentViewer (immersive modals)
```

**ModalDragHandle**
```
Purpose: Visual affordance for draggable sheets
Features: Centered handle, accessibility support
Used by: AttachmentViewer, future mobile sheets
```

### Pattern Components

**Compact Modals** (max-w-md, 75vh mobile)
- QuickCaptureDialog
- TaskCreateDialog
- ProjectCreateDialog
- CaptureCreateDialog

**Standard Modals** (max-w-2xl, 85vh mobile)
- AttachmentPicker
- FilterSheet

**Immersive Modals** (max-w-7xl, 90vh mobile)
- AttachmentViewer
- AttachmentBottomSheet

## Responsive Behavior

### Desktop
```
Dialog:
  - Centered on screen
  - Fixed max-width (md/2xl/7xl)
  - Scrollable content area
  - Close on backdrop click
  - Close on Escape key
```

### Mobile
```
Sheet:
  - Slides up from bottom
  - Fixed height (75vh/85vh/90vh)
  - Rounded top corners (rounded-t-2xl)
  - Drag to dismiss (future)
  - Safe area padding
```

### Implementation Pattern
```typescript
const isMobile = useMobile();

if (isMobile) {
  return <Sheet>...</Sheet>;
}

return <Dialog>...</Dialog>;
```

## Size Variants

### Compact (max-w-md, 448px)
**Use for:** Quick forms, simple interactions
**Mobile:** 75vh height
**Examples:** Create task, quick capture

### Standard (max-w-2xl, 672px)
**Use for:** Multi-step flows, content browsing
**Mobile:** 85vh height
**Examples:** Attachment picker, filters

### Immersive (max-w-7xl, 1280px)
**Use for:** Content consumption, rich media
**Mobile:** 90vh height
**Examples:** Attachment viewer, galleries

## State Management

### Dialog State
```typescript
const [isOpen, setIsOpen] = useState(false);

// Open
setIsOpen(true);

// Close
setIsOpen(false);
```

### Form State
```typescript
const [formData, setFormData] = useState({});

// Update field
setFormData(prev => ({ ...prev, [field]: value }));

// Submit
const handleSubmit = async () => {
  await saveData(formData);
  setIsOpen(false);
};
```

### Lazy Loading State
```typescript
// Using LazyDialog
<LazyDialog
  open={isOpen}
  loader={() => import('./dialog').then(m => ({ default: m.Dialog }))}
/>

// Component loads only when opened
// Skeleton shows during load
```

## Accessibility Architecture

### ARIA Structure
```html
<Dialog aria-modal="true" aria-labelledby="dialog-title">
  <div role="heading" aria-level="2" id="dialog-title">
    Title
  </div>
  <div>Content</div>
  <button aria-label="Close dialog">×</button>
</Dialog>
```

### Focus Management
1. Dialog opens → Focus moves to first focusable element
2. Tab key → Cycles through focusable elements (trapped)
3. Escape key → Closes dialog
4. Dialog closes → Focus returns to trigger element

### Screen Reader Announcements
1. Dialog opens → "Dialog, [Title]" announced
2. Tab navigation → Each element announced
3. Close button → "Close dialog, button" announced

## Performance Architecture

### Lazy Loading Strategy
```
Page Load:
  ├─ Foundation components loaded (5.1KB)
  ├─ Dialog primitives loaded (Dialog, Sheet)
  └─ Pattern components NOT loaded (saved 17KB)

User Opens Dialog:
  └─ Pattern component loads on-demand (3-4KB)
     └─ Shows skeleton during load (<100ms)
     └─ Component cached for subsequent opens
```

### Bundle Splitting
```
Initial Bundle:
  ├─ app-layout.js (includes QuickCaptureDialog)
  ├─ tasks-page.js (does NOT include TaskCreateDialog)
  └─ modal-foundations.js (ModalHeader, etc.)

Lazy Chunks:
  ├─ task-create-dialog.chunk.js (loaded on demand)
  ├─ project-create-dialog.chunk.js
  └─ capture-create-dialog.chunk.js
```

## Testing Architecture

### Test Layers

**Unit Tests** (Component behavior)
```typescript
test('ModalHeader renders title', () => {
  render(<ModalHeader title="Test" />);
  expect(screen.getByText('Test')).toBeInTheDocument();
});
```

**Accessibility Tests** (vitest-axe)
```typescript
test('ModalHeader has no a11y violations', async () => {
  const { container } = render(<ModalHeader title="Test" />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Integration Tests** (Full workflows)
```typescript
test('create task workflow', async () => {
  render(<TasksPage />);
  await user.click(screen.getByText('New Task'));
  await user.type(screen.getByLabelText('Task'), 'Test');
  await user.click(screen.getByText('Create'));
  expect(screen.getByText('Test')).toBeInTheDocument();
});
```

**Manual Tests** (Screen readers, mobile)
- See [Accessibility Testing Guide](./accessibility-testing-guide.md)

## Evolution History

### Phase 1: Foundation (Jan 2026)
- Created ModalHeader, ModalFooter, ModalSection
- Added size variants to Dialog
- Established patterns

### Phase 2: Attachment Viewer (Jan 2026)
- Redesigned with immersive pattern
- Added FloatingActions for mobile
- Mobile bottom sheet with drag handle

### Phase 3: Standardization (Jan 2026)
- Migrated 7 existing modals
- Extracted 3 create dialog components
- Consistent responsive patterns

### Phase 4: Polish (Jan 2026)
- WCAG 2.1 AA compliance
- Lazy loading implementation
- Comprehensive documentation
- Performance optimization

## Future Considerations

### Phase 5 (Potential)
- Drag-to-dismiss for all mobile sheets
- Modal history/stacking
- Nested modals (if needed)
- Shared element transitions
- Voice commands for modal actions

### Anti-Patterns to Avoid
- ❌ Don't create custom dialog primitives (use shadcn/ui)
- ❌ Don't skip ModalHeader (breaks consistency)
- ❌ Don't forget mobile responsive (use useMobile hook)
- ❌ Don't eager load large dialogs (use LazyDialog)
- ❌ Don't nest dialogs (consider multi-step flow instead)

---

**See Also:**
- [Creating New Modal Guide](./guides/creating-new-modal.md)
- [Responsive Dialog Pattern](./patterns/responsive-dialogs.md)
- [Size Variants Reference](./reference/size-variants.md)
