import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  showClose?: boolean;
  onClose?: () => void;
  id?: string; // Allow custom ID for aria-labelledby
}

export function ModalHeader({
  title,
  subtitle,
  showClose = true,
  onClose,
  className,
  id,
  ...props
}: ModalHeaderProps) {
  // Always call useId, then decide whether to use it. Writing this as
  // `id || React.useId()` short-circuits the hook whenever an `id` prop is
  // passed, so the hook order changes between renders the moment a caller
  // starts or stops supplying one — exactly the crash React's rules exist to
  // prevent.
  const generatedId = React.useId();
  const headingId = id || generatedId;

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
        <h2
          id={headingId}
          role="heading"
          aria-level={2}
          className="text-lg font-semibold leading-none tracking-tight truncate"
        >
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
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
