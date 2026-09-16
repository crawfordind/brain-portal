# Modal System Phase 4: Polish & Consistency - Design Document

**Date:** 2026-01-20
**Status:** Design Complete, Ready for Implementation
**Goal:** Polish modal system with accessibility, performance, and documentation improvements

## Overview

Phase 4 enhances the existing modal foundation with accessibility (WCAG 2.1 AA), performance optimization, and comprehensive documentation. All improvements are non-breaking and additive.

## Architecture

### Overall Approach

Phase 4 adds three enhancement layers to the existing foundation:

1. **Accessibility Layer** - ARIA attributes, keyboard handlers, focus management
2. **Performance Layer** - Lazy loading, animation optimization, bundle analysis
3. **Documentation Layer** - Comprehensive markdown docs in `docs/modal-system/`

**Key Principles:**
- **Non-breaking:** All enhancements are additive, no API changes
- **Progressive:** Each improvement can be tested independently
- **Measurable:** Clear success criteria (WCAG 2.1 AA, Lighthouse >90, complete docs)
- **Backward compatible:** Existing components continue working without changes

## 1. Accessibility Improvements

**Target:** WCAG 2.1 AA compliance for all modal components

### 1.1 ARIA Attributes Enhancement

**ModalHeader improvements:**
- Add `role="heading"` and `aria-level="2"` to title element
- Ensure close button has proper `aria-label="Close dialog"` (already present)
- Add `id` prop to allow dialogs to reference it with `aria-labelledby`

**Dialog/Sheet improvements:**
- Ensure `aria-describedby` points to content area (currently missing warning in tests)
- Verify `aria-modal="true"` is set (Radix handles this)
- Support `aria-labelledby` to reference ModalHeader title

**ModalSection improvements:**
- Add `role="group"` for filter groupings
- Add `aria-labelledby` pointing to section title
- Ensure collapsible sections have proper `aria-expanded` state

### 1.2 Keyboard Navigation

**Focus Management:**
- Focus trap within modal when open (Radix handles this)
- Return focus to trigger element on close (Radix handles this)
- Add focus-visible styles to all interactive elements
- Ensure tab order is logical (header → content → footer)

**Keyboard Shortcuts:**
- `Escape` to close (already works via Radix)
- `Tab/Shift+Tab` for navigation (already works)
- Add visual focus indicators with `ring-2 ring-ring ring-offset-2` classes

### 1.3 Screen Reader Support

**Announcements:**
- Ensure dialog title is announced when modal opens
- Add live region for dynamic content updates (if needed)
- Proper labeling for all form controls in create dialogs

**Testing checklist:**
- Test with NVDA (Windows) - document steps
- Test with VoiceOver (macOS/iOS) - document steps
- Verify all interactive elements are reachable
- Verify all content is readable in logical order

### 1.4 Color Contrast

**Audit items:**
- Modal header title against background (4.5:1 minimum)
- Close button icon against background
- Form labels against background
- Placeholder text (3:1 minimum)
- Focus indicators (3:1 against background)

**Approach:** Use automated contrast checker, fix any failures with design tokens.

### 1.5 Touch Targets

**Verification:**
- All buttons meet 44×44px minimum (check mobile sheets)
- Close buttons are appropriately sized
- Form controls have adequate spacing
- Sheet drag handle is large enough (if added)

## 2. Performance Optimization

**Goal:** Fast loading, smooth animations, minimal bundle impact

### 2.1 Lazy Loading Strategy

**Problem:** All modal components are imported eagerly, even if never used.

**Solution - Dynamic Imports:**
```tsx
// Instead of:
import { TaskCreateDialog } from '@/components/tasks/task-create-dialog';

// Use:
const TaskCreateDialog = lazy(() => import('@/components/tasks/task-create-dialog'));

// Wrap usage:
<Suspense fallback={<DialogSkeleton />}>
  {isOpen && <TaskCreateDialog ... />}
</Suspense>
```

**Implementation:**
- Create `LazyDialog` wrapper component for easy adoption
- Add skeleton fallback for loading state
- Measure bundle impact (expect 5-10KB savings per lazy modal)
- Document pattern for future modals

### 2.2 Animation Performance

**Current state:** Using Radix default animations (fade/zoom)

**Optimizations:**
- Ensure animations use `transform` and `opacity` only (GPU-accelerated)
- Verify no layout thrashing during open/close
- Check for 60fps during animations
- Consider `will-change` hints for frequently animated properties

**Testing:**
- Chrome DevTools Performance tab
- Record modal open/close sequences
- Verify no long tasks (>50ms)
- Check paint/composite metrics

### 2.3 Bundle Size Analysis

