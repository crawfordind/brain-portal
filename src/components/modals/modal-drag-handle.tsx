import * as React from 'react';
import { cn } from '@/lib/utils';

export type ModalDragHandleProps = React.HTMLAttributes<HTMLDivElement>;

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
