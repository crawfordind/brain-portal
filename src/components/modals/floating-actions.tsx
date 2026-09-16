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
        'fixed left-1/2 -translate-x-1/2 z-[52]',
        'flex items-center gap-2 px-3 py-2',
        'bg-background/80 backdrop-blur-sm border shadow-lg rounded-full',
        position === 'bottom' ? 'bottom-6' : 'top-6',
        className
      )}
      data-testid="floating-actions"
      {...props}
    >
      {actions.map((action, index) => (
        <Button
          key={index}
          size="touch-icon"
          variant={action.variant || 'ghost'}
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.label}
          className="rounded-full"
        >
          {action.icon}
        </Button>
      ))}
    </div>
  );
}
