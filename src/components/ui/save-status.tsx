import { formatDistanceToNow } from 'date-fns';
import { Check, AlertCircle, Loader2 } from 'lucide-react';

interface SaveStatusProps {
  status: 'idle' | 'saving' | 'saved' | 'error';
  lastSaved: Date | null;
}

/**
 * Displays a subtle save status indicator
 * Shows "Saving...", "Saved X ago", or "Error saving"
 */
export function SaveStatus({ status, lastSaved }: SaveStatusProps) {
  if (status === 'saving') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Saving...</span>
      </div>
    );
  }

  if (status === 'saved' && lastSaved) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-3 w-3" />
        <span>Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-3 w-3" />
        <span>Error saving</span>
      </div>
    );
  }

  return null;
}
