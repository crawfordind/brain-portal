# Modal System Redesign

**Date:** 2026-01-19
**Status:** Design Complete, Ready for Implementation
**Goal:** Create world-class modal/dialog system with excellent mobile experience

## Problem Statement

Current modal implementations have several issues:
- Attachment viewer header overflows on mobile (4+ buttons squeeze together)
- Inconsistent sizing and spacing across 11 modal components
- Poor mobile experience (fixed heights don't account for browser chrome)
- Desktop-first layouts don't adapt well to small screens
- No standardized interaction patterns (gestures, dismissal methods)

## Design Philosophy

Mix best practices from world-class apps:
- **Linear**: Clean, fast, keyboard-first, beautiful animations
- **Notion**: Smooth, content-focused, adaptive layouts
- **Apple**: Minimal, contextual, gesture-driven
- **Vercel/Raycast**: Modern aesthetic, crisp borders, subtle shadows

## Modal System Architecture

### Three Modal Categories

All 11 modals organized into three clear categories:

#### 1. Compact Modals
**Use:** Quick interactions, simple forms (3-8 fields)

**Desktop:**
- Size: `max-w-md` (448px)
- Padding: `p-6` (24px)
- Header: `h-14` (56px) with border-b
- Footer: `h-16` (64px) with border-t
- Content: Auto height with `max-h-[60vh]` scroll

**Mobile:**
- Format: Bottom sheet
- Height: 75vh
- Padding: `p-4` (16px)
- Rounded top corners: `rounded-t-2xl` (16px)

**Examples:**
- Quick capture dialog
- Create task form
- Create project form
- Create capture form
- Image alt text editor

#### 2. Standard Modals
**Use:** Multi-step flows, content browsing, filtering

**Desktop:**
- Size: `max-w-2xl` (672px)
- Padding: `p-6`
- Header: `h-16` (64px) with border-b
- Footer: `h-18` (72px) with border-t, sticky buttons
- Content: `flex-1` with overflow-auto

**Mobile:**
- Format: Bottom sheet
- Height: 85vh
- Padding: `p-4`
- Rounded top corners: `rounded-t-2xl`

**Examples:**
- Attachment picker
- Filter sheet
- Mobile navigation sheet
- Command palette

#### 3. Immersive Modals
**Use:** Content consumption, detailed viewing, rich interactions

**Desktop:**
- Size: `max-w-7xl` (1280px)
- Padding: `p-0` (full bleed)
- Header: Floating or integrated, no border
- Footer: Context-dependent
- Content: Full height minus header/footer

**Mobile:**
- Format: Adaptive (bottom sheet for viewers, full-screen for editors)
- Height: 90vh
- Padding: `p-0`
- Rounded top corners: `rounded-t-2xl`

**Examples:**
- Attachment viewer
- Attachment bottom sheet
- Future: Note editor modal, image gallery

### Base Component Enhancements

#### Enhanced Dialog Component
```typescript
interface DialogProps {
  size?: 'compact' | 'standard' | 'immersive';
  dismissible?: boolean; // Allow backdrop tap to close
  showCloseButton?: boolean; // Default: true
  onDismiss?: () => void;
}
```

Features:
- Size variants with responsive behavior
- Swipe-to-dismiss gesture layer (mobile)
- Configurable backdrop dismissal
- Enhanced animations (spring physics)
- Focus trap improvements
- Auto-focus management

#### Enhanced Sheet Component
```typescript
interface SheetProps {
  side?: 'top' | 'bottom' | 'left' | 'right';
  size?: 'compact' | 'standard' | 'immersive';
  dismissible?: boolean;
}
```

Features:
- Bottom sheet with rounded corners
- Drag handle indicator
- Swipe down to dismiss
- Safe area insets for mobile notches
- Improved touch gestures

#### Shared Modal Patterns
New reusable components in `components/modals/`:

- **ModalHeader**: Consistent header with title, subtitle, close button
- **ModalFooter**: Sticky footer with action buttons (primary/secondary)
- **ModalSection**: Collapsible sections with accordions
- **FloatingActions**: Overlay action bar for viewers (mobile)

## Attachment Viewer Redesign

### Desktop Experience

**Layout:**
- Max width: `max-w-7xl` (wider for better viewing)
- Max height: `max-h-[85vh]` (room for browser chrome)
- Preview area: 2/3 width, centered content
- Metadata sidebar: 1/3 width, scrollable
- Header: Sticky with auto-hide on scroll

**Header:**
- Single row layout
- Filename: Truncates with tooltip on hover
- File size + upload date: Muted text below filename
- Actions: Right-aligned icon buttons with tooltips
  - Download (primary)
  - Open in new tab
  - Delete (destructive)
  - Close (always visible)

**Preview Area:**
- Images: `object-contain`, max dimensions
- PDFs: Full iframe, scrollable
- Audio: Centered player with icon
- Video: Native player with controls
- Documents: Iframe or download prompt

**Metadata Sidebar:**
- Sections with consistent spacing (`space-y-6`)
- Description (always visible if present)
- Tags (chip-style badges)
- Extracted text (line-clamp-6, expandable)
- File details (definition list)
- Type-specific metadata (Image/PDF info)

### Mobile Experience (Complete Redesign)

**Format:** Bottom sheet slides up from bottom

**Three-Zone Layout:**

1. **Preview Zone** (Top)
   - Full-width, aspect-ratio aware
   - Pinch-to-zoom for images
   - Swipe down on preview to dismiss
   - Dark backdrop for focus

2. **Action Bar** (Floating)
   - Position: Absolute, bottom of preview
   - Background: Translucent blur (`backdrop-blur-sm`)
   - Buttons: Icon-only, 48px touch targets
   - Actions: Download, Open, Share, Delete
   - Auto-hide on scroll (returns on scroll up)

3. **Metadata Drawer** (Bottom)
   - Collapsible accordion sections
   - Swipe up to expand full details
   - Sections collapsed by default except description
   - Drag handle at top

**Removed on Mobile:**
- Header (replaced by floating actions)
- Sidebar (moved to bottom drawer)
- Close button in header (use swipe down)

**Gestures:**
- Swipe down on preview: Dismiss modal
- Swipe up on metadata: Expand to full details
- Pinch/zoom on images: Native zoom
- Tap backdrop: Dismiss

## Visual Standards

### Size Tokens

```css
/* Compact */
--modal-compact-width: 28rem; /* 448px */
--modal-compact-padding: 1.5rem; /* 24px */
--modal-compact-mobile-height: 75vh;

/* Standard */
--modal-standard-width: 42rem; /* 672px */
--modal-standard-padding: 1.5rem;
--modal-standard-mobile-height: 85vh;

/* Immersive */
--modal-immersive-width: 80rem; /* 1280px */
--modal-immersive-padding: 0;
--modal-immersive-mobile-height: 90vh;
```

### Visual Hierarchy

**Backdrop:**
- Color: `bg-black/60` (increased from 50%)
- Blur: Optional `backdrop-blur-sm` for glass effect
- Z-index: `z-50`

**Modal Surface:**
- Background: `bg-background`
- Shadow: `shadow-2xl` (deeper than current)
- Border: `border border-border` (subtle separation)
- Z-index: `z-[51]`

**Rounded Corners:**
- Dialog (desktop): `rounded-lg` (8px)
- Dialog (mobile): `rounded-xl` (12px)
- Bottom sheets: `rounded-t-2xl` (16px)
- Floating actions: `rounded-full` (buttons)

**Z-index Stack:**
- Backdrop: `z-50`
- Modal content: `z-[51]`
- Floating actions: `z-[52]`
- Tooltips: `z-[53]`

### Spacing Standards

**Section Spacing:**
- Main sections: `space-y-6` (24px)
- Form fields: `space-y-4` (16px)
- Related items: `space-y-2` (8px)

**Button Groups:**
- Related buttons: `gap-2` (8px)
- Separated actions: `gap-3` (12px)
- Stacked (mobile): `space-y-2`

**Touch Targets:**
- Mobile minimum: `min-h-11` (44px)
- Desktop minimum: `min-h-9` (36px)
- List items mobile: `min-h-12` (48px)
- List items desktop: `min-h-10` (40px)

**Safe Areas:**
- Padding top: `safe-area-inset-top`
- Padding bottom: `safe-area-inset-bottom`
- Account for iPhone notch/Dynamic Island
- Home indicator space on iOS

### Animation Standards

**Modal Animations:**
- Enter: 200ms ease-out (fade + scale from 95%)
- Exit: 150ms ease-in (fade + scale to 95%)
- Backdrop: 200ms fade in/out

**Sheet Animations:**
- Enter: 300ms spring (slide from bottom/side)
- Exit: 250ms ease-in (slide out)
- Drag follow: No delay, 1:1 touch tracking

**Micro-interactions:**
- Hover states: 100ms
- Focus states: 100ms
- Button press: 100ms
- Accordion expand: 200ms ease-out

**Performance:**
- Use `will-change: transform` for animations
- Respect `prefers-reduced-motion`
- GPU acceleration for transforms
- Suspend heavy animations on low-end devices

## Interaction Patterns

### Dismissal Methods (Hybrid Approach)

#### 1. Swipe Down to Dismiss (Mobile Only)
- Threshold: 100px swipe distance OR 40% velocity
- Visual feedback: Modal follows finger with resistance
- Cancel: Springs back if < threshold
- Works on: Bottom sheets, full-screen modals
- Disabled during: Form editing (shows confirmation)

#### 2. Backdrop Tap to Dismiss (Configurable)
- Default ON: Viewers, pickers, info dialogs
- Default OFF: Forms, destructive actions
- Prop: `dismissible` boolean
- Mobile: Larger backdrop hit area

#### 3. Close Button (Always Visible)
- Position: Absolute top-right
- Size: 40px × 40px (desktop), 44px × 44px (mobile)
- Icon: X (Lucide), 20px
- Style: Ghost button with hover state
- Always present, never hidden

#### 4. Keyboard Shortcuts
- ESC: Close modal (always)
- Cmd/Ctrl + K: Command palette (if applicable)
- Cmd/Ctrl + Enter: Submit form (if applicable)
- Arrow keys: Navigate between items

### Button Patterns

**Primary Actions:**
- Position: Right-aligned in footer
- Style: Solid background (`bg-primary`)
- Text: White (`text-primary-foreground`)
- States: Default, hover, active, disabled, loading

**Secondary Actions:**
- Position: Left of primary
- Style: Outline (`variant="outline"`)
- Multiple secondary: Space with `gap-2`

**Destructive Actions:**
- Style: Red variant (`variant="destructive"`)
- Always require confirmation dialog
- Icon + label for clarity

**Icon Buttons:**
- Tooltips on hover (desktop)
- Tooltips on long-press (mobile, 500ms)
- Minimum 44px touch target (mobile)
- Visual feedback on press

**Loading States:**
- Replace icon with spinner
- Disable button
- Preserve button width (prevent layout shift)
- Show loading text: "Saving..." / "Deleting..."

### Focus Management

**On Modal Open:**
- Auto-focus first input (forms)
- Focus close button (non-forms)
- Trap focus within modal
- Prevent background scroll

**On Modal Close:**
- Return focus to trigger element
- Restore scroll position
- Clear focus trap

**Keyboard Navigation:**
- Tab: Next focusable element
- Shift+Tab: Previous focusable element
- Enter: Activate focused button
- Space: Toggle checkboxes/switches
- Arrow keys: Navigate lists/options

**Screen Readers:**
- `role="dialog"` on modal
- `aria-modal="true"`
- `aria-labelledby` for title
- `aria-describedby` for description
- Skip links for long modals

### Scroll Behavior

**Body Scroll Lock:**
- Prevent scroll on `<body>` when modal open
- Use `overflow: hidden` on body
- Restore scroll position on close
- Prevent scroll chaining

**Modal Content Scroll:**
- Independent scroll container
- Sticky header/footer
- Scroll shadows at edges
- Overscroll prevention (no bounce)

**Mobile Specific:**
- Momentum scrolling: `-webkit-overflow-scrolling: touch`
- Prevent pull-to-refresh
- Keyboard pushes content (resize mode)

## Responsive Behavior

### Breakpoint Strategy

**Mobile** (< 640px / sm)
- All modals → Bottom sheets or full-screen
- Single column layouts
- Stacked buttons (full width)
- Collapsible sections (accordions)
- Touch-optimized spacing

**Tablet** (640px - 1024px / sm to lg)
- Compact/Standard → Centered dialogs
- Immersive → Bottom sheets (taller, 85vh)
- Two columns where appropriate
- Side-by-side buttons with wrapping
- Hybrid touch/mouse interactions

**Desktop** (> 1024px / lg+)
- All three modal types as designed
- Multi-column layouts
- Inline button groups
- Expanded content areas
- Keyboard shortcuts prominent

### Adaptive Components

**Attachment Viewer:**
- Mobile: Bottom sheet, stacked (preview → actions → metadata)
- Tablet: Dialog, metadata below preview
- Desktop: Dialog, side-by-side (2/3 preview + 1/3 metadata)

**Attachment Picker:**
- Mobile: Full-screen sheet, 2-column grid
- Tablet: Dialog, 3-column grid, search top
- Desktop: Dialog, 4-column grid, filters sidebar

**Quick Capture:**
- Mobile: Bottom sheet (75vh), voice button prominent
- Tablet: Centered dialog (500px)
- Desktop: Same as tablet

**Create Forms:**
- Mobile: Bottom sheet, full-width inputs, stacked labels
- Tablet/Desktop: Centered dialog, side-by-side labels

### Device-Specific Considerations

**iPhone (Notch/Dynamic Island):**
- Safe area insets: `env(safe-area-inset-*)`
- Top padding accounts for notch
- Bottom padding for home indicator
- Test on iPhone 14 Pro, iPhone 15 Pro Max

**Android:**
- Various screen sizes and aspect ratios
- Navigation bar vs gesture navigation
- Test on Pixel, Samsung Galaxy, OnePlus

**Tablets:**
- iPad: Both portrait and landscape
- Android tablets: Various sizes
- Side-by-side apps (split screen)

**Foldables:**
- Samsung Galaxy Fold/Flip
- Adaptive layouts for folded/unfolded states

**Desktop:**
- Minimum width: 320px
- Maximum width: 1920px
- Test browser zoom (100%, 150%, 200%)

### Performance Considerations

**Lazy Loading:**
- Render modal content only when open
- Don't mount until user triggers
- Unmount after close (configurable)

**Virtualization:**
- Long lists in pickers use react-window
- Render only visible items
- Smooth scrolling with overscan

**Image Optimization:**
- Responsive images with srcset
- Lazy load images below fold
- WebP with fallback
- Blur placeholder while loading

**Search Debouncing:**
- 300ms delay on search inputs
- Cancel previous requests
- Show loading state
- Cache recent results

**Animation Performance:**
- Use CSS transforms (GPU accelerated)
- Avoid layout thrashing
- Monitor frame rate
- Disable on `prefers-reduced-motion`

## Implementation Plan

### Phase 1: Foundation (Enhanced Base Components)

**1.1 Update Dialog Component** (`components/ui/dialog.tsx`)
- Add size variants: compact/standard/immersive
- Add `dismissible` prop for backdrop behavior
- Enhance animations with spring physics
- Add swipe-to-dismiss gesture layer
- Improve focus trap implementation
- Add responsive size handling

**1.2 Update Sheet Component** (`components/ui/sheet.tsx`)
- Add bottom sheet rounded corners
- Implement swipe down to dismiss
- Add drag handle indicator
- Safe area insets for mobile notches
- Improve touch gesture handling

**1.3 Create Shared Patterns** (`components/modals/`)
- `ModalHeader` - Consistent header with close button
- `ModalFooter` - Sticky footer with action buttons
- `ModalSection` - Collapsible sections (accordions)
- `FloatingActions` - Overlay action bar for viewers
- `ModalDragHandle` - Visual indicator for sheets

**Deliverables:**
- Enhanced Dialog primitive with size variants
- Enhanced Sheet primitive with gestures
- 5 reusable modal patterns
- Storybook stories for components
- Unit tests for gesture handling

### Phase 2: Attachment Viewer (Fix Immediate Issue)

**2.1 Desktop Refinement**
- Update max-width to `max-w-7xl`
- Update max-height to `max-h-[85vh]`
- Refine header spacing and layout
- Improve action button grouping
- Add auto-hide header on scroll

**2.2 Mobile Redesign**
- Convert to bottom sheet layout
- Create three-zone layout (preview/actions/metadata)
- Implement floating action bar
- Add collapsible metadata sections
- Remove desktop header on mobile

**2.3 Enhanced Features**
- Pinch-to-zoom for images
- Swipe gestures (down to dismiss, up for metadata)
- Improved preview rendering
- Better error states
- Loading states for all file types

**2.4 Device Testing**
- iPhone 14 Pro (notch)
- iPhone 15 Pro Max (Dynamic Island)
- Android Pixel, Samsung Galaxy
- iPad (portrait/landscape)
- Desktop (Chrome, Safari, Firefox)

**Deliverables:**
- Redesigned AttachmentViewer component
- Mobile-first responsive behavior
- Enhanced gesture support
- Comprehensive device testing
- Before/after screenshots

### Phase 3: Standardize Existing Modals

**3.1 Compact Modals → Bottom Sheets**
- Quick capture dialog
- Create task form
- Create project form
- Create capture form
- Image alt text editor

Apply pattern:
- Desktop: `max-w-md` centered dialog
- Mobile: 75vh bottom sheet
- Consistent header/footer
- Touch-optimized inputs

**3.2 Standard Modals → Adaptive Layouts**
- Attachment picker
- Filter sheet
- Mobile navigation sheet
- Command palette

Apply pattern:
- Desktop: `max-w-2xl` centered dialog
- Mobile: 85vh bottom sheet
- Tabbed interfaces where needed
- Search/filter patterns

**3.3 Immersive Modals → Full Treatment**
- Attachment bottom sheet (refine existing)
- Future modals (note editor, gallery)

Apply pattern:
- Desktop: `max-w-7xl` with custom layouts
- Mobile: Adaptive (sheet or full-screen)
- Rich interactions
- Content-focused design

**Deliverables:**
- 11 standardized modals
- Consistent behavior across categories
- Shared component usage
- Reduced code duplication

### Phase 4: Polish & Consistency

**4.1 Visual Refinement**
- Update backdrop opacity to 60%
- Apply shadow-2xl to all modals
- Unified border radius tokens
- Consistent animation timing
- Color contrast verification

**4.2 Accessibility Audit**
- Screen reader testing (NVDA, VoiceOver)
- Keyboard navigation testing
- Focus management verification
- ARIA label completeness
- Color contrast ratios
- Touch target sizes

**4.3 Performance Optimization**
- Implement lazy loading for modals
- Add virtualization for long lists
- Optimize animation performance
- Bundle size analysis
- Lighthouse audit
- Core Web Vitals check

**4.4 Documentation**
- Component API documentation
- Usage examples for each category
- Responsive behavior guidelines
- Accessibility best practices
- Migration guide for existing modals

**Deliverables:**
- Polished visual design system
- Accessibility compliance (WCAG 2.1 AA)
- Performance benchmarks met
- Complete documentation
- Design system in Storybook

## Testing Strategy

### Unit Tests
- Gesture handlers (swipe, tap, pinch)
- Focus management
- Keyboard shortcuts
- Dismissal methods
- Animation states

### Integration Tests
- Modal open/close flows
- Form submission
- File upload in pickers
- Navigation between modals
- Error handling

### Visual Regression Tests
- Screenshot comparison
- Responsive breakpoints
- Dark mode variants
- Animation states
- Loading states

### Accessibility Tests
- Automated (axe-core)
- Manual screen reader testing
- Keyboard navigation
- Color contrast
- Touch target sizes

### Performance Tests
- First paint time
- Animation frame rate
- Bundle size impact
- Lazy loading effectiveness
- Memory usage

### Device Testing
- iOS (Safari): iPhone 12, 14 Pro, 15 Pro Max
- Android (Chrome): Pixel, Samsung Galaxy
- Tablets: iPad Air, iPad Pro, Android tablet
- Desktop: Chrome, Safari, Firefox, Edge
- Responsive testing: 320px to 1920px

## Success Metrics

### User Experience
- Modal open/close feels instant (< 100ms perceived)
- No layout shifts during animations
- Smooth 60fps animations
- Touch gestures feel native
- Keyboard navigation is efficient

### Performance
- Modal bundle size < 15kb gzipped
- First paint < 50ms
- Animation frame rate 60fps
- No memory leaks
- Core Web Vitals: Green

### Accessibility
- WCAG 2.1 AA compliant
- Screen reader friendly
- Keyboard accessible
- Touch targets ≥ 44px
- Color contrast ≥ 4.5:1

### Developer Experience
- Clear API with TypeScript types
- Easy to add new modals
- Documented patterns
- Storybook examples
- Migration path from old modals

## Migration Guide

### For Existing Modals

**Step 1:** Identify modal category (compact/standard/immersive)

**Step 2:** Update Dialog/Sheet usage:
```typescript
// Before
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-lg">
    {/* content */}
  </DialogContent>
</Dialog>

// After
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="compact" dismissible>
    <ModalHeader title="Quick Capture" onClose={() => setOpen(false)} />
    {/* content */}
    <ModalFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      <Button onClick={handleSubmit}>Save</Button>
    </ModalFooter>
  </DialogContent>
</Dialog>
```

**Step 3:** Replace custom headers/footers with ModalHeader/ModalFooter

**Step 4:** Test responsive behavior on mobile

**Step 5:** Add appropriate gestures (swipe, backdrop tap)

### Breaking Changes
- `DialogContent` className overrides may conflict with size variants
- Custom z-index values need review
- Hard-coded widths should be removed
- Header/footer padding now standardized

### Deprecations
- Custom modal headers (use ModalHeader)
- Custom modal footers (use ModalFooter)
- Inline close buttons (use ModalHeader's close)

## Future Enhancements

### Phase 5 (Future)
- Modal transitions (slide between related modals)
- Multi-step modal wizards
- Nested modals (if truly needed)
- Modal history/stack management
- Shared element transitions
- Advanced gestures (swipe to next attachment)

### Considerations
- Do we need modal-to-modal transitions?
- Should modals support undo/redo?
- Can we add smart positioning (avoid keyboard)?
- Should we support modal queuing?

## References

### Design Inspiration
- Linear: https://linear.app
- Notion: https://notion.so
- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/
- Radix UI: https://radix-ui.com/primitives/docs/components/dialog
- shadcn/ui: https://ui.shadcn.com/docs/components/dialog

### Technical Resources
- Radix Dialog: https://radix-ui.com/primitives/docs/components/dialog
- React Aria Dialog: https://react-spectrum.adobe.com/react-aria/Dialog.html
- ARIA Authoring Practices: https://w3c.github.io/aria-practices/#dialog_modal
- WCAG 2.1: https://w3.org/WAI/WCAG21/quickref/

### Tools
- Framer Motion (animations)
- react-use-gesture (swipe gestures)
- @radix-ui/react-dialog (primitives)
- Storybook (component documentation)

---

**Status:** Design validated, ready for implementation
**Next Steps:** Create implementation plan with git worktree, begin Phase 1
