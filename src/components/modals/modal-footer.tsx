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
