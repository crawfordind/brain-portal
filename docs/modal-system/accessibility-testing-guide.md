# Modal System Accessibility Testing Guide

**Purpose:** Manual testing checklist for screen readers and keyboard navigation

**Target:** WCAG 2.1 AA compliance

## Screen Reader Testing

### NVDA (Windows - Free)

**Setup:**
1. Download NVDA from https://www.nvaccess.org/download/
2. Install and restart
3. NVDA starts automatically, press NVDA+Q to quit

**Testing Steps:**

1. **Open Modal**
   - Expected: NVDA announces "Dialog, [Modal Title]"
   - Verify: Title is announced immediately

2. **Navigate Through Modal**
   - Press Tab to move forward
   - Press Shift+Tab to move backward
   - Expected: NVDA reads each element (buttons, form fields, etc.)
   - Verify: Tab order is logical (header → content → footer)

3. **Close Button**
   - Tab to close button
   - Expected: NVDA announces "Close dialog, button"
   - Press Enter or Space to activate
   - Expected: Modal closes, focus returns to trigger

4. **Form Controls**
   - Tab to input field
   - Expected: NVDA announces label + field type
   - Type content
   - Expected: NVDA reads characters as typed

5. **Section Headings**
   - Press H key to navigate by headings
   - Expected: NVDA announces "Heading level 2, [Section Title]"

**Pass Criteria:**
- ✅ Modal title announced on open
- ✅ All interactive elements reachable and announced
- ✅ Close button clearly identified
- ✅ Form labels associated with controls
- ✅ Tab order is logical
- ✅ Focus returns to trigger on close

### VoiceOver (macOS/iOS - Built-in)

**Setup:**
1. macOS: System Settings > Accessibility > VoiceOver > Enable
2. Or press Cmd+F5 to toggle
3. iOS: Settings > Accessibility > VoiceOver > On

**Testing Steps:**

1. **Open Modal**
   - Expected: VoiceOver announces "Dialog, [Modal Title]"
   - Verify: Title is announced immediately

2. **Navigate Through Modal**
   - Press Control+Option+Right Arrow to move forward
   - Press Control+Option+Left Arrow to move backward
   - Expected: VoiceOver reads each element clearly
   - Verify: Reads "button", "text field", "heading", etc.

3. **Rotor Navigation**
   - Press Control+Option+U to open Rotor
   - Use arrow keys to switch categories (Headings, Form Controls, Links)
   - Expected: All modal elements appear in appropriate categories

4. **Close Button**
   - Navigate to close button
   - Expected: VoiceOver announces "Close dialog, button"
   - Press Control+Option+Space to activate

**Pass Criteria:**
- ✅ Modal announced with correct role
- ✅ All content readable in order
- ✅ Rotor shows all interactive elements
- ✅ Buttons and controls clearly identified
- ✅ No unexpected navigation traps

## Keyboard Navigation Testing

**No screen reader required - visual testing**

### Test Cases

1. **Focus Trap**
   - Open modal
   - Press Tab repeatedly
   - Expected: Focus stays within modal, cycles through elements
   - Verify: Cannot Tab to background content

2. **Escape Key**
   - Open modal
   - Press Escape
   - Expected: Modal closes immediately
   - Verify: Focus returns to trigger element

3. **Focus Indicators**
   - Open modal
   - Press Tab through all elements
   - Expected: Clear visible focus ring on current element
   - Verify: Focus ring contrast meets 3:1 against background

4. **Enter/Space on Buttons**
   - Tab to any button
   - Press Enter or Space
   - Expected: Button activates
   - Verify: Works consistently for all buttons

5. **Form Submission**
   - Fill form in modal
   - Press Enter in text input
   - Expected: Form submits (or prevented if invalid)
   - Verify: Keyboard submission works

**Pass Criteria:**
- ✅ Focus trapped in modal
- ✅ Escape closes modal
- ✅ Focus returns after close
- ✅ All buttons keyboard-accessible
- ✅ Clear focus indicators throughout
- ✅ Enter submits forms appropriately

