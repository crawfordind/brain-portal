import * as React from 'react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function ModalSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  className,
  ...props
}: ModalSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const titleId = React.useId();

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={cn('space-y-3', className)}
      {...props}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className={cn(
            "flex items-center justify-between w-full text-sm font-medium",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          )}
        >
          <span id={titleId}>{title}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      ) : (
        <h3 id={titleId} className="text-sm font-medium">
          {title}
        </h3>
      )}

      {(!collapsible || isOpen) && <div>{children}</div>}
    </div>
  );
}
