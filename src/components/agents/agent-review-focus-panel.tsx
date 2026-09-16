'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import { Check, Edit, X, Copy, ChevronDown, ChevronUp, MoreVertical, History, Trash2, Info, ExternalLink } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useConfirm } from '@/components/ui/confirm-dialog';


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

  const { data, isLoading } = useQuery({
    queryKey: ['agent-task', taskId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-tasks/${taskId}`);
      if (!res.ok) throw new Error('Failed to fetch task');
      return res.json();
    },
    enabled: open && !!taskId,
  });

  const task = data?.task;
  const outputs = data?.outputs || [];
  const contextNotes: Array<{ id: string; title: string; slug: string }> = data?.contextNotes || [];
  const contextUsed: Array<{ id: string; title: string; similarity: number }> = data?.contextUsed || [];
  const sourceEntity: { id: string; type: string; title: string; url: string } | null = data?.sourceEntity || null;
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
      if (!res.ok) throw new Error('Failed to request revision');
      toast.success('Revision requested, agent is working on it...');
      setFeedback('');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });
    } catch {
      toast.error('Failed to request revision');
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
      if (!res.ok) throw new Error('Failed to reject');
      toast.success('Task rejected');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      onClose();
    } catch {
      toast.error('Failed to reject task');
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
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      onClose();
    } catch {
      toast.error('Failed to delete task');
    } finally {
      setIsSubmitting(false);
    }
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
  const showActions = task.status === 'awaiting_review' || task.status === 'revision_requested';

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent size="immersive" className="max-w-5xl h-[100dvh] sm:h-[90vh] p-0 flex flex-col overflow-hidden" showCloseButton={false}>
          <DialogTitle className="sr-only">{task.title}</DialogTitle>
          {/* Header - Fixed */}
          <div className="flex-shrink-0 border-b px-3 sm:px-6 py-3 sm:py-4">
            <ModalHeader title={task.title} onClose={onClose} showClose />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="bg-purple-500 text-white text-xs">
                {task.status.replace(/_/g, ' ')}
              </Badge>
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
                  Context used by agent
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
                  {task.status === 'processing' ? 'Processing...' : 'No output yet'}
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
                  placeholder="What changes would you like?"
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
                        <span className="hidden sm:inline">Request Revision ({task.current_version}/{task.max_revisions})</span>
                        <span className="sm:hidden">Revise ({task.current_version}/{task.max_revisions})</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {canRevise
                        ? <>Send feedback and get a revised version <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd></>
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
