# Standard Modal Pattern

**Size:** max-w-2xl (672px desktop), 85vh mobile
**Use Case:** Multi-step flows, content browsing

## Overview

Standard modals provide more space for complex interactions like multi-step wizards, content selection, or forms with many fields. They accommodate scrolling content while maintaining good usability.

## Characteristics

- **Desktop:** 672px max width, centered
- **Mobile:** 85vh height, bottom sheet
- **Content:** 6-15 items or fields
- **Actions:** 2-3 primary actions
- **Scrolling:** Expected and handled well

## When to Use

**Good for:**
- ✅ Attachment/file pickers
- ✅ Filter panels with multiple groups
- ✅ Multi-step wizards
- ✅ Content browsing/selection
- ✅ Forms with 6+ fields

**Not good for:**
- ❌ Simple 1-3 field forms (use Compact)
- ❌ Full-screen media viewing (use Immersive)
- ❌ Very complex workflows (consider separate page)

## Pattern Template

```tsx
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';
import { ModalSection } from '@/components/modals/modal-section';

function StandardDialog({ open, onClose }) {
  const isMobile = useMobile();

  const content = (
    <>
      <ModalHeader
        title="Standard Dialog"
        subtitle="More complex interaction"
        onClose={onClose}
      />

      <div className="space-y-4 py-4">
        <ModalSection title="Section 1">
          {/* Content group 1 */}
        </ModalSection>

        <ModalSection title="Section 2">
          {/* Content group 2 */}
        </ModalSection>

        <ModalSection title="Advanced" collapsible defaultOpen={false}>
          {/* Optional advanced content */}
        </ModalSection>
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>
          Apply
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[85vh]">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Real Example: Filter Sheet

```tsx
function FilterSheet({ open, onClose, filters, onApply }) {
  const isMobile = useMobile();
  const [localFilters, setLocalFilters] = useState(filters);

  const content = (
    <>
      <ModalHeader
        title="Filter & Sort"
        subtitle="Customize your view"
        onClose={onClose}
      />

      <div className="space-y-4 py-4 overflow-y-auto flex-1">
        <ModalSection title="Status">
          <div className="space-y-2">
            <Checkbox
              label="Active"
              checked={localFilters.status.includes('active')}
              onChange={(checked) => toggleFilter('status', 'active', checked)}
            />
            <Checkbox
              label="Completed"
              checked={localFilters.status.includes('completed')}
              onChange={(checked) => toggleFilter('status', 'completed', checked)}
            />
            <Checkbox
              label="Archived"
              checked={localFilters.status.includes('archived')}
              onChange={(checked) => toggleFilter('status', 'archived', checked)}
            />
          </div>
        </ModalSection>

        <ModalSection title="Priority">
          <div className="space-y-2">
            <Checkbox label="High" />
            <Checkbox label="Medium" />
            <Checkbox label="Low" />
          </div>
        </ModalSection>

        <ModalSection title="Tags">
          {/* Tag selection */}
        </ModalSection>

        <ModalSection title="Sort By" collapsible defaultOpen={false}>
          {/* Sort options */}
        </ModalSection>
      </div>

      <div className="flex gap-2 justify-between pt-4 border-t">
        <Button variant="outline" onClick={handleReset}>
          Reset
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(localFilters)}>
            Apply Filters
          </Button>
        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[85vh] flex flex-col">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Real Example: Attachment Picker

```tsx
function AttachmentPicker({ open, onClose, onSelect }) {
  const isMobile = useMobile();
  const [selected, setSelected] = useState([]);

  const content = (
    <>
      <ModalHeader
        title="Attach Files"
        subtitle={`${selected.length} selected`}
        onClose={onClose}
      />

      <div className="py-4 overflow-y-auto flex-1">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {attachments.map(attachment => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              selected={selected.includes(attachment.id)}
              onToggle={() => toggleSelection(attachment.id)}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => onSelect(selected)}
          disabled={selected.length === 0}
        >
          Attach {selected.length > 0 && `(${selected.length})`}
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[85vh] flex flex-col">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Design Guidelines

### Content Organization
Use ModalSection to group related content:
- Status filters together
- Priority filters together
- Advanced options collapsible

### Scrolling
- Set `overflow-y-auto` on content container
- Use `flex-1` to allow content to grow
- Header and footer remain fixed

### Mobile Layout
- 85vh provides good balance
- Enough content visible
- Room for keyboard when needed

## Best Practices

**Do:**
- ✅ Use ModalSection for organization
- ✅ Make advanced sections collapsible
- ✅ Show count/state in subtitle
- ✅ Include Reset option for filters

**Don't:**
- ❌ Don't exceed ~15-20 items
- ❌ Don't nest sections deeply
- ❌ Don't forget scrolling indicators
- ❌ Don't hide critical actions

## Performance

### Virtualization
For very long lists, consider virtualization:

```tsx
import { VirtualList } from '@/components/ui/virtual-list';

<div className="h-96 overflow-y-auto">
  <VirtualList
    items={items}
    itemHeight={60}
    renderItem={(item) => <ItemCard item={item} />}
  />
</div>
```

## Accessibility

- Collapsible sections announce expanded state
- Scroll container has proper focus management
- Selected count announced to screen readers
- All sections have clear headings

## Examples in Codebase

**Production Examples:**
- `src/components/attachments/attachment-picker.tsx` - Grid selection
- `src/components/filters/filter-sheet.tsx` - Multi-section filters

---

**Next:** [Immersive Modals](./immersive-modals.md)
