'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModalHeader } from '@/components/modals/modal-header';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { SaveToNoteDialog } from './save-to-note-dialog';
import { Check, Edit, X, Copy, ChevronDown, ChevronUp, MoreVertical, History, Trash2, Info, ExternalLink, Send, Square, ShieldAlert, AlertTriangle, Loader2, ListChecks } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { TaskStateBadge, shouldPoll } from './agent-state-badge';
import { isActive, isTaskState, SENDABLE_STATES, type PendingApproval } from '@/lib/agents/runtime/types';
import { useAgentRuntime } from '@/hooks/use-agent-runtime';


interface AgentEvent {
  id: string;
  actor: 'user' | 'agent' | 'system';
  kind: string;
  createdAt: string;
  detail: Record<string, unknown> | null;
}

interface AgentDetail {
  state: 'ready' | 'disabled' | 'misconfigured';
  message: string;
  approval: PendingApproval | null;
  unreachableSince: string | null;
  runs: Array<{ id: string; kind: string; state: string; externalRunId: string | null; sessionId: string | null; outputVersion: number | null }>;
  events: AgentEvent[];
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Task created',
  sent_to_agent: 'Sent',
  dispatched: 'Work started',
  approval_requested: 'Asked for approval',
  approval_decided: 'Approval decided',
  output_ready: 'Output ready for review',
  revision_requested: 'You replied',
  cancel_requested: 'Stop requested',
  cancelled: 'Cancelled',
  failed: 'Failed',
  review_approved: 'You approved the output',
  review_rejected: 'You rejected the task',
  needs_dispatch: 'Parked: not sent',
  needs_review: 'Flagged for your review',
};

function describeEvent(e: AgentEvent): string {
  const base = EVENT_LABELS[e.kind] ?? e.kind.replace(/_/g, ' ');
  const d = e.detail ?? {};
  if (e.kind === 'approval_decided') return `${base}: ${d.choice === 'once' ? 'approved once' : 'denied'}${d.description ? ` (${String(d.description)})` : ''}`;
  if (e.kind === 'approval_requested' && d.description) return `${base}: ${String(d.description)}`;
  if (e.kind === 'dispatched' && d.replayed) return `${base} (resumed the earlier submission)`;
  return base;
}

interface AgentReviewFocusPanelProps {
  taskId: string;
  open: boolean;
  onClose: () => void;
}