**Baseline measurement:**
- Run `npm run build` and capture current modal bundle size
- Identify largest dependencies (Radix UI components)
- Check for duplicate dependencies

**Optimization targets:**
- Lazy load modals: ~30-50KB savings
- Tree-shake unused Radix components
- Verify no duplicate React instances

**Tools:**
- Next.js built-in bundle analyzer
- `@next/bundle-analyzer` (if needed)
- Document before/after metrics

### 2.4 Core Web Vitals

**Lighthouse audit checklist:**
- Performance score >90
- Accessibility score >90
- Best Practices score >90
- SEO score >90

**Specific metrics:**
- LCP (Largest Contentful Paint): Modal shouldn't block initial page load
- CLS (Cumulative Layout Shift): Modal appearance shouldn't shift page
- FID (First Input Delay): Modal interactions should be responsive
- INP (Interaction to Next Paint): <200ms for modal open/close

**Testing approach:**
- Run Lighthouse in incognito mode
- Test on throttled network (Fast 3G)
- Test on throttled CPU (4x slowdown)
- Document results and recommendations

### 2.5 Virtualization (Optional)

**For long lists in modals:**
- AttachmentPicker with 100+ files
- FilterSheet with many filter options

**Approach:**
- Identify modals with potentially long lists
- Implement `react-window` or `@tanstack/react-virtual` if needed
- Only implement if actual performance issue exists (YAGNI)

## 3. Documentation Structure

**Goal:** Comprehensive, maintainable documentation

### 3.1 Documentation Organization

**Structure in `docs/modal-system/`:**
```
docs/modal-system/
├── README.md                    # Overview and quick start
├── architecture.md              # System design and principles
├── components/
│   ├── modal-header.md         # API reference
│   ├── modal-footer.md
│   ├── modal-section.md
│   ├── floating-actions.md
│   └── modal-drag-handle.md
├── patterns/
│   ├── responsive-dialogs.md   # Desktop dialog + mobile sheet pattern
│   ├── compact-modals.md       # Quick forms (75vh mobile)
│   ├── standard-modals.md      # Multi-step flows (85vh mobile)
│   └── immersive-modals.md     # Content viewers (90vh mobile)
├── guides/
│   ├── creating-new-modal.md   # Step-by-step guide
│   ├── accessibility.md        # WCAG compliance checklist
│   ├── testing.md              # Testing patterns and examples
│   └── migration.md            # Migrating old modals to new system
└── reference/
    ├── size-variants.md        # Compact/Standard/Immersive specs
    ├── keyboard-shortcuts.md   # All keyboard interactions
    └── examples.md             # Common use cases with code
```

### 3.2 Component API Documentation

**Each component doc includes:**
1. **Overview** - What it does, when to use it
2. **Props API** - Table with prop name, type, default, description
3. **Usage Examples** - Basic, with subtitle, without close button, etc.
4. **Accessibility** - ARIA attributes, keyboard support
5. **Related Components** - Links to related docs

**Example structure for modal-header.md:**
```markdown
# ModalHeader

Modal header component with title, optional subtitle, and close button.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | string | required | Main heading text |
| subtitle | string | undefined | Optional descriptive text |
| showClose | boolean | true | Show close button |
| onClose | () => void | undefined | Close handler |

## Examples

### Basic Usage
[code example]

### With Subtitle
[code example]

### Without Close Button
[code example]

## Accessibility
- Title uses semantic h2 heading
- Close button has aria-label
- Focus trap works correctly

## Related
- [ModalFooter](./modal-footer.md)
- [Responsive Dialog Pattern](../patterns/responsive-dialogs.md)
```

### 3.3 Pattern Documentation

**Responsive Dialog Pattern doc includes:**
- When to use this pattern
- Complete code example (reusable template)
- Mobile vs desktop behavior explained
- Common variations (with footer, without, with tabs, etc.)
- Testing approach
- Troubleshooting common issues

**Size variant docs (compact/standard/immersive):**
- Use cases and examples
- Visual comparison (describe dimensions)
- List of components using each size
- When to choose this size

### 3.4 Guides

**Creating New Modal guide:**
1. Choose size variant (compact/standard/immersive)
2. Copy template code
3. Implement form content
4. Add responsive behavior
5. Write tests
6. Add accessibility features
7. Document in this system

**Accessibility guide:**
- WCAG 2.1 AA compliance checklist
- Testing with screen readers
- Keyboard navigation requirements
- Color contrast verification
- Focus management patterns

**Testing guide:**
- Test structure template
- Mocking patterns (useMobile hook)
- Testing responsive behavior
- Testing keyboard interactions
- Coverage expectations

**Migration guide:**
- Identifying old modals to migrate
- Step-by-step migration process
- Before/after examples
- Common pitfalls
- Testing after migration

### 3.5 Reference Documentation

