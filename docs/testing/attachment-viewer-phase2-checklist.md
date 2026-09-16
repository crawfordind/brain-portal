# Attachment Viewer Phase 2 - Manual Testing Checklist

## Overview
This checklist covers comprehensive manual testing for the redesigned attachment viewer with responsive mobile-first design (Phase 2).

**Test Date:** _________________
**Tester:** _________________
**Build/Commit:** _________________

---

## Desktop Testing (≥768px)

### Layout & Structure
- [ ] Dialog opens in center of screen with overlay
- [ ] Dialog has max width of 1200px
- [ ] Header is positioned at top with close button
- [ ] Preview section and metadata section displayed side-by-side (2-column grid)
- [ ] Preview section takes 2/3 width, metadata takes 1/3 width
- [ ] Footer actions are right-aligned (Download, Open, Delete)
- [ ] No drag handle visible on desktop

### Header
- [ ] Displays file icon based on file type
- [ ] Shows filename as title
- [ ] Shows file size and MIME type in subtitle
- [ ] Close button (X) is visible and positioned correctly
- [ ] Close button closes dialog on click

### Preview Section
- [ ] Image files display with object-contain scaling
- [ ] Image has max height of 600px
- [ ] PDF files show document icon with filename
- [ ] Audio files show audio icon with filename
- [ ] Video files show video icon with filename
- [ ] Document files show document icon with filename
- [ ] Other files show file icon with filename
- [ ] Error state shows fallback UI if image fails to load

### Metadata Section
- [ ] All sections are expanded by default (not collapsible)
- [ ] "Details" section shows file type, file size, MIME type
- [ ] "Dates" section shows created date and time
- [ ] Modified date shown when different from created date
- [ ] "Project" section displays linked project name
- [ ] "Project" section hidden when no project linked
- [ ] "Description" section displays description text
- [ ] "Description" section hidden when no description
- [ ] "Tags" section displays tags as pills
- [ ] "Tags" section hidden when no tags
- [ ] "Extracted Text" section displays extracted text
- [ ] "Extracted Text" section hidden when no text extracted
- [ ] All text wraps properly without overflow

### Footer Actions
- [ ] Download button has correct download link
- [ ] Download button triggers file download on click
- [ ] Open button opens file in new tab
- [ ] Delete button is visible when onDelete prop provided
- [ ] Delete button hidden when no onDelete prop
- [ ] Delete button calls onDelete handler and closes dialog
- [ ] All buttons have correct icons and labels

### Processing States
- [ ] "pending" status shows processing indicator
- [ ] "processing" status shows processing indicator
- [ ] "completed" status shows full content
- [ ] "failed" status shows error message
- [ ] Processing error displays error text

---

## Mobile Testing (<768px)

### Layout & Structure
- [ ] Bottom sheet opens from bottom of screen
- [ ] Bottom sheet has rounded top corners (16px radius)
- [ ] Sheet takes full width with 16px horizontal padding
- [ ] Maximum height is 90vh
- [ ] Drag handle visible at top center
- [ ] Content uses stacked vertical layout (preview → actions → metadata)
- [ ] All content is scrollable when exceeding viewport height

### Drag Handle
- [ ] Drag handle rendered at top of sheet
- [ ] Handle is centered horizontally
- [ ] Handle has proper visual styling (gray bar, 40px wide, 4px tall)
- [ ] Handle has 8px top margin

### Header
- [ ] Header displays file icon and filename
- [ ] Subtitle shows file size and MIME type
- [ ] Close button (X) closes the bottom sheet
- [ ] Header text truncates with ellipsis if too long

### Preview Section
- [ ] Preview displayed at top of stacked layout
- [ ] Image preview scales to container width
- [ ] Image maintains aspect ratio with object-contain
- [ ] Max height is 400px on mobile
- [ ] Non-image files show appropriate icon and filename
- [ ] Preview section has proper spacing

### Floating Actions
- [ ] Actions float as sticky bar at bottom of sheet
- [ ] Actions bar has white background
- [ ] Actions bar has top border
- [ ] Action buttons displayed horizontally with even spacing
- [ ] Download action has download icon and label
- [ ] Open action has external link icon and label
- [ ] Delete action has trash icon and label
- [ ] Delete action hidden when onDelete not provided
- [ ] All actions centered and accessible with finger tap
- [ ] Actions remain visible when scrolling content

### Metadata Sections (Collapsible)
- [ ] All metadata sections are collapsible on mobile
- [ ] Sections start collapsed by default (can be configured)
- [ ] Tapping section header expands/collapses content
- [ ] Chevron icon rotates when expanding/collapsing
- [ ] "Details" section shows file type, size, MIME type when expanded
- [ ] "Dates" section shows created/modified dates when expanded
- [ ] "Project" section shows linked project when expanded
- [ ] "Description" section shows description when expanded
- [ ] "Tags" section shows tag pills when expanded
- [ ] "Extracted Text" section shows text when expanded
- [ ] Sections with no content are hidden completely
- [ ] Smooth expand/collapse animation