## Color Contrast Testing

### Tools
- **Chrome DevTools:** Inspect element > Accessibility tab > Contrast ratio
- **WebAIM Contrast Checker:** https://webaim.org/resources/contrastchecker/
- **axe DevTools Extension:** Browser extension with automated checks

### Test Cases

1. **Modal Title**
   - Measure: Title text vs modal background
   - Requirement: 4.5:1 minimum (WCAG AA)
   - Current: [Record actual ratio]

2. **Body Text**
   - Measure: Content text vs background
   - Requirement: 4.5:1 minimum
   - Current: [Record actual ratio]

3. **Placeholder Text**
   - Measure: Input placeholder vs input background
   - Requirement: 3:1 minimum
   - Current: [Record actual ratio]

4. **Focus Indicators**
   - Measure: Focus ring vs modal background
   - Requirement: 3:1 minimum
   - Current: [Record actual ratio]

5. **Button Text**
   - Measure: Primary button text vs button background
   - Requirement: 4.5:1 minimum
   - Current: [Record actual ratio]

**Pass Criteria:**
- ✅ All text meets 4.5:1 minimum
- ✅ Placeholders meet 3:1 minimum
- ✅ Focus indicators meet 3:1 minimum
- ✅ No contrast failures in any theme (light/dark)

## Touch Target Testing (Mobile)

### Tools
- Chrome DevTools > Device Mode (iPhone SE, Galaxy S20)
- Physical devices if available

### Test Cases

1. **Close Button**
   - Measure: Tap target size
   - Requirement: 44×44px minimum
   - Current: [Measure and record]

2. **Form Submit Button**
   - Measure: Button height and width
   - Requirement: 44×44px minimum (48×48px recommended)
   - Current: [Measure and record]

3. **Form Input Fields**
   - Measure: Touch target height
   - Requirement: 44px minimum height
   - Current: [Measure and record]

4. **Section Collapse Buttons**
   - Measure: Entire clickable area
   - Requirement: 44×44px minimum
   - Current: [Measure and record]

**Pass Criteria:**
- ✅ All buttons ≥44×44px
- ✅ All inputs ≥44px height
- ✅ Adequate spacing between targets (8px minimum)
- ✅ Easy to tap without accidental touches

## Test Results Template

**Date:** YYYY-MM-DD
**Tester:** [Name]
**Browser/OS:** [e.g., Chrome 120 / macOS 14.2]

### NVDA Results
- [ ] Modal title announced
- [ ] Tab order logical
- [ ] Close button accessible
- [ ] Form labels associated
- [ ] Focus returns on close

### VoiceOver Results
- [ ] Modal announced correctly
- [ ] Rotor navigation works
- [ ] All content readable
- [ ] No navigation traps

### Keyboard Navigation Results
- [ ] Focus trap works
- [ ] Escape closes modal
- [ ] Focus indicators visible
- [ ] All buttons keyboard-accessible

### Color Contrast Results
- [ ] Title: ___:1 (Pass/Fail)
- [ ] Body text: ___:1 (Pass/Fail)
- [ ] Placeholders: ___:1 (Pass/Fail)
- [ ] Focus indicators: ___:1 (Pass/Fail)

### Touch Targets Results
- [ ] Close button: ___×___px (Pass/Fail)
- [ ] Submit button: ___×___px (Pass/Fail)
- [ ] Input fields: ___px height (Pass/Fail)

### Issues Found
1. [Description of issue]
   - Component: [which component]
   - Severity: High/Medium/Low
   - Action: [what needs to be fixed]

### Overall Assessment
- [ ] **PASS** - Ready for production
- [ ] **CONDITIONAL PASS** - Minor issues to fix
- [ ] **FAIL** - Major issues blocking release

---

**Next Steps:**
1. Fix any failing tests
2. Re-test failed components
3. Document fixes in git commit messages
4. Update this guide with findings
