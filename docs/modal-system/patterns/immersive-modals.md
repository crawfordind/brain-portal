# Immersive Modal Pattern

**Size:** max-w-7xl (1280px desktop), 90vh mobile
**Use Case:** Content viewing, rich media

## Overview

Immersive modals provide a full-screen-like experience for viewing content, images, videos, or other rich media. They maximize screen real estate while maintaining modal context.

## Characteristics

- **Desktop:** 1280px max width, centered
- **Mobile:** 90vh height, full-width bottom sheet
- **Content:** Large images, videos, galleries
- **Actions:** FloatingActions on mobile
- **Focus:** Content consumption over editing

## When to Use

**Good for:**
- ✅ Image/video viewers
- ✅ PDF viewers
- ✅ Gallery browsing
- ✅ Rich media content
- ✅ Full-page previews

**Not good for:**
- ❌ Forms or data entry (use Compact/Standard)
- ❌ Multi-step wizards (use Standard)
- ❌ Quick interactions (use Compact)

## Pattern Template

```tsx
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { FloatingActions } from '@/components/modals/floating-actions';
import { ModalDragHandle } from '@/components/modals/modal-drag-handle';

function ImmersiveDialog({ open, onClose }) {
  const isMobile = useMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[90vh] p-0">
          <ModalDragHandle />
          <div className="h-full flex flex-col">
            <div className="px-4 pt-2">
              <ModalHeader
                title="Content Title"
                onClose={onClose}
              />
            </div>
            <div className="flex-1 overflow-y-auto px-4">
              {/* Main content */}
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
      <DialogContent size="immersive" className="p-0">
        <div className="p-6">
          <ModalHeader
            title="Content Title"
            onClose={onClose}
          />
        </div>
        <div className="px-6 pb-6">
          {/* Main content */}
        </div>
        <div className="px-6 pb-6 flex gap-2 justify-end border-t pt-4">
          <Button variant="outline" onClick={handleShare}>
            Share
          </Button>
          <Button onClick={handleDownload}>
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## Real Example: Attachment Viewer

```tsx
function AttachmentViewer({ open, onClose, attachment }) {
  const isMobile = useMobile();

  const handleDownload = async () => {
    // Download logic
  };

  const handleShare = async () => {
    // Share logic
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[90vh] p-0">
          <ModalDragHandle />

          <div className="h-full flex flex-col">
            {/* Header with metadata */}
            <div className="px-4 pt-2 pb-4 border-b">
              <ModalHeader
                title={attachment.filename}
                subtitle={`${attachment.size} • ${attachment.type}`}
                onClose={onClose}
              />
            </div>

            {/* Content area - scrollable */}
            <div className="flex-1 overflow-y-auto">
              {attachment.type.startsWith('image/') && (
                <img
                  src={attachment.url}
                  alt={attachment.filename}
                  className="w-full h-auto"
                />
              )}

              {attachment.type === 'application/pdf' && (
                <iframe
                  src={attachment.url}
                  className="w-full h-full"
                  title={attachment.filename}
                />
              )}

              {attachment.type.startsWith('video/') && (
                <video
                  src={attachment.url}
                  controls
                  className="w-full h-auto"
                />
              )}
            </div>

            {/* Floating actions */}
            <FloatingActions
              actions={[
                {
                  label: 'Share',
                  onClick: handleShare,
                  variant: 'secondary'
                },
                {
                  label: 'Download',
                  onClick: handleDownload,
                  variant: 'primary'
                }
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
          <ModalHeader
            title={attachment.filename}
            subtitle={`${attachment.size} • ${attachment.type}`}
            onClose={onClose}
          />
        </div>

        <div className="overflow-y-auto max-h-[70vh] p-6">
          {attachment.type.startsWith('image/') && (
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-w-full h-auto mx-auto"
            />
          )}

          {attachment.type === 'application/pdf' && (
            <iframe
              src={attachment.url}
              className="w-full h-[70vh]"
              title={attachment.filename}
            />
          )}

          {attachment.type.startsWith('video/') && (
            <video
              src={attachment.url}
              controls
              className="max-w-full h-auto mx-auto"
            />
          )}
        </div>

        <div className="p-6 border-t flex gap-2 justify-end">
          <Button variant="outline" onClick={handleShare}>
            Share
          </Button>
          <Button onClick={handleDownload}>
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## Design Guidelines

### Layout
- **Desktop:** Content centered, max-width constrained
- **Mobile:** Full width, 90vh height, edge-to-edge content

### Padding
- Use `p-0` on DialogContent/SheetContent
- Add padding selectively to header and footer
- Let content be edge-to-edge when appropriate

### Actions
- **Desktop:** Traditional footer buttons
- **Mobile:** FloatingActions for thumb-friendly access

## Mobile Optimizations

### 90vh Height
- Maximum screen coverage
- Minimal context (10vh) shows it's a modal
- Still dismissible

### ModalDragHandle
- Visual affordance for swipe-to-dismiss (future)
- Indicates draggable sheet

### FloatingActions
- Always accessible while scrolling
- Thumb-zone optimized
- Safe area padding

## Media Handling

### Images
```tsx
<img
  src={url}
  alt={filename}
  className="max-w-full h-auto mx-auto" // Desktop: centered
  className="w-full h-auto" // Mobile: full width
/>
```

### Videos
```tsx
<video
  src={url}
  controls
  className="max-w-full h-auto mx-auto"
/>
```

### PDFs
```tsx
<iframe
  src={url}
  className="w-full h-[70vh]"
  title={filename}
/>
```

## Best Practices

**Do:**
- ✅ Use edge-to-edge content on mobile
- ✅ Provide download/share actions
- ✅ Show file metadata in subtitle
- ✅ Use appropriate media containers

**Don't:**
- ❌ Don't add unnecessary padding around media
- ❌ Don't forget mobile-optimized actions
- ❌ Don't skip ModalDragHandle on mobile
- ❌ Don't make media too small on desktop

## Accessibility

### Screen Readers
- Image alt text must be descriptive
- Video/audio must have captions when possible
- PDF must be accessible or provide alternative

### Keyboard
- Media controls keyboard accessible
- Tab navigates through header → media → actions
- Escape closes modal

### Focus Management
- Focus moves to close button on open
- Focus returns to trigger on close

## Performance

### Lazy Loading
Perfect candidate for lazy loading:

```tsx
<LazyDialog
  open={isViewerOpen}
  onClose={() => setIsViewerOpen(false)}
  loader={() => import('./attachment-viewer').then(m => ({
    default: m.AttachmentViewer
  }))}
  attachment={currentAttachment}
/>
```

### Image Optimization
```tsx
<img
  src={attachment.url}
  alt={attachment.filename}
  loading="lazy"
  decoding="async"
/>
```

## Examples in Codebase

**Production Examples:**
- `src/components/attachments/attachment-viewer.tsx` - Image/video viewer
- `src/components/attachments/attachment-bottom-sheet.tsx` - Mobile optimized

---

**Next:** [Creating New Modal Guide](../guides/creating-new-modal.md)
