'use client';

import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TASK_STATE_LABELS, isActive, isTaskState, type TaskState } from '@/lib/agents/runtime/types';

/** Colours by what the state asks of the user, not by how it was reached. */
const TONE: Record<TaskState, string> = {
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
  task: { status: string; runtime?: string | null; runtime_state?: string | null };
  className?: string;
}

/**
 * A task's state in words. Tasks on the current lifecycle (either runtime)
 * show their precise state; rows from before it show their original status.
 */
export function TaskStateBadge({ task, className }: Props) {
  if (isTaskState(task.runtime_state)) {
    const state = task.runtime_state;
    return (
      <Badge variant="outline" className={cn(TONE[state], 'gap-1', className)}>
        {isActive(state) && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {TASK_STATE_LABELS[state]}
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
export function shouldPoll(task: { status: string; runtime?: string | null; runtime_state?: string | null } | undefined): boolean {
  if (!task) return false;
  if (isTaskState(task.runtime_state)) return isActive(task.runtime_state);
  return task.status === 'queued' || task.status === 'processing';
}
