'use client';

import { Suspense, ComponentType, useEffect, useState } from 'react';

interface LazyDialogProps {
  open: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader: () => Promise<{ default: ComponentType<any> }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function DialogSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative bg-background rounded-lg shadow-2xl w-full max-w-md p-6 animate-pulse">
        <div className="h-6 bg-muted rounded w-2/3 mb-4" />
        <div className="space-y-3">
          <div className="h-4 bg-muted rounded" />
          <div className="h-4 bg-muted rounded w-5/6" />
          <div className="h-4 bg-muted rounded w-4/6" />
        </div>
        <div className="flex gap-2 mt-6">
          <div className="h-10 bg-muted rounded flex-1" />
          <div className="h-10 bg-muted rounded flex-1" />
        </div>
      </div>
    </div>
  );
}

export function LazyDialog({ open, loader, ...props }: LazyDialogProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [Component, setComponent] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    if (open && !Component) {
      loader().then((module) => {
        setComponent(() => module.default);
      });
    }
  }, [open, Component, loader]);

  if (!open) {
    return null;
  }

  if (!Component) {
    return <DialogSkeleton />;
  }

  return (
    <Suspense fallback={<DialogSkeleton />}>
      <Component open={open} {...props} />
    </Suspense>
  );
}
