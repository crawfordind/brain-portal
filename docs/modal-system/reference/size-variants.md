# Size Variants Reference

**Purpose:** Complete specifications for all modal sizes
**Audience:** Developers choosing modal sizes

## Overview

The modal system provides three size variants optimized for different use cases:

1. **Compact** - Quick forms and simple interactions
2. **Standard** - Multi-step flows and content browsing
3. **Immersive** - Media viewing and rich content

## Compact Variant

### Specifications

**Desktop:**
- Max width: 448px (`max-w-md`)
- Position: Centered on screen
- Padding: 24px (`p-6`)
- Border radius: 8px (`rounded-lg`)

**Mobile:**
- Height: 75vh (`h-[75vh]`)
- Width: Full width minus safe areas
- Position: Bottom of screen
- Border radius: 16px top corners (`rounded-t-2xl`)

### Use Cases

✅ **Good for:**
- Create task/project/capture forms
- Quick data entry (3-5 fields)
- Simple confirmations
- Short message displays
- Single-field inputs

❌ **Not good for:**
- Forms with >5 fields
- Multi-step wizards
- Content browsing
- Media viewing

### Code Example

```tsx
const isMobile = useMobile();

if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="h-[75vh]">
        <ModalHeader title="Quick Form" onClose={onClose} />
        {/* Content */}
      </SheetContent>
    </Sheet>
  );
}

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="compact">
      <ModalHeader title="Quick Form" onClose={onClose} />
      {/* Content */}
    </DialogContent>
  </Dialog>
);
```

### Design Considerations

**Content Capacity:**
- Title + subtitle
- 3-5 form fields
- 2-3 action buttons
- Minimal scrolling (ideally none)

**Mobile Keyboard:**
- 75vh leaves 25vh for keyboard
- Form fields remain visible when typing
- Submit button accessible above keyboard

### Examples in Codebase

- `src/components/tasks/task-create-dialog.tsx`
- `src/components/projects/project-create-dialog.tsx`
- `src/components/captures/capture-create-dialog.tsx`
- `src/components/ui/quick-capture-dialog.tsx`

---

## Standard Variant

### Specifications

**Desktop:**
- Max width: 672px (`max-w-2xl`)
- Position: Centered on screen
- Padding: 24px (`p-6`)
- Border radius: 8px (`rounded-lg`)

**Mobile:**
- Height: 85vh (`h-[85vh]`)
- Width: Full width minus safe areas
- Position: Bottom of screen
- Border radius: 16px top corners (`rounded-t-2xl`)

### Use Cases

✅ **Good for:**
- Multi-step wizards
- File/attachment pickers
- Filter panels with multiple sections
- Content browsing and selection
- Forms with 6-15 fields
- Lists with moderate item count

❌ **Not good for:**
- Simple 1-3 field forms (use Compact)
- Full-screen media viewing (use Immersive)
- Very long lists (consider pagination)

### Code Example

```tsx
const isMobile = useMobile();

if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="h-[85vh] flex flex-col">
        <ModalHeader title="Browse Content" onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          {/* Scrollable content */}
        </div>
      </SheetContent>
    </Sheet>
  );
}

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="standard">
      <ModalHeader title="Browse Content" onClose={onClose} />
      <div className="overflow-y-auto">
        {/* Scrollable content */}
      </div>
    </DialogContent>
  </Dialog>
);
```

### Design Considerations

**Content Capacity:**
- Title + subtitle
- Multiple sections (use ModalSection)
- 6-15 items or fields
- Expected scrolling (design for it)
- 2-3 action buttons

**Scrolling:**
- Set `overflow-y-auto` on content container
- Header and footer remain fixed
- Use `flex-1` for content area to fill space
- Show scroll indicators when needed

**Organization:**
- Use ModalSection to group related content
- Collapsible sections for advanced options
- Clear visual hierarchy

### Examples in Codebase

- `src/components/attachments/attachment-picker.tsx`
- `src/components/filters/filter-sheet.tsx`

---

## Immersive Variant

### Specifications

**Desktop:**
- Max width: 1280px (`max-w-7xl`)
- Position: Centered on screen
- Padding: Custom (often 0 for edge-to-edge content)
- Border radius: 8px (`rounded-lg`)
- Max height: 90vh

**Mobile:**
- Height: 90vh (`h-[90vh]`)
- Width: Full width
- Position: Bottom of screen
- Border radius: 16px top corners (`rounded-t-2xl`)
- Padding: 0 for edge-to-edge content

### Use Cases

✅ **Good for:**
- Image/video viewers
- PDF viewers
- Photo galleries
- Rich media content
- Full-page previews
- Content consumption experiences

