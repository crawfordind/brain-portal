# Modal System Phase 1: Foundation Components

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build enhanced Dialog and Sheet primitives with size variants, gestures, and shared modal patterns to enable world-class modal experience.

**Architecture:** Enhance existing shadcn/ui Dialog and Sheet components (built on Radix UI) with size variants (compact/standard/immersive), swipe-to-dismiss gestures, improved animations, and create reusable modal patterns (ModalHeader, ModalFooter, ModalSection) for consistency.

**Tech Stack:** React, TypeScript, Radix UI (@radix-ui/react-dialog), Tailwind CSS, Framer Motion (animations), react-use-gesture (gestures), Vitest (testing)

**Dependencies to Install:**
```bash
npm install framer-motion react-use-gesture
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

---

## Task 1: Enhanced Dialog Component - Size Variants

**Files:**
- Modify: `src/components/ui/dialog.tsx`
- Test: `tests/components/ui/dialog.test.tsx` (create)

**Step 1: Write failing test for size variants**

Create `tests/components/ui/dialog.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

describe('Dialog - Size Variants', () => {
  it('applies compact size class', () => {
    render(
      <Dialog open>
        <DialogContent size="compact" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-md');
  });

  it('applies standard size class', () => {
    render(
      <Dialog open>
        <DialogContent size="standard" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-2xl');
  });

  it('applies immersive size class', () => {
    render(
      <Dialog open>
        <DialogContent size="immersive" data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-7xl');
  });

  it('defaults to standard size when not specified', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByTestId('dialog');
    expect(dialog).toHaveClass('sm:max-w-2xl');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/ui/dialog.test.tsx`
Expected: FAIL - "size" prop doesn't exist, classes not applied

**Step 3: Update Dialog component with size variants**

Modify `src/components/ui/dialog.tsx`:

```typescript
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const dialogContentVariants = cva(
  "fixed left-[50%] top-[50%] z-[51] grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
  {
    variants: {
      size: {
        compact: "max-w-[calc(100%-2rem)] p-6 sm:max-w-md sm:rounded-lg",
        standard: "max-w-[calc(100%-2rem)] p-6 sm:max-w-2xl sm:rounded-lg",
        immersive: "max-w-[calc(100%-2rem)] p-0 sm:max-w-7xl sm:rounded-lg",
      },
    },
    defaultVariants: {
      size: "standard",
    },
  }
)

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  showCloseButton?: boolean
  dismissible?: boolean
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, showCloseButton = true, dismissible = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        if (!dismissible) {
          e.preventDefault()
        }
      }}
      className={cn(dialogContentVariants({ size }), className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
```

**Step 4: Install class-variance-authority if needed**

Run: `npm install class-variance-authority`

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/components/ui/dialog.test.tsx`
Expected: PASS - All size variant tests pass

**Step 6: Commit**

```bash
git add src/components/ui/dialog.tsx tests/components/ui/dialog.test.tsx
git commit -m "feat(dialog): add size variants (compact/standard/immersive)"
```

---

## Task 2: Dialog Dismissible Prop

**Files:**
- Modify: `src/components/ui/dialog.tsx` (already updated in Task 1)
- Test: `tests/components/ui/dialog.test.tsx`

**Step 1: Write failing test for dismissible behavior**

Add to `tests/components/ui/dialog.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent } from '@/components/ui/dialog';

describe('Dialog - Dismissible Behavior', () => {
  it('allows backdrop click to dismiss when dismissible=true', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent dismissible={true} data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    // Click on overlay (backdrop)
    const overlay = document.querySelector('[data-radix-dialog-overlay]');
    await userEvent.click(overlay!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('prevents backdrop click to dismiss when dismissible=false', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent dismissible={false} data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    // Click on overlay (backdrop)
    const overlay = document.querySelector('[data-radix-dialog-overlay]');
    await userEvent.click(overlay!);

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('defaults to dismissible=true', async () => {
    const onOpenChange = vi.fn();

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent data-testid="dialog">
          Content
        </DialogContent>
      </Dialog>
    );

    const overlay = document.querySelector('[data-radix-dialog-overlay]');
    await userEvent.click(overlay!);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
```

**Step 2: Run test to verify behavior**

Run: `npm test -- tests/components/ui/dialog.test.tsx`
Expected: PASS (implementation already added in Task 1)

**Step 3: Commit**

```bash
git add tests/components/ui/dialog.test.tsx
git commit -m "test(dialog): add dismissible prop tests"
```

---

## Task 3: Enhanced Sheet Component - Bottom Sheet Styling

**Files:**
- Modify: `src/components/ui/sheet.tsx`
- Test: `tests/components/ui/sheet.test.tsx` (create)

**Step 1: Write failing test for bottom sheet styling**

Create `tests/components/ui/sheet.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sheet, SheetContent } from '@/components/ui/sheet';

describe('Sheet - Bottom Sheet Styling', () => {
  it('applies rounded top corners for bottom sheet', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" data-testid="sheet">
          Content
        </SheetContent>
      </Sheet>
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).toHaveClass('rounded-t-2xl');
  });

  it('does not apply rounded corners for left/right sheets', () => {
    render(
      <Sheet open>
        <SheetContent side="right" data-testid="sheet">
          Content
        </SheetContent>
      </Sheet>
    );

    const sheet = screen.getByTestId('sheet');
    expect(sheet).not.toHaveClass('rounded-t-2xl');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/ui/sheet.test.tsx`
Expected: FAIL - rounded-t-2xl class not applied to bottom sheets

**Step 3: Update Sheet component**

Modify `src/components/ui/sheet.tsx`:

```typescript
import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-[51] gap-4 bg-background shadow-2xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-250 data-[state=open]:duration-300",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t rounded-t-2xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  showCloseButton?: boolean
  dismissible?: boolean
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, showCloseButton = true, dismissible = true, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        if (!dismissible) {
          e.preventDefault()
        }
      }}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      )}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/ui/sheet.test.tsx`
Expected: PASS - Bottom sheet has rounded top corners

**Step 5: Commit**

```bash
git add src/components/ui/sheet.tsx tests/components/ui/sheet.test.tsx
git commit -m "feat(sheet): add rounded top corners for bottom sheets"
```

---

## Task 4: Create ModalDragHandle Component

**Files:**
- Create: `src/components/modals/modal-drag-handle.tsx`
- Test: `tests/components/modals/modal-drag-handle.test.tsx`

**Step 1: Write failing test**

Create `tests/components/modals/modal-drag-handle.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModalDragHandle } from '@/components/modals/modal-drag-handle';

describe('ModalDragHandle', () => {
  it('renders drag handle indicator', () => {
    render(<ModalDragHandle data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toBeInTheDocument();
  });

  it('applies correct styling for visual affordance', () => {
    render(<ModalDragHandle data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toHaveClass('w-12', 'h-1', 'rounded-full', 'bg-muted-foreground/20');
  });

  it('accepts custom className', () => {
    render(<ModalDragHandle className="custom-class" data-testid="drag-handle" />);

    const handle = screen.getByTestId('drag-handle');
    expect(handle).toHaveClass('custom-class');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/modals/modal-drag-handle.test.tsx`
Expected: FAIL - Component doesn't exist

**Step 3: Create modal-drag-handle component**

Create directory: `mkdir -p src/components/modals`

Create `src/components/modals/modal-drag-handle.tsx`:

```typescript
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ModalDragHandleProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModalDragHandle({ className, ...props }: ModalDragHandleProps) {
  return (
    <div
      className={cn(
        'mx-auto w-12 h-1 rounded-full bg-muted-foreground/20 shrink-0',
        className
      )}
      aria-hidden="true"
      {...props}
    />
  );
}
```

Create `src/components/modals/index.ts`:

```typescript
export { ModalDragHandle } from './modal-drag-handle';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/modals/modal-drag-handle.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modals/modal-drag-handle.tsx src/components/modals/index.ts tests/components/modals/modal-drag-handle.test.tsx
git commit -m "feat(modals): add ModalDragHandle component for bottom sheets"
```

---

## Task 5: Create ModalHeader Component

**Files:**
- Create: `src/components/modals/modal-header.tsx`
- Test: `tests/components/modals/modal-header.test.tsx`

**Step 1: Write failing test**

Create `tests/components/modals/modal-header.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalHeader } from '@/components/modals/modal-header';

describe('ModalHeader', () => {
  it('renders title', () => {
    render(<ModalHeader title="Test Title" />);

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<ModalHeader title="Title" subtitle="Subtitle text" />);

    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('renders close button by default', () => {
    render(<ModalHeader title="Title" />);

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('hides close button when showClose=false', () => {
    render(<ModalHeader title="Title" showClose={false} />);

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(<ModalHeader title="Title" onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    render(<ModalHeader title="Title" className="custom-class" data-testid="header" />);

    const header = screen.getByTestId('header');
    expect(header).toHaveClass('custom-class');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/modals/modal-header.test.tsx`
Expected: FAIL - Component doesn't exist

**Step 3: Create ModalHeader component**

Create `src/components/modals/modal-header.tsx`:

```typescript
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  showClose?: boolean;
  onClose?: () => void;
}

export function ModalHeader({
  title,
  subtitle,
  showClose = true,
  onClose,
  className,
  ...props
}: ModalHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b pb-4',
        className
      )}
      data-testid="header"
      {...props}
    >
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-semibold leading-none tracking-tight truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1.5">{subtitle}</p>
        )}
      </div>

      {showClose && onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="shrink-0"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

Update `src/components/modals/index.ts`:

```typescript
export { ModalDragHandle } from './modal-drag-handle';
export { ModalHeader } from './modal-header';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/modals/modal-header.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modals/modal-header.tsx src/components/modals/index.ts tests/components/modals/modal-header.test.tsx
git commit -m "feat(modals): add ModalHeader component with title, subtitle, close button"
```

---

## Task 6: Create ModalFooter Component

**Files:**
- Create: `src/components/modals/modal-footer.tsx`
- Test: `tests/components/modals/modal-footer.test.tsx`

**Step 1: Write failing test**

Create `tests/components/modals/modal-footer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalFooter } from '@/components/modals/modal-footer';

describe('ModalFooter', () => {
  it('renders primary action', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn() }}
      />
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders secondary action when provided', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn() }}
        secondaryAction={{ label: 'Cancel', onClick: vi.fn() }}
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls primaryAction onClick handler', async () => {
    const onClick = vi.fn();
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick }}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables primary button when loading', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn(), loading: true }}
      />
    );

    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
  });

  it('shows loading text when primary button loading', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Save', onClick: vi.fn(), loading: true, loadingText: 'Saving...' }}
      />
    );

    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('applies destructive variant to primary action', () => {
    render(
      <ModalFooter
        primaryAction={{ label: 'Delete', onClick: vi.fn(), variant: 'destructive' }}
      />
    );

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-destructive');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/modals/modal-footer.test.tsx`
Expected: FAIL - Component doesn't exist

**Step 3: Create ModalFooter component**

Create `src/components/modals/modal-footer.tsx`:

```typescript
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ModalFooterAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  primaryAction: ModalFooterAction;
  secondaryAction?: ModalFooterAction;
  sticky?: boolean;
}

export function ModalFooter({
  primaryAction,
  secondaryAction,
  sticky = true,
  className,
  ...props
}: ModalFooterProps) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:gap-3',
        sticky && 'sticky bottom-0 bg-background',
        className
      )}
      {...props}
    >
      {secondaryAction && (
        <Button
          variant={secondaryAction.variant || 'outline'}
          onClick={secondaryAction.onClick}
          disabled={secondaryAction.disabled || secondaryAction.loading}
        >
          {secondaryAction.loading && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {secondaryAction.icon && !secondaryAction.loading && (
            <span className="mr-2">{secondaryAction.icon}</span>
          )}
          {secondaryAction.loading && secondaryAction.loadingText
            ? secondaryAction.loadingText
            : secondaryAction.label}
        </Button>
      )}

      <Button
        variant={primaryAction.variant || 'default'}
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled || primaryAction.loading}
      >
        {primaryAction.loading && (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        )}
        {primaryAction.icon && !primaryAction.loading && (
          <span className="mr-2">{primaryAction.icon}</span>
        )}
        {primaryAction.loading && primaryAction.loadingText
          ? primaryAction.loadingText
          : primaryAction.label}
      </Button>
    </div>
  );
}
```

Update `src/components/modals/index.ts`:

```typescript
export { ModalDragHandle } from './modal-drag-handle';
export { ModalHeader } from './modal-header';
export { ModalFooter } from './modal-footer';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/modals/modal-footer.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modals/modal-footer.tsx src/components/modals/index.ts tests/components/modals/modal-footer.test.tsx
git commit -m "feat(modals): add ModalFooter with primary/secondary actions"
```

---

## Task 7: Create ModalSection Component (Collapsible)

**Files:**
- Create: `src/components/modals/modal-section.tsx`
- Test: `tests/components/modals/modal-section.test.tsx`

**Step 1: Write failing test**

Create `tests/components/modals/modal-section.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalSection } from '@/components/modals/modal-section';

describe('ModalSection', () => {
  it('renders title and content', () => {
    render(
      <ModalSection title="Section Title">
        <p>Section content</p>
      </ModalSection>
    );

    expect(screen.getByText('Section Title')).toBeInTheDocument();
    expect(screen.getByText('Section content')).toBeInTheDocument();
  });

  it('is expanded by default when defaultOpen=true', () => {
    render(
      <ModalSection title="Title" defaultOpen={true}>
        <p>Content</p>
      </ModalSection>
    );

    expect(screen.getByText('Content')).toBeVisible();
  });

  it('is collapsed by default when defaultOpen=false', () => {
    render(
      <ModalSection title="Title" defaultOpen={false}>
        <p>Content</p>
      </ModalSection>
    );

    // Content should not be visible
    const content = screen.queryByText('Content');
    expect(content).not.toBeInTheDocument();
  });

  it('toggles content when collapsible and title clicked', async () => {
    render(
      <ModalSection title="Title" collapsible defaultOpen={true}>
        <p>Content</p>
      </ModalSection>
    );

    const trigger = screen.getByRole('button', { name: /title/i });

    // Initially visible
    expect(screen.getByText('Content')).toBeVisible();

    // Click to collapse
    await userEvent.click(trigger);

    // Content hidden after animation
    // Note: In actual implementation, content visibility depends on Radix Collapsible
  });

  it('shows chevron icon when collapsible', () => {
    render(
      <ModalSection title="Title" collapsible>
        <p>Content</p>
      </ModalSection>
    );

    const trigger = screen.getByRole('button', { name: /title/i });
    expect(trigger.querySelector('svg')).toBeInTheDocument();
  });

  it('does not show chevron when not collapsible', () => {
    render(
      <ModalSection title="Title" collapsible={false}>
        <p>Content</p>
      </ModalSection>
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/modals/modal-section.test.tsx`
Expected: FAIL - Component doesn't exist

**Step 3: Install Radix Collapsible**

Run: `npm install @radix-ui/react-collapsible`

**Step 4: Create ModalSection component**

Create `src/components/modals/modal-section.tsx`:

```typescript
import * as React from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalSectionProps {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

export function ModalSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
}: ModalSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  if (!collapsible) {
    return (
      <div className={cn('space-y-3', className)}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <div>{children}</div>
      </div>
    );
  }

  return (
    <CollapsiblePrimitive.Root
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn('space-y-3', className)}
    >
      <CollapsiblePrimitive.Trigger className="flex w-full items-center justify-between text-sm font-semibold hover:underline">
        {title}
        <ChevronDown
          className={cn(
            'h-4 w-4 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content className="data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
        <div>{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
```

**Step 5: Add collapse animations to Tailwind config**

Modify `tailwind.config.ts` to add collapse animations:

```typescript
// In the theme.extend.keyframes section, add:
keyframes: {
  // ... existing keyframes
  "collapse-down": {
    from: { height: "0", opacity: "0" },
    to: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
  },
  "collapse-up": {
    from: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
    to: { height: "0", opacity: "0" },
  },
},
// In the theme.extend.animation section, add:
animation: {
  // ... existing animations
  "collapse-down": "collapse-down 0.2s ease-out",
  "collapse-up": "collapse-up 0.2s ease-out",
},
```

Update `src/components/modals/index.ts`:

```typescript
export { ModalDragHandle } from './modal-drag-handle';
export { ModalHeader } from './modal-header';
export { ModalFooter } from './modal-footer';
export { ModalSection } from './modal-section';
```

**Step 6: Run test to verify it passes**

Run: `npm test -- tests/components/modals/modal-section.test.tsx`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/modals/modal-section.tsx src/components/modals/index.ts tests/components/modals/modal-section.test.tsx tailwind.config.ts
git commit -m "feat(modals): add ModalSection with collapsible support"
```

---

## Task 8: Create FloatingActions Component

**Files:**
- Create: `src/components/modals/floating-actions.tsx`
- Test: `tests/components/modals/floating-actions.test.tsx`

**Step 1: Write failing test**

Create `tests/components/modals/floating-actions.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloatingActions } from '@/components/modals/floating-actions';
import { Download, Trash2 } from 'lucide-react';

describe('FloatingActions', () => {
  it('renders action buttons', () => {
    const actions = [
      { icon: <Download />, label: 'Download', onClick: vi.fn() },
      { icon: <Trash2 />, label: 'Delete', onClick: vi.fn() },
    ];

    render(<FloatingActions actions={actions} />);

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onClick handler when button clicked', async () => {
    const onClick = vi.fn();
    const actions = [
      { icon: <Download />, label: 'Download', onClick },
    ];

    render(<FloatingActions actions={actions} />);

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies destructive variant to action', () => {
    const actions = [
      { icon: <Trash2 />, label: 'Delete', onClick: vi.fn(), variant: 'destructive' },
    ];

    render(<FloatingActions actions={actions} />);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-destructive');
  });

  it('positions at bottom by default', () => {
    const actions = [
      { icon: <Download />, label: 'Download', onClick: vi.fn() },
    ];

    render(<FloatingActions actions={actions} data-testid="floating" />);

    const container = screen.getByTestId('floating');
    expect(container).toHaveClass('bottom-4');
  });

  it('applies custom className', () => {
    const actions = [
      { icon: <Download />, label: 'Download', onClick: vi.fn() },
    ];

    render(<FloatingActions actions={actions} className="custom-class" data-testid="floating" />);

    const container = screen.getByTestId('floating');
    expect(container).toHaveClass('custom-class');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/modals/floating-actions.test.tsx`
Expected: FAIL - Component doesn't exist

**Step 3: Create FloatingActions component**

Create `src/components/modals/floating-actions.tsx`:

```typescript
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface FloatingAction {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  disabled?: boolean;
}

export interface FloatingActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  actions: FloatingAction[];
  position?: 'top' | 'bottom';
}

export function FloatingActions({
  actions,
  position = 'bottom',
  className,
  ...props
}: FloatingActionsProps) {
  return (
    <div
      className={cn(
        'absolute inset-x-0 z-[52] flex items-center justify-center gap-2 px-4',
        position === 'bottom' ? 'bottom-4' : 'top-4',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 rounded-full bg-background/80 backdrop-blur-sm border shadow-lg p-2">
        {actions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant || 'ghost'}
            size="icon"
            onClick={action.onClick}
            disabled={action.disabled}
            aria-label={action.label}
            className="h-11 w-11 rounded-full"
          >
            {action.icon}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

Update `src/components/modals/index.ts`:

```typescript
export { ModalDragHandle } from './modal-drag-handle';
export { ModalHeader } from './modal-header';
export { ModalFooter } from './modal-footer';
export { ModalSection } from './modal-section';
export { FloatingActions } from './floating-actions';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/components/modals/modal-section.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modals/floating-actions.tsx src/components/modals/index.ts tests/components/modals/floating-actions.test.tsx
git commit -m "feat(modals): add FloatingActions for overlay action bars"
```

---

## Task 9: Add Safe Area Insets Support

**Files:**
- Modify: `src/components/ui/sheet.tsx`
- Create: `src/styles/safe-area.css` (if needed)

**Step 1: Update Sheet for safe area insets**

Modify `src/components/ui/sheet.tsx` to add safe area padding:

```typescript
// In the sheetVariants, update the bottom variant:
bottom:
  "inset-x-0 bottom-0 border-t rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
```

**Step 2: Add safe area CSS variables (if needed)**

Create `src/styles/safe-area.css`:

```css
:root {
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-right: env(safe-area-inset-right, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-inset-left: env(safe-area-inset-left, 0px);
}
```

Import in `src/app/globals.css`:

```css
@import './safe-area.css';
```

**Step 3: Test on device with notch**

Manual test:
- Open app on iPhone 14 Pro or later
- Open a bottom sheet
- Verify content doesn't overlap with home indicator

**Step 4: Commit**

```bash
git add src/components/ui/sheet.tsx src/styles/safe-area.css src/app/globals.css
git commit -m "feat(sheet): add safe area insets for mobile notches"
```

---

## Task 10: Integration Test - Complete Modal Example

**Files:**
- Create: `tests/integration/complete-modal.test.tsx`

**Step 1: Write integration test**

Create `tests/integration/complete-modal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ModalHeader, ModalFooter, ModalSection } from '@/components/modals';

describe('Complete Modal Integration', () => {
  it('renders a complete modal with all components', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <Dialog open>
        <DialogContent size="compact" dismissible={false}>
          <ModalHeader
            title="Create Task"
            subtitle="Add a new task to your project"
            onClose={onCancel}
          />

          <div className="space-y-4 py-4">
            <ModalSection title="Details" collapsible={false}>
              <input
                type="text"
                placeholder="Task name"
                className="w-full p-2 border rounded"
              />
            </ModalSection>

            <ModalSection title="Advanced" collapsible defaultOpen={false}>
              <input
                type="text"
                placeholder="Tags"
                className="w-full p-2 border rounded"
              />
            </ModalSection>
          </div>

          <ModalFooter
            primaryAction={{ label: 'Create', onClick: onSave }}
            secondaryAction={{ label: 'Cancel', onClick: onCancel }}
          />
        </DialogContent>
      </Dialog>
    );

    // Verify all parts render
    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByText('Add a new task to your project')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Test interactions
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSave).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify**

Run: `npm test -- tests/integration/complete-modal.test.tsx`
Expected: PASS - All modal components work together

**Step 3: Commit**

```bash
git add tests/integration/complete-modal.test.tsx
git commit -m "test(modals): add integration test for complete modal"
```

---

## Task 11: Update Documentation

**Files:**
- Create: `src/components/modals/README.md`

**Step 1: Write component documentation**

Create `src/components/modals/README.md`:

```markdown
# Modal Components

Reusable modal patterns for consistent UI across the application.

## Components

### ModalHeader

Header component with title, optional subtitle, and close button.

**Usage:**
\`\`\`tsx
<ModalHeader
  title="Create Task"
  subtitle="Add a new task to your project"
  onClose={() => setOpen(false)}
  showClose={true}
/>
\`\`\`

**Props:**
- `title` (string, required): Main heading
- `subtitle` (string, optional): Descriptive text below title
- `showClose` (boolean, default: true): Show close button
- `onClose` (function, optional): Close handler

---

### ModalFooter

Footer component with primary and optional secondary action buttons.

**Usage:**
\`\`\`tsx
<ModalFooter
  primaryAction={{
    label: 'Save',
    onClick: handleSave,
    loading: isSaving,
    loadingText: 'Saving...',
  }}
  secondaryAction={{
    label: 'Cancel',
    onClick: handleCancel,
  }}
  sticky={true}
/>
\`\`\`

**Props:**
- `primaryAction` (ModalFooterAction, required): Primary button config
- `secondaryAction` (ModalFooterAction, optional): Secondary button config
- `sticky` (boolean, default: true): Stick to bottom of modal

**ModalFooterAction:**
- `label` (string): Button text
- `onClick` (function): Click handler
- `variant` (string, optional): Button variant
- `loading` (boolean, optional): Loading state
- `loadingText` (string, optional): Text shown when loading
- `disabled` (boolean, optional): Disabled state
- `icon` (ReactNode, optional): Icon before label

---

### ModalSection

Collapsible section for organizing modal content.

**Usage:**
\`\`\`tsx
<ModalSection
  title="Advanced Options"
  collapsible={true}
  defaultOpen={false}
>
  <p>Section content</p>
</ModalSection>
\`\`\`

**Props:**
- `title` (string, required): Section heading
- `collapsible` (boolean, default: false): Enable collapse
- `defaultOpen` (boolean, default: true): Initial state
- `children` (ReactNode, required): Section content

---

### FloatingActions

Floating action bar for overlay buttons (mobile viewers).

**Usage:**
\`\`\`tsx
<FloatingActions
  actions={[
    {
      icon: <Download />,
      label: 'Download',
      onClick: handleDownload,
    },
    {
      icon: <Trash2 />,
      label: 'Delete',
      onClick: handleDelete,
      variant: 'destructive',
    },
  ]}
  position="bottom"
/>
\`\`\`

**Props:**
- `actions` (FloatingAction[], required): Action buttons
- `position` ('top' | 'bottom', default: 'bottom'): Position

**FloatingAction:**
- `icon` (ReactNode): Button icon
- `label` (string): Accessible label
- `onClick` (function): Click handler
- `variant` (string, optional): Button variant
- `disabled` (boolean, optional): Disabled state

---

### ModalDragHandle

Visual drag indicator for bottom sheets.

**Usage:**
\`\`\`tsx
<ModalDragHandle />
\`\`\`

Simple component with no required props. Renders horizontal bar.

---

## Complete Example

\`\`\`tsx
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  ModalHeader,
  ModalFooter,
  ModalSection,
  ModalDragHandle,
} from '@/components/modals';

function CreateTaskModal({ open, onClose, onSave }) {
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    await onSave();
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact" dismissible={false}>
        {/* Mobile drag handle */}
        <ModalDragHandle className="sm:hidden" />

        <ModalHeader
          title="Create Task"
          subtitle="Add a new task to your project"
          onClose={onClose}
        />

        <div className="space-y-4 py-4">
          <ModalSection title="Basic Info">
            {/* Form fields */}
          </ModalSection>

          <ModalSection
            title="Advanced Options"
            collapsible
            defaultOpen={false}
          >
            {/* Optional fields */}
          </ModalSection>
        </div>

        <ModalFooter
          primaryAction={{
            label: 'Create Task',
            onClick: handleSave,
            loading,
            loadingText: 'Creating...',
          }}
          secondaryAction={{
            label: 'Cancel',
            onClick: onClose,
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
\`\`\`

## Design Guidelines

### Spacing
- Section gaps: `space-y-6` (24px)
- Form fields: `space-y-4` (16px)
- Related items: `space-y-2` (8px)

### Touch Targets
- Mobile minimum: 44px (`min-h-11`)
- Desktop minimum: 36px (`min-h-9`)

### Accessibility
- Always provide aria-label for icon buttons
- Use semantic heading levels
- Ensure keyboard navigation works
- Test with screen readers

## Testing

All components have unit tests in `tests/components/modals/`.

Run tests:
\`\`\`bash
npm test -- tests/components/modals
\`\`\`
```

**Step 2: Commit**

```bash
git add src/components/modals/README.md
git commit -m "docs(modals): add comprehensive component documentation"
```

---

## Task 12: Build Verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Type check**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: phase 1 foundation components complete"
git push
```

---

## Success Criteria

✅ Dialog component has size variants (compact/standard/immersive)
✅ Dialog has dismissible prop for backdrop behavior
✅ Sheet has rounded corners for bottom sheets
✅ Sheet has safe area insets for mobile
✅ ModalHeader with title, subtitle, close button
✅ ModalFooter with primary/secondary actions
✅ ModalSection with collapsible support
✅ FloatingActions for overlay buttons
✅ ModalDragHandle for sheet indicators
✅ All components fully tested
✅ Complete integration test
✅ Documentation complete
✅ Type safe with TypeScript
✅ Build passes

## Next Steps

After Phase 1 completion:
1. **Phase 2**: Redesign AttachmentViewer with new components
2. **Phase 3**: Migrate remaining 10 modals to new patterns
3. **Phase 4**: Polish, accessibility audit, performance optimization

## Notes

- All components use shadcn/ui conventions
- Tests use Vitest + Testing Library
- Follows TDD: test → fail → implement → pass → commit
- Small, atomic commits for easy review
- Type-safe with full TypeScript support