**Size Variants Reference:**
- Table with all three sizes
- Desktop specs (max-width, padding, height behavior)
- Mobile specs (vh height, rounded corners, padding)
- Animation specs
- When to use each

**Keyboard Shortcuts Reference:**
- Table of all keyboard interactions
- Which components support which shortcuts
- How to test keyboard navigation
- Customizing shortcuts (if supported)

**Examples Reference:**
- Quick capture dialog
- Multi-step wizard
- Content viewer
- Filter panel
- Form with validation
- Async loading states

## 4. Testing Strategy

### 4.1 Accessibility Testing

**Automated Testing:**
- Add `vitest-axe` or `jest-axe` for automated accessibility checks
- Run axe-core rules on all modal components
- Integrate into existing test suite
- Fail build if accessibility violations found

**Test structure:**
```tsx
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<ModalHeader title="Test" onClose={vi.fn()} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**Manual Testing Checklist:**
- [ ] Screen reader announces modal title on open
- [ ] Tab order is logical (header → content → footer)
- [ ] Focus returns to trigger after close
- [ ] Escape key closes modal
- [ ] Close button is keyboard accessible
- [ ] All form controls have labels
- [ ] Color contrast meets 4.5:1 minimum
- [ ] Touch targets meet 44×44px minimum

**Testing Tools:**
- NVDA (Windows) - Free screen reader
- VoiceOver (macOS/iOS) - Built-in screen reader
- WAVE browser extension - Visual accessibility checker
- axe DevTools extension - In-browser accessibility testing

### 4.2 Performance Testing

**Benchmark Tests:**
```tsx
describe('Modal Performance', () => {
  it('opens within 100ms', () => {
    const start = performance.now();
    render(<TaskCreateDialog open={true} ... />);
    const end = performance.now();
    expect(end - start).toBeLessThan(100);
  });
});
```

**Bundle Size Tracking:**
- Add bundle size snapshot tests
- Fail if bundle grows >5% without justification
- Document current sizes as baseline
- Track impact of lazy loading

**Lighthouse CI:**
- Run Lighthouse in CI pipeline (optional)
- Set thresholds: Performance >90, A11y >90
- Test on sample pages with modals
- Generate reports for each PR

### 4.3 Integration Testing

**Cross-component tests:**
- Modal opens from trigger, displays content, closes properly
- Form submission works through modal
- Multiple modals don't interfere with each other
- Mobile/desktop responsive behavior works

**Example:**
```tsx
it('creates task through modal workflow', async () => {
  const { user } = render(<TasksPage />);

  // Open modal
  await user.click(screen.getByText('New Task'));
  expect(screen.getByTestId('header')).toBeInTheDocument();

  // Fill form
  await user.type(screen.getByLabelText('What needs to be done?'), 'Test task');

  // Submit
  await user.click(screen.getByText('Create Task'));

  // Verify modal closed and task created
  expect(screen.queryByTestId('header')).not.toBeInTheDocument();
  expect(screen.getByText('Test task')).toBeInTheDocument();
});
```

### 4.4 Documentation Testing

**Ensure documentation stays current:**
- Code examples in docs are valid TypeScript
- All props documented match actual component props
- Links between docs are not broken
- Examples can be copy-pasted and work

**Approach:**
- Extract code blocks from markdown
- Compile them with TypeScript
- Run basic validation
- Update docs when APIs change

## 5. Implementation Plan

### 5.1 Task Organization

**Phase 4 broken into 3 parallel tracks:**

**Track 1: Accessibility (Priority: High)**
- Task 1.1: Add ARIA attributes to foundation components
- Task 1.2: Enhance keyboard navigation and focus management
- Task 1.3: Add automated accessibility tests (axe-core)
- Task 1.4: Manual screen reader testing and fixes
- Task 1.5: Color contrast audit and fixes
- Task 1.6: Touch target verification and fixes

**Track 2: Performance (Priority: Medium)**
- Task 2.1: Measure baseline bundle size and performance
- Task 2.2: Implement lazy loading wrapper component
- Task 2.3: Apply lazy loading to create dialogs
- Task 2.4: Animation performance audit and optimization
- Task 2.5: Run Lighthouse audit and document results
- Task 2.6: Bundle size comparison and report

**Track 3: Documentation (Priority: Medium)**
- Task 3.1: Create documentation structure
- Task 3.2: Write component API documentation (5 components)
- Task 3.3: Write pattern documentation (4 patterns)
- Task 3.4: Write guides (4 guides)
- Task 3.5: Write reference documentation (3 references)
- Task 3.6: Add examples and validate all code snippets

### 5.2 Task Dependencies

**Critical path:**
```
Start
  ├─> Track 1 (Accessibility) ─────────────────┐
  ├─> Track 2 (Performance) ──────────────────┤├─> Final Audit ─> Complete
  └─> Track 3 (Documentation) ────────────────┘