### Scrolling Behavior
- [ ] Content scrolls smoothly within bottom sheet
- [ ] Scroll area excludes floating action bar
- [ ] Over-scroll has proper behavior (bounce on iOS)
- [ ] No body scroll when sheet is open
- [ ] Floating actions remain fixed at bottom during scroll

---

## Responsive Testing (Breakpoint Transitions)

### Desktop to Mobile (Resize from >768px to <768px)
- [ ] Layout switches from dialog to bottom sheet
- [ ] 2-column grid changes to stacked layout
- [ ] Footer actions move to floating bar
- [ ] Metadata sections become collapsible
- [ ] Drag handle appears
- [ ] Transition is smooth without visual glitches

### Mobile to Desktop (Resize from <768px to >768px)
- [ ] Bottom sheet switches to dialog
- [ ] Stacked layout changes to 2-column grid
- [ ] Floating actions move to footer
- [ ] Metadata sections become expanded
- [ ] Drag handle disappears
- [ ] Transition is smooth without visual glitches

### Tablet Range (768px - 1024px)
- [ ] Uses desktop dialog layout
- [ ] Grid columns adjust appropriately
- [ ] Touch targets are accessible
- [ ] All functionality works correctly

---

## Device-Specific Testing

### iPhone (Safari)
**Device Model:** _________________
- [ ] Bottom sheet renders correctly
- [ ] Safe area insets respected (notch/home indicator)
- [ ] Drag handle accessible
- [ ] Floating actions at correct position
- [ ] Scrolling is smooth
- [ ] Actions trigger correctly
- [ ] No layout issues with viewport units
- [ ] Image previews load and scale correctly

### Android (Chrome)
**Device Model:** _________________
- [ ] Bottom sheet renders correctly
- [ ] Safe area handled properly
- [ ] Drag handle accessible
- [ ] Floating actions at correct position
- [ ] Scrolling is smooth
- [ ] Actions trigger correctly
- [ ] No layout issues
- [ ] Image previews load and scale correctly

### iPad (Safari)
**Device Model:** _________________
- [ ] Uses desktop layout (dialog)
- [ ] Touch targets are accessible
- [ ] Grid layout renders correctly
- [ ] All interactions work with touch
- [ ] No responsive issues

### Desktop - Chrome
**OS/Version:** _________________
- [ ] Dialog centered and sized correctly
- [ ] All interactions work with mouse
- [ ] Hover states work correctly
- [ ] Keyboard navigation works (Tab, Enter, Esc)
- [ ] Close on Escape key press

### Desktop - Firefox
**OS/Version:** _________________
- [ ] Dialog centered and sized correctly
- [ ] All interactions work
- [ ] Styling renders correctly
- [ ] No browser-specific issues

### Desktop - Safari
**OS/Version:** _________________
- [ ] Dialog centered and sized correctly
- [ ] All interactions work
- [ ] Styling renders correctly
- [ ] No browser-specific issues

---

## File Type Testing

### Images
- [ ] JPEG displays correctly
- [ ] PNG displays correctly
- [ ] GIF displays correctly (animated if applicable)
- [ ] WebP displays correctly
- [ ] SVG displays correctly
- [ ] Large images (>5MB) load and scale properly
- [ ] Small images scale up without pixelation
- [ ] Aspect ratio maintained for all orientations (portrait/landscape)

### PDFs
- [ ] Shows document icon
- [ ] Displays filename
- [ ] Open in new tab works
- [ ] Download works

### Audio
- [ ] Shows audio icon
- [ ] Displays filename and metadata
- [ ] File actions work correctly

### Video
- [ ] Shows video icon
- [ ] Displays filename and metadata
- [ ] File actions work correctly

### Documents
- [ ] Shows document icon
- [ ] Displays filename
- [ ] File actions work correctly

### Other
- [ ] Shows generic file icon
- [ ] Displays filename
- [ ] File actions work correctly

---

## Error States

### Image Load Error
- [ ] Failed image shows fallback icon/message
- [ ] Error state is visually clear
- [ ] Other functionality still works (download, delete)
- [ ] No console errors

### Processing States
- [ ] "pending" shows loading indicator
- [ ] "processing" shows progress message
- [ ] "failed" shows error message with details
- [ ] Processing error doesn't break layout

### Network Errors
- [ ] Handles missing storage_url gracefully
- [ ] Shows appropriate error message
- [ ] Retry mechanism (if applicable)

### Missing Data
- [ ] Missing description hides section
- [ ] Missing tags hides section
- [ ] Missing project hides section
- [ ] Missing extracted text hides section
- [ ] No empty sections displayed

---

## Accessibility Testing

### Keyboard Navigation
- [ ] Can open dialog/sheet with keyboard
- [ ] Tab cycles through interactive elements in correct order
- [ ] Enter activates buttons
- [ ] Escape closes dialog/sheet
- [ ] Focus visible on all interactive elements
- [ ] No keyboard traps