❌ **Not good for:**
- Forms or data entry (use Compact/Standard)
- Multi-step wizards (use Standard)
- Quick interactions (use Compact)

### Code Example

```tsx
const isMobile = useMobile();

if (isMobile) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="h-[90vh] p-0">
        <ModalDragHandle />
        <div className="h-full flex flex-col">
          <div className="px-4 pt-2">
            <ModalHeader title="Image Viewer" onClose={onClose} />
          </div>
          <div className="flex-1 overflow-y-auto">
            <img src={imageUrl} alt="Preview" className="w-full" />
          </div>
          <FloatingActions
            actions={[
              { label: 'Share', onClick: handleShare, variant: 'secondary' },
              { label: 'Download', onClick: handleDownload, variant: 'primary' }
            ]}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

return (
  <Dialog open={open} onOpenChange={onClose}>
    <DialogContent size="immersive" className="max-h-[90vh] p-0">
      <div className="p-6 border-b">
        <ModalHeader title="Image Viewer" onClose={onClose} />
      </div>
      <div className="overflow-y-auto max-h-[70vh] p-6">
        <img src={imageUrl} alt="Preview" className="max-w-full h-auto mx-auto" />
      </div>
      <div className="p-6 border-t flex gap-2 justify-end">
        <Button onClick={handleDownload}>Download</Button>
      </div>
    </DialogContent>
  </Dialog>
);
```

### Design Considerations

**Content Capacity:**
- Full-screen-like experience
- Edge-to-edge media content
- Minimal chrome (header, actions only)
- Maximum content visibility

**Layout:**
- Use `p-0` on DialogContent/SheetContent
- Add padding selectively to header/footer
- Let media be edge-to-edge
- Center media on desktop

**Mobile Optimizations:**
- ModalDragHandle for visual affordance
- FloatingActions for always-accessible controls
- 90vh provides near-fullscreen experience
- Safe area padding on actions

### Examples in Codebase

- `src/components/attachments/attachment-viewer.tsx`
- `src/components/attachments/attachment-bottom-sheet.tsx`

---

## Size Comparison

| Aspect | Compact | Standard | Immersive |
|--------|---------|----------|-----------|
| **Desktop Width** | 448px | 672px | 1280px |
| **Mobile Height** | 75vh | 85vh | 90vh |
| **Typical Fields** | 3-5 | 6-15 | N/A (content) |
| **Scrolling** | Minimal | Expected | Expected |
| **Use Case** | Forms | Browsing | Viewing |
| **Load Time** | Instant | Quick | Varies |

## Choosing the Right Size

### Decision Tree

```
Is it a form?
├─ Yes
│  └─ How many fields?
│     ├─ 1-5 fields → Compact
│     └─ 6+ fields → Standard
└─ No
   └─ What's the primary purpose?
      ├─ Content viewing/media → Immersive
      ├─ Browsing/selection → Standard
      └─ Quick interaction → Compact
```

### Examples by Use Case

**Compact:**
- Create task
- Quick capture
- Add tag
- Simple confirmation
- Change password (3 fields)

**Standard:**
- Attachment picker
- Filter panel
- Settings dialog
- Multi-step wizard
- Advanced search

**Immersive:**
- Image viewer
- Video player
- PDF viewer
- Photo gallery
- Document preview

## Responsive Breakpoint

All size variants use the same mobile breakpoint:

```tsx
const isMobile = useMobile(); // Returns true when < 768px
```

**Breakpoint:** 768px (`md` in Tailwind)
- Below 768px: Sheet (bottom drawer)
- Above 768px: Dialog (centered)

## Performance Considerations

### Compact
- **Bundle size:** ~3-4KB
- **Load time:** <50ms
- **Render time:** <16ms
- **Perfect for:** Lazy loading

### Standard
- **Bundle size:** ~5-8KB (with content)
- **Load time:** <100ms
- **Render time:** <16ms
- **Good for:** Lazy loading

### Immersive
- **Bundle size:** ~6-10KB + media
- **Load time:** Varies (media-dependent)
- **Render time:** <16ms
- **Essential:** Lazy loading

## Accessibility Notes

All sizes meet WCAG 2.1 AA when using:
- ModalHeader (ARIA attributes)
- Proper form labels
- Focus trap (automatic)
- Keyboard navigation (automatic)

**Mobile touch targets:**
- Compact: 44px minimum
- Standard: 44px minimum
- Immersive: 48px recommended (larger screen, easier taps)

---

**See Also:**
- [Responsive Dialog Pattern](../patterns/responsive-dialogs.md)
- [Compact Modal Pattern](../patterns/compact-modals.md)
- [Standard Modal Pattern](../patterns/standard-modals.md)
- [Immersive Modal Pattern](../patterns/immersive-modals.md)