```

**Dependencies:**
- Task 1.3 depends on 1.1 (need components enhanced before testing)
- Task 1.4 depends on 1.1-1.3 (manual test after automated tests pass)
- Task 2.3 depends on 2.2 (need wrapper before applying)
- Task 2.5 depends on 2.1-2.4 (measure improvements)
- Task 3.2-3.6 can reference 1.x and 2.x work as it completes

**Parallelization:**
- Tracks 1, 2, 3 can run concurrently
- Within Track 1: Tasks 1.1-1.2 can be parallel, then 1.3-1.6 sequential
- Within Track 2: Task 2.1 first, then 2.2-2.4 parallel, then 2.5-2.6
- Within Track 3: All tasks can be parallel once structure (3.1) is done

### 5.3 Success Criteria

**Track 1 (Accessibility):**
- ✅ All automated axe-core tests pass (0 violations)
- ✅ Manual screen reader test checklist 100% complete
- ✅ All color contrasts meet 4.5:1 minimum
- ✅ All touch targets meet 44×44px minimum
- ✅ Keyboard navigation works in all modals
- ✅ Focus management works correctly (trap, return, visible indicators)

**Track 2 (Performance):**
- ✅ Bundle size reduced by 20-30% with lazy loading
- ✅ Modal open time <100ms
- ✅ Animations run at 60fps (no dropped frames)
- ✅ Lighthouse Performance score >90
- ✅ Lighthouse Accessibility score >90
- ✅ No performance regressions

**Track 3 (Documentation):**
- ✅ All 17 documentation files created
- ✅ Every component has complete API reference
- ✅ Every pattern has working code example
- ✅ All guides have step-by-step instructions
- ✅ All code examples are valid TypeScript
- ✅ Zero broken links between docs

### 5.4 Estimated Effort

**Track 1 (Accessibility): ~8-12 hours**
- 1.1: 2 hours (add ARIA attributes)
- 1.2: 2 hours (keyboard/focus management)
- 1.3: 2 hours (add axe-core tests)
- 1.4: 2-3 hours (manual testing with screen readers)
- 1.5: 1 hour (contrast audit)
- 1.6: 1 hour (touch targets)

**Track 2 (Performance): ~6-8 hours**
- 2.1: 1 hour (baseline measurements)
- 2.2: 2 hours (lazy loading wrapper)
- 2.3: 1 hour (apply to dialogs)
- 2.4: 1 hour (animation audit)
- 2.5: 1-2 hours (Lighthouse audit)
- 2.6: 1 hour (comparison report)

**Track 3 (Documentation): ~10-14 hours**
- 3.1: 1 hour (create structure)
- 3.2: 3 hours (5 component docs)
- 3.3: 2 hours (4 pattern docs)
- 3.4: 3 hours (4 guides)
- 3.5: 2 hours (3 reference docs)
- 3.6: 2 hours (examples and validation)

**Total: ~24-34 hours** (can be reduced with parallelization)

### 5.5 Risk Mitigation

**Risks:**
1. ARIA changes break existing behavior → Mitigation: Test thoroughly, add to test suite
2. Lazy loading breaks functionality → Mitigation: Feature flag, gradual rollout
3. Documentation becomes stale → Mitigation: Add to CI, review quarterly
4. Performance optimizations have no impact → Mitigation: Measure first, optimize targeted areas

**Rollback plan:**
- Each track is in separate commits
- Can revert individual tracks if issues found
- All changes are additive, not breaking

## 6. Deliverables

**Track 1 Deliverables:**
- Enhanced foundation components with ARIA attributes
- Keyboard navigation improvements
- Automated accessibility test suite
- Manual accessibility testing report
- Color contrast audit report
- Touch target verification report

**Track 2 Deliverables:**
- Baseline performance measurements
- LazyDialog wrapper component
- Lazy-loaded create dialogs
- Animation performance report
- Lighthouse audit report
- Bundle size comparison report

**Track 3 Deliverables:**
- Complete documentation structure (17 files)
- Component API documentation (5 components)
- Pattern documentation (4 patterns)
- Usage guides (4 guides)
- Reference documentation (3 references)
- Working code examples

## 7. Next Steps

1. **Review and approve this design**
2. **Set up git worktree for Phase 4 work**
3. **Create detailed implementation plan**
4. **Begin Track 1: Accessibility improvements**
5. **Run automated accessibility tests**
6. **Continue with Tracks 2 and 3 in parallel**
7. **Final audit and verification**
8. **Document Phase 4 completion**

---

**Design Status:** Complete and ready for implementation