### Screen Reader (NVDA/VoiceOver/TalkBack)
**Tool Used:** _________________
- [ ] Dialog/sheet announced when opened
- [ ] Header content announced (title, subtitle)
- [ ] All buttons have clear labels
- [ ] Section headings announced
- [ ] Collapsible sections state announced (expanded/collapsed)
- [ ] File content described appropriately
- [ ] Close action announced
- [ ] Navigation order is logical

### Visual
- [ ] Text has sufficient contrast (WCAG AA)
- [ ] Interactive elements are clearly identifiable
- [ ] Focus indicators are visible
- [ ] No reliance on color alone for information
- [ ] Text scales properly with browser zoom (200%)

### Touch Targets
- [ ] All buttons are at least 44x44px
- [ ] Sufficient spacing between touch targets
- [ ] Drag handle is large enough to grab
- [ ] Collapsible section headers easy to tap

---

## Performance Testing

### Load Time
- [ ] Dialog/sheet opens quickly (<100ms)
- [ ] Image preview loads progressively
- [ ] Large images don't block UI
- [ ] No visible lag when opening

### Memory
**Tool:** Chrome DevTools Performance
- [ ] No memory leaks when opening/closing repeatedly
- [ ] Image memory released when closed
- [ ] No excessive re-renders
- [ ] Check Task Manager for memory usage

### Smooth Animations
- [ ] Bottom sheet slide-in is smooth (60fps)
- [ ] Collapsible sections expand/collapse smoothly
- [ ] No jank during scrolling
- [ ] Transitions feel responsive

### Large Files
- [ ] 10MB+ images load without crashing
- [ ] UI remains responsive during load
- [ ] Progress indication for slow loads
- [ ] Timeout handling for failed loads

---

## Regression Testing

### Existing Functionality
- [ ] Attachment list still displays correctly
- [ ] Clicking attachment opens viewer
- [ ] Creating new attachments works
- [ ] Deleting attachments works
- [ ] Editing attachment description works
- [ ] Adding/removing tags works
- [ ] Linking to projects works
- [ ] Search/filter attachments works

### Other Pages
- [ ] Notes page unaffected
- [ ] Projects page unaffected
- [ ] Tasks page unaffected
- [ ] Daily notes unaffected
- [ ] Navigation works correctly
- [ ] No styling conflicts

### API Integration
- [ ] GET /api/attachments/[id] works
- [ ] PATCH /api/attachments/[id] works
- [ ] DELETE /api/attachments/[id] works
- [ ] No breaking changes to API responses

---

## Edge Cases

### Content Edge Cases
- [ ] Very long filename (>100 characters) wraps correctly
- [ ] Very long description doesn't break layout
- [ ] Many tags (>20) display properly
- [ ] Extracted text with >10,000 characters scrolls
- [ ] Unicode characters display correctly
- [ ] Special characters in filename handled
- [ ] Empty string values handled gracefully

### UI Edge Cases
- [ ] Multiple dialogs/sheets don't stack incorrectly
- [ ] Rapid open/close doesn't break state
- [ ] Opening while previous closing animation in progress
- [ ] Screen rotation (mobile) handles gracefully
- [ ] Browser back button doesn't break state
- [ ] Multiple browser tabs don't conflict

### Responsive Edge Cases
- [ ] Exactly 768px width renders correctly
- [ ] Very narrow mobile (<320px) still usable
- [ ] Very wide desktop (>2560px) centers properly
- [ ] Zoom levels 50%-200% work correctly

---

## Security Testing

### File Access
- [ ] Cannot access attachments from other users
- [ ] Authentication required for viewing
- [ ] Download links are secure
- [ ] No CORS issues with storage URLs

### XSS Prevention
- [ ] User-provided description doesn't execute scripts
- [ ] Filename sanitized properly
- [ ] Tag content sanitized
- [ ] Metadata doesn't introduce vulnerabilities

---

## Final Sign-Off

### Pre-Production Checklist
- [ ] All critical tests passed
- [ ] All high-priority bugs fixed
- [ ] Accessibility requirements met (WCAG AA)
- [ ] Performance benchmarks met
- [ ] Cross-browser testing complete
- [ ] Mobile device testing complete
- [ ] Documentation updated
- [ ] Unit tests passing (85/85)
- [ ] TypeScript compilation passing
- [ ] Build succeeds

### Known Issues
List any known issues that are acceptable for release:

1. _________________
2. _________________
3. _________________

### Approval
- [ ] **Dev Lead:** _________________ Date: _________
- [ ] **QA Lead:** _________________ Date: _________
- [ ] **Product Owner:** _________________ Date: _________

---

## Notes
Add any additional notes, observations, or issues discovered during testing:

_________________________________________________________________________________
_________________________________________________________________________________
_________________________________________________________________________________
