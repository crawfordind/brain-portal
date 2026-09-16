# Compact Modal Pattern

**Size:** max-w-md (448px desktop), 75vh mobile
**Use Case:** Quick forms, simple interactions

## Overview

Compact modals are designed for focused, single-purpose interactions like creating tasks or quick data entry. They maximize efficiency by keeping everything visible without scrolling.

## Characteristics

- **Desktop:** 448px max width, centered
- **Mobile:** 75vh height, bottom sheet
- **Content:** 3-5 form fields maximum
- **Actions:** 1-2 primary actions
- **Scrolling:** Minimal to none

## When to Use

**Good for:**
- ✅ Create task/project/capture forms
- ✅ Quick capture dialogs
- ✅ Simple confirmations
- ✅ Short message displays
- ✅ Single-field inputs

**Not good for:**
- ❌ Multi-step wizards (use Standard)
- ❌ Content browsing (use Standard)
- ❌ Rich media viewing (use Immersive)
- ❌ Complex forms with many fields

## Pattern Template

```tsx
import { useMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalHeader } from '@/components/modals/modal-header';

function CompactDialog({ open, onClose }) {
  const isMobile = useMobile();

  const content = (
    <>
      <ModalHeader
        title="Quick Action"
        subtitle="Brief description"
        onClose={onClose}
      />
      <div className="space-y-4 py-4">
        {/* 3-5 form fields */}
      </div>
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit}>
          Submit
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[75vh]">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Real Example: Task Create Dialog

```tsx
function TaskCreateDialog({ open, onClose, projects }) {
  const isMobile = useMobile();
  const [formData, setFormData] = useState({
    title: '',
    project_id: null,
    priority: 'medium'
  });

  const content = (
    <>
      <ModalHeader
        title="Create Task"
        subtitle="Add a new task to your list"
        onClose={onClose}
      />

      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="title">Task</Label>
          <Input
            id="title"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({
              ...prev,
              title: e.target.value
            }))}
            placeholder="What needs to be done?"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project">Project</Label>
          <Select
            value={formData.project_id}
            onValueChange={(value) => setFormData(prev => ({
              ...prev,
              project_id: value
            }))}
          >
            {/* Project options */}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select
            value={formData.priority}
            onValueChange={(value) => setFormData(prev => ({
              ...prev,
              priority: value
            }))}
          >
            {/* Priority options */}
          </Select>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => handleSubmit(formData)}
          disabled={!formData.title.trim()}
        >
          Create Task
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent className="h-[75vh]">
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        {content}
      </DialogContent>
    </Dialog>
  );
}
```

## Design Guidelines

### Layout
- Header with title + subtitle
- Form fields with consistent spacing (space-y-4)
- Footer with Cancel + Submit buttons

### Spacing
- Vertical rhythm: 16px (space-y-4)
- Form padding: 16px vertical (py-4)
- Footer padding: 16px top (pt-4)

### Typography
- Title: text-lg font-semibold
- Subtitle: text-sm text-muted-foreground
- Labels: text-sm font-medium

## Mobile Considerations

### 75vh Height
Perfect for:
- Keyboard visibility (leaves 25vh for keyboard)
- Quick dismiss (swipe down - future)
- Comfortable one-handed use

### Touch Targets
- Input fields: min-h-11 (44px)
- Buttons: min-h-11 (44px)
- Spacing between elements: 8px minimum

## Performance

### Lazy Loading
Compact dialogs are perfect for lazy loading:

```tsx
import { LazyDialog } from '@/components/ui/lazy-dialog';

<LazyDialog
  open={isOpen}
  onClose={() => setIsOpen(false)}
  loader={() => import('./task-create-dialog').then(m => ({
    default: m.TaskCreateDialog
  }))}
  projects={projects}
/>
```

## Accessibility

- All form fields must have labels
- Submit button disabled when invalid
- Focus trapped within dialog
- Escape closes dialog
- Title announced by screen readers

## Examples in Codebase

**Production Examples:**
- `src/components/tasks/task-create-dialog.tsx` - 3 fields
- `src/components/projects/project-create-dialog.tsx` - 4 fields
- `src/components/captures/capture-create-dialog.tsx` - 4 fields + voice
- `src/components/ui/quick-capture-dialog.tsx` - 1 field minimal

---

**Next:** [Standard Modals](./standard-modals.md)
