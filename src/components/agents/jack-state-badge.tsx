'use client';

import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JACK_STATE_LABELS, isActive, isJackState, type JackState } from '@/lib/agents/jack/types';

/** Colours by what the state asks of Daniel, not by how it was reached. */
const TONE: Record<JackState, string> = {
  needs_dispatch: 'bg-amber-500 text-white',
  needs_review: 'bg-amber-600 text-white',
  queued: 'bg-gray-500 text-white',
  dispatching: 'bg-blue-500 text-white',
  running: 'bg-blue-500 text-white',
  awaiting_approval: 'bg-orange-500 text-white',
  awaiting_input: 'bg-orange-500 text-white',
  cancelling: 'bg-gray-500 text-white',
  awaiting_review: 'bg-purple-500 text-white',
  completed: 'bg-green-600 text-white',
  rejected: 'bg-red-500 text-white',
  failed: 'bg-red-700 text-white',
  cancelled: 'bg-gray-600 text-white',
};

const LEGACY_TONE: Record<string, string> = {
  queued: 'bg-gray-500 text-white',
  processing: 'bg-blue-500 text-white',
  awaiting_review: 'bg-purple-500 text-white',
  revision_requested: 'bg-orange-500 text-white',
  approved: 'bg-green-500 text-white',
  rejected: 'bg-red-500 text-white',
  failed: 'bg-red-700 text-white',
};

interface Props {
  task: { status: string; runtime?: string | null; jack_state?: string | null };
  className?: string;
}

/**
 * A task's state in words. Jack tasks show their precise state; historical
 * tasks from the retired OpenRouter runtime show their original status.
 */
export function JackStateBadge({ task, className }: Props) {
  if (task.runtime === 'jack' && isJackState(task.jack_state)) {
    const state = task.jack_state;
    return (
      <Badge variant="outline" className={cn(TONE[state], 'gap-1', className)}>
        {isActive(state) && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {JACK_STATE_LABELS[state]}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(LEGACY_TONE[task.status] ?? 'bg-gray-500 text-white', className)}>
      {task.status.replace(/_/g, ' ')}
    </Badge>
  );
}

/** States in which the page should keep asking for fresh status. */
export function shouldPoll(task: { status: string; runtime?: string | null; jack_state?: string | null } | undefined): boolean {
  if (!task) return false;
  if (task.runtime === 'jack' && isJackState(task.jack_state)) return isActive(task.jack_state);
  return task.status === 'queued' || task.status === 'processing';
}