export function AgentReviewFocusPanel({ taskId, open, onClose }: AgentReviewFocusPanelProps) {
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPrompt, setShowPrompt] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const runtime = useAgentRuntime();
  const name = runtime.displayName;

  const { data, isLoading } = useQuery({
    queryKey: ['agent-task', taskId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-tasks/${taskId}`);
      if (!res.ok) throw new Error('Failed to fetch task');
      return res.json();
    },
    enabled: open && !!taskId,
    // While the agent may be working, ask again; on Hermes the server polls the run on each read.
    refetchInterval: (q) => (shouldPoll((q.state.data as { task?: { status: string } } | undefined)?.task) ? 4000 : false),
  });

  const task = data?.task;
  const outputs = data?.outputs || [];
  const contextNotes: Array<{ id: string; title: string; slug: string }> = data?.contextNotes || [];
  const contextUsed: Array<{ id: string; title: string; similarity: number }> = data?.contextUsed || [];
  const sourceEntity: { id: string; type: string; title: string; url: string } | null = data?.sourceEntity || null;
  const agent: AgentDetail | null = data?.agent ?? null;
  const [showActivity, setShowActivity] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const currentOutput = outputs[0];
  const displayVersion = selectedVersion !== null
    ? outputs.find((o: any) => o.version_number === selectedVersion)
    : currentOutput;

  const handleRevise = async () => {
    if (!feedback.trim()) {
      toast.error('Please provide feedback for revision');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Failed to request revision');
      toast.success(result.dispatch === 'not_configured' ? `Saved. ${name} is not connected, so it was not sent.` : `Sent to ${name}`);
      setFeedback('');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to request revision');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to approve');
      toast.success('Task approved!');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });

      // Open save dialog after approval
      setShowSaveDialog(true);
    } catch {
      toast.error('Failed to approve task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    const ok = await confirm({ title: "Reject this task?", description: "The agent's output will be marked as rejected.", destructive: true, confirmLabel: "Reject" });
    if (!ok) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: feedback || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to reject');
      toast.success('Task rejected');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({ title: "Delete this task?", description: "This will permanently delete the task and its output. This cannot be undone.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete');
      toast.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['agent-tasks-count'] });
    queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });
  };

  /** POST to one of the task's runtime actions; the server re-checks ownership and state. */
  const act = async (path: 'send' | 'cancel' | 'approval', body?: unknown, success?: string) => {
    setIsActing(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Something went wrong');
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setIsActing(false);
      refresh();
    }
  };

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Stop this task?',
      description: `If ${name} is working, it is asked to stop at the next safe point. Anything it already did stays done.`,
      destructive: true,
      confirmLabel: 'Stop',
    });
    if (ok) await act('cancel', undefined, 'Stop requested');
  };

  const handleCopy = () => {
    if (displayVersion?.content) {
      navigator.clipboard.writeText(displayVersion.content);
      toast.success('Output copied to clipboard');
    }
  };

  const handleNoteSaved = (slug: string) => {
    router.push(`/notes/${slug}`);
    onClose();
  };

  // Keyboard shortcuts
  useHotkeys('mod+enter', (e) => {
    e.preventDefault();
    if (feedback.trim() && canRevise) handleRevise();
  }, { enabled: open });

  useHotkeys('mod+s', (e) => {
    e.preventDefault();
    if (showActions) handleApprove();
  }, { enabled: open });

  useHotkeys('mod+c', (e) => {
    e.preventDefault();
    handleCopy();
  }, { enabled: open });

  if (!open || isLoading || !task) return null;

  const canRevise = task.current_version < task.max_revisions;
  // Rows on the current lifecycle carry a precise state; older rows are history.
  const managed = isTaskState(task.runtime_state);
  const state = managed ? task.runtime_state : null;
  const working = !!state && isActive(state);
  const showActions = !working && (task.status === 'awaiting_review' || task.status === 'revision_requested');
  const canSend = (!!state && SENDABLE_STATES.includes(state)) || (!managed && task.status === 'failed');
  // A synchronous model call cannot be interrupted, so a running OpenRouter
  // task offers no Stop; waiting work can always be cancelled.
  const remoteStop = task.runtime === 'hermes';
  const canCancel = !!state && (
    ['needs_dispatch', 'needs_review', 'queued'].includes(state) ||
    (remoteStop && ['running', 'awaiting_approval', 'awaiting_input'].includes(state))
  );
  const hermesSession = task.runtime === 'hermes' ? agent?.runs.find((r) => r.sessionId)?.sessionId ?? null : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent size="immersive" className="max-w-5xl h-[100dvh] sm:h-[90vh] p-0 flex flex-col overflow-hidden" showCloseButton={false}>
          <DialogTitle className="sr-only">{task.title}</DialogTitle>
          {/* Header - Fixed */}
          <div className="flex-shrink-0 border-b px-3 sm:px-6 py-3 sm:py-4">
            <ModalHeader title={task.title} onClose={onClose} showClose />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <TaskStateBadge task={task} className="text-xs" />
              {!managed && (
                <span className="text-xs text-muted-foreground">Earlier runtime (read-only history)</span>
              )}
              {displayVersion && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs sm:text-sm text-muted-foreground cursor-help">
                      Version {displayVersion.version_number} of {task.max_revisions}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {task.max_revisions - task.current_version} revision{task.max_revisions - task.current_version !== 1 ? 's' : ''} remaining
                  </TooltipContent>
                </Tooltip>
              )}
              {sourceEntity && (
                <a
                  href={sourceEntity.url}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View original {sourceEntity.type}: {sourceEntity.title.slice(0, 40)}{sourceEntity.title.length > 40 ? '...' : ''}
                </a>
              )}
            </div>
          </div>

          {/* Scrollable Content Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            {managed && (
              <div className="px-3 sm:px-6 pt-3 sm:pt-4 space-y-3">
                {state === 'awaiting_approval' && (
                  <section aria-labelledby="agent-approval-title" className="rounded-lg border border-orange-500/50 bg-orange-500/5 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" aria-hidden />
                      <div className="min-w-0 space-y-1">
                        <h3 id="agent-approval-title" className="font-medium text-sm">{name} is waiting for your approval</h3>
                        {agent?.approval?.description && <p className="text-sm">{agent.approval.description}</p>}
                        {agent?.approval?.tool && <p className="text-xs text-muted-foreground">Tool: {agent.approval.tool}</p>}
                      </div>
                    </div>
                    {agent?.approval?.command && (
                      <pre className="text-xs bg-background border rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{agent.approval.command}</pre>
                    )}
                    {!agent?.approval && (
                      <p className="text-sm text-muted-foreground">{name} has paused for a decision. Loading the details…</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Approving lets {name} do this one thing, once. Brain Portal never grants standing permission.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        className="flex-1 h-11 sm:h-10"
                        disabled={isActing || !agent?.approval}
                        onClick={() => act('approval', { choice: 'once', requestId: agent?.approval?.requestId ?? null }, 'Approved once')}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Approve once
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 h-11 sm:h-10"
                        disabled={isActing || !agent?.approval}
                        onClick={() => act('approval', { choice: 'deny', requestId: agent?.approval?.requestId ?? null }, 'Denied')}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Deny
                      </Button>
                    </div>
                  </section>
                )}

                {(state === 'running' || state === 'dispatching' || state === 'queued' || state === 'cancelling') && (
                  <div role="status" className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                    <span className="flex-1">
                      {state === 'cancelling'
                        ? `Asking ${name} to stop. This updates once it confirms.`
                        : state === 'running'
                          ? `${name} is working on this. You can close this and come back; it keeps going.`
                          : `Handing this to ${name}…`}
                    </span>
                  </div>
                )}

                {task.last_error && state !== 'awaiting_approval' && (
                  <div
                    role="status"
                    className={`flex gap-2 rounded-lg border p-3 text-sm ${
                      state === 'failed' ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                    <p className="min-w-0">{task.last_error}</p>
                  </div>
                )}

                {(canSend || canCancel) && (
                  <div className="flex flex-wrap gap-2">
                    {canSend && (
                      <Button className="h-11 sm:h-9" disabled={isActing} onClick={() => act('send', undefined, `Sent to ${name}`)}>
                        <Send className="h-4 w-4 mr-2" />
                        {state === 'needs_dispatch' ? `Send to ${name}` : 'Retry'}
                      </Button>
                    )}
                    {canCancel && (
                      <Button variant="outline" className="h-11 sm:h-9" disabled={isActing} onClick={handleCancel}>
                        <Square className="h-4 w-4 mr-2" />
                        {working ? 'Stop' : 'Cancel task'}
                      </Button>
                    )}
                  </div>
                )}

                {agent && agent.events.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowActivity(!showActivity)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] sm:min-h-0"
                      aria-expanded={showActivity}
                    >
                      <ListChecks className="h-3 w-3" aria-hidden />
                      Activity ({agent.events.length})
                      {showActivity ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                    {showActivity && (
                      <ol className="mt-2 space-y-1 text-xs border-l pl-3">
                        {agent.events.map((e) => (
                          <li key={e.id} className="flex gap-2">
                            <time className="text-muted-foreground shrink-0 tabular-nums">{e.createdAt.slice(5, 16)}</time>
                            <span>
                              <span className="text-muted-foreground">{e.actor === 'user' ? 'You' : e.actor === 'agent' ? name : 'System'}:</span>{' '}
                              {describeEvent(e)}
                            </span>
                          </li>
                        ))}
                        {hermesSession && (
                          <li className="text-muted-foreground">Hermes session: <code>{hermesSession}</code></li>
                        )}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Context Used - expanded by default */}
            {(contextNotes.length > 0 || contextUsed.length > 0) && (
              <div className="px-3 sm:px-6 pt-3 sm:pt-4 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  {showPrompt ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {managed ? `Context sent to ${name}` : 'Context used by agent'}
                </button>

                {showPrompt && (
                  <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-2 mb-3">
                    {contextNotes.length > 0 && (
                      <div>
                        <span className="text-muted-foreground font-medium inline-flex items-center gap-1">
                          Pinned notes
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>Notes you manually linked as reference material for the agent</TooltipContent>
                          </Tooltip>
                          :
                        </span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {contextNotes.map((note) => (
                            <a
                              key={note.id}
                              href={`/notes/${note.slug}`}
                              className="inline-flex items-center px-2 py-0.5 rounded bg-background border text-foreground hover:bg-accent transition-colors"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {note.title}
                            </a>
                          ))}
                        </span>
                      </div>
                    )}
                    {contextUsed.length > 0 && (
                      <div>
                        <span className="text-muted-foreground font-medium inline-flex items-center gap-1">
                          Auto-found
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>Notes automatically discovered via AI similarity matching (% = relevance)</TooltipContent>
                          </Tooltip>
                          :
                        </span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {contextUsed.map((note) => (
                            <a
                              key={note.id}
                              href={`/notes/${note.id}`}
                              className="inline-flex items-center px-2 py-0.5 rounded bg-background border text-foreground hover:bg-accent transition-colors"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {note.title}
                              <span className="ml-1 text-muted-foreground">
                                {Math.round(note.similarity * 100)}%
                              </span>
                            </a>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TL;DR Summary */}
            {displayVersion?.summary && (
              <div className="px-3 sm:px-6 pt-3">
                <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex gap-3 items-start">
                  <span className="text-primary text-sm font-medium shrink-0">TL;DR</span>
                  <p className="text-sm leading-relaxed">{displayVersion.summary}</p>
                </div>
              </div>
            )}

            {/* Output */}
            <div className="px-3 sm:px-6 py-4 sm:py-6">
              {displayVersion ? (
                <MarkdownRenderer content={displayVersion.content} className="text-sm sm:text-base" />
              ) : (
                <div className="flex items-center justify-center min-h-[200px] text-muted-foreground text-sm">
                  {working ? `${name} has not produced an answer yet.` : task.status === 'processing' ? 'Processing...' : 'No output yet'}
                </div>
              )}
            </div>
          </div>

          {/* Fixed Action Bar */}
          {showActions && (
            <div className="flex-shrink-0 border-t bg-background px-3 sm:px-6 py-3 sm:py-4 pb-safe">
              <div className="space-y-2 sm:space-y-3">
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={`Reply to ${name}: feedback, questions or changes…`}
                  rows={2}
                  disabled={!canRevise}
                  className="resize-none text-sm max-h-[200px] overflow-y-auto"
                />

                <div className="flex flex-col sm:flex-row gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleRevise}
                        disabled={!feedback.trim() || !canRevise || isSubmitting}
                        variant="outline"
                        className="flex-1 h-11 sm:h-10"
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Reply to {name} ({task.current_version}/{task.max_revisions})</span>
                        <span className="sm:hidden">Reply ({task.current_version}/{task.max_revisions})</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {canRevise
                        ? <>Send your reply to {name} in the same conversation <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd></>
                        : `Maximum ${task.max_revisions} revisions reached`}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleApprove}
                        disabled={isSubmitting}
                        className="flex-1 h-11 sm:h-10"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Approve & Save to Note</span>
                        <span className="sm:hidden">Approve & Save</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Accept this output and optionally save as a note <kbd className="ml-1 text-[10px] opacity-60">⌘S</kbd>
                    </TooltipContent>
                  </Tooltip>

                  <div className="flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={handleCopy}
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 sm:h-10 sm:w-10"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy output to clipboard</TooltipContent>
                    </Tooltip>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-11 w-11 sm:h-10 sm:w-10">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {outputs.length > 1 && (
                          <DropdownMenuItem onClick={() => setSelectedVersion(selectedVersion === null ? 1 : null)}>
                            <History className="h-4 w-4 mr-2" />
                            View History
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={handleReject} className="text-destructive">
                          <X className="h-4 w-4 mr-2" />
                          Reject Task
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Task
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SaveToNoteDialog
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        taskId={taskId}
        defaultTitle={task?.title || ''}
        onSaved={handleNoteSaved}
      />
    </>
  );
}
