"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AttachmentSidePanel } from '@/components/attachments/attachment-side-panel';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import { NoteAttachments } from '@/components/attachments/note-attachments';
import { ShareDialog } from "@/components/notes/share-dialog";
import { CleanupModal } from "@/components/notes/cleanup-modal";
import { AnalysisModal } from "@/components/notes/analysis-modal";
import type { Attachment } from '@/lib/db/schema';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Save,
  MoreHorizontal,
  Trash2,
  Pin,
  Archive,
  Clock,
  FileText,
  Share2,
  Sparkles,
  Eye,
  FolderOpen,
  Brain,
  Bot,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import Link from "next/link";
import { VoiceInput } from "@/components/ui/voice-input";
import { SaveStatus } from "@/components/ui/save-status";
import { addToQueue } from "@/lib/offline/simple-queue";
import { useAutoSave } from "@/hooks/use-auto-save";
import { useProjects } from "@/hooks/use-projects";
import { useMobile } from "@/hooks/use-mobile";
import { useAskAbout } from "@/hooks/use-ask-about";
import { AgentReviewFocusPanel } from "@/components/agents/agent-review-focus-panel";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface Note {
  id: string;
  title: string;
  slug: string;
  content: string;
  note_type: string;
  word_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
  share_token: string | null;
  shared_at: string | null;
}

export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const slug = params.slug as string;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const { askAbout } = useAskAbout();
  const [reviewingTaskId, setReviewingTaskId] = useState<string | null>(null);

  const { data: projects } = useProjects();
  const isMobile = useMobile();

  // Fetch note — the API handles both owned and shared-project notes
  const { data, isLoading, error } = useQuery({
    queryKey: ["note", slug],
    queryFn: async () => {
      const response = await fetch(`/api/notes/${slug}`);
      if (!response.ok) throw new Error("Note not found");
      return response.json();
    },
  });

  const note = data?.note as Note | undefined;
  // canEdit comes from the API: true for owner + project editors, false for viewers
  const canEditNote: boolean = data?.canEdit ?? true;

  // Fetch linked AI agent tasks for this note
  const { data: delegationData } = useQuery({
    queryKey: ["note-delegations", note?.id],
    queryFn: async () => {
      const res = await fetch(`/api/agent-tasks?sourceType=note&sourceId=${note!.id}`);
      if (!res.ok) return { tasks: [] };
      return res.json();
    },
    enabled: !!note?.id,
  });
  const linkedAgentTasks = (delegationData?.tasks || []) as Array<{
    id: string;
    title: string;
    status: string;
    assigned_agent: string;
    updated_at: string;
  }>;

  // Handle attachment insertion
  const handleInsertAttachment = (attachment: Attachment) => {
    if (!note) return;

    // Insert at cursor in editor
    let insertText = '';
    if (attachment.file_type === 'image') {
      insertText = `![${attachment.description || attachment.filename}](${attachment.storage_url})`;
    } else {
      insertText = `[${attachment.filename}](${attachment.storage_url})`;
    }

    // Append to content for now (editor will handle cursor position)
    setContent((prev) => prev + '\n\n' + insertText);
  };

  // Auto-save with debouncing
  const autoSave = useAutoSave({
    data: { title, content },
    onSave: async (data) => {
      if (!note?.id) return;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`/api/notes/${note.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          // Only invalidate notes list, not the current note to preserve cursor position
          queryClient.invalidateQueries({ queryKey: ["notes"] });
        } else {
          throw new Error("Server error");
        }
      } catch {
        addToQueue({
          type: "note",
          operation: "update",
          data: { id: note.id, ...data },
        });
      }
    },
    delay: 1000,
    enabled: !!note?.id && canEditNote, // Disable auto-save for viewers
  });

  // Set initial values when note loads or changes (e.g. after server refetch)
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note]);

  const hasChanges = useMemo(() => {
    if (!note) return false;
    return title !== note.title || content !== note.content;
  }, [title, content, note]);

  // Simple save function
  const saveNote = async () => {
    if (!note?.id || !hasChanges || isSaving) return;

    // Cancel any pending auto-save
    autoSave.cancelPending();

    setIsSaving(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`/api/notes/${note.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        toast.success("Saved!");
        queryClient.invalidateQueries({ queryKey: ["note", slug] });
        queryClient.invalidateQueries({ queryKey: ["notes"] });
      } else {
        throw new Error("Server error");
      }
    } catch {
      toast.error("Save failed — queued for retry");
      addToQueue({
        type: "note",
        operation: "update",
        data: { id: note.id, title, content },
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Simple delete function
  const deleteNote = async () => {
    if (!note?.id) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`/api/notes/${note.id}`, {
        method: "DELETE",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        toast.success("Note deleted");
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        router.push("/notes");
      } else {
        throw new Error("Server error");
      }
    } catch {
      toast.error("Delete failed — queued for retry");
      addToQueue({
        type: "note",
        operation: "delete",
        data: { id: note.id },
      });
    }
  };

  // Pin/Archive mutations
  const togglePinMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${note?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPinned: !note?.is_pinned }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      queryClient.invalidateQueries({ queryKey: ["notes", "pinned"] });
      toast.success(note?.is_pinned ? "Unpinned" : "Pinned");
    },
  });

  const toggleArchiveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/notes/${note?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: !note?.is_archived }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      toast.success(note?.is_archived ? "Unarchived" : "Archived");
      if (!note?.is_archived) router.push("/notes");
    },
  });

  const moveToProjectMutation = useMutation({
    mutationFn: async (projectId: string | null) => {
      const response = await fetch(`/api/notes/${note?.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) throw new Error("Failed to update");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["note", slug] });
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["notes", "pinned"] });
      toast.success("Project updated");
    },
  });

  // Auto-save with debounce
  const handleSave = useCallback(() => {
    saveNote();
  }, [note?.id, hasChanges, isSaving, title, content]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 flex-1" />
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Note not found</h2>
        <p className="text-muted-foreground mb-4">
          This note may have been deleted or doesn&apos;t exist.
        </p>
        <Button asChild>
          <Link href="/notes">Back to Notes</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header - MOBILE: Stack on small screens */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          {/* TOUCH: Larger back button on mobile */}
          <Button variant="ghost" size="icon" asChild className="min-h-10 min-w-10 md:min-h-9 md:min-w-9 shrink-0">
            <Link href="/notes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Input
            value={title}
            onChange={(e) => canEditNote && setTitle(e.target.value)}
            readOnly={!canEditNote}
            className="text-lg md:text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0 h-auto min-w-0"
            placeholder="Note title..."
          />
        </div>

        {/* Action buttons - MOBILE: Full width row on small screens */}
        <div className="flex items-center gap-2 justify-between sm:justify-end">
          {/* View-only badge for collaborators without edit access */}
          {!canEditNote && (
            <Badge variant="secondary" className="flex items-center gap-1 shrink-0">
              <Eye className="h-3 w-3" />
              View only
            </Badge>
          )}
          {canEditNote && (
            <SaveStatus status={autoSave.status} lastSaved={autoSave.lastSaved} />
          )}
          <div className="flex items-center gap-2">
            {canEditNote && (
              <VoiceInput
                onTranscript={(text) => {
                  setContent((prev) => prev ? `${prev}\n\n${text}` : text);
                  toast.success("Voice added to note");
                }}
                size="default"
              />
            )}
            {canEditNote && (
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="min-h-11 md:min-h-9"
              >
                <Save className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">{isSaving ? "Saving..." : "Save"}</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEditNote && (
                  <>
                    <DropdownMenuItem onClick={() => setShowCleanupModal(true)}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      AI Cleanup
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setShowAnalysisModal(true)}>
                      <Brain className="h-4 w-4 mr-2" />
                      Deep Analysis
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        askAbout({
                          id: note.id,
                          type: "note",
                          title: note.title,
                          content: content || note.content,
                        })
                      }
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Ask about this note
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => togglePinMutation.mutate()}>
                      <Pin className="h-4 w-4 mr-2" />
                      {note.is_pinned ? "Unpin" : "Pin"}
                    </DropdownMenuItem>
                    {isMobile ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4" />
                          Move to Project
                        </DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={note.project_id ?? "none"}
                          onValueChange={(value) =>
                            moveToProjectMutation.mutate(value === "none" ? null : value)
                          }
                        >
                          <DropdownMenuRadioItem value="none">
                            None
                          </DropdownMenuRadioItem>
                          {projects?.map((project) => (
                            <DropdownMenuRadioItem key={project.id} value={project.id}>
                              <span className="flex items-center gap-2">
                                {project.color && (
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: project.color }}
                                  />
                                )}
                                {project.name}
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                      </>
                    ) : (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderOpen className="h-4 w-4 mr-2" />
                          Move to Project
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuRadioGroup
                            value={note.project_id ?? "none"}
                            onValueChange={(value) =>
                              moveToProjectMutation.mutate(value === "none" ? null : value)
                            }
                          >
                            <DropdownMenuRadioItem value="none">
                              None
                            </DropdownMenuRadioItem>
                            {projects?.map((project) => (
                              <DropdownMenuRadioItem key={project.id} value={project.id}>
                                <span className="flex items-center gap-2">
                                  {project.color && (
                                    <span
                                      className="h-2 w-2 rounded-full shrink-0"
                                      style={{ backgroundColor: project.color }}
                                    />
                                  )}
                                  {project.name}
                                </span>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem onClick={() => toggleArchiveMutation.mutate()}>
                      <Archive className="h-4 w-4 mr-2" />
                      {note.is_archived ? "Unarchive" : "Archive"}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => setShowShareDialog(true)}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </DropdownMenuItem>
                {canEditNote && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        const ok = await confirm({ title: "Delete this note?", description: "This cannot be undone.", destructive: true, confirmLabel: "Delete" });
                        if (ok) deleteNote();
                      }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* AI Agent Tasks Banner */}
      {linkedAgentTasks.length > 0 && (
        <div className="space-y-2">
          {linkedAgentTasks.map((agentTask) => (
            <button
              key={agentTask.id}
              onClick={() => setReviewingTaskId(agentTask.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
            >
              <Bot className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">AI Feedback</span>
                <span className="text-xs text-muted-foreground ml-2">
                  by {agentTask.assigned_agent}
                </span>
              </div>
              <Badge
                variant={agentTask.status === 'awaiting_review' ? 'default' : 'secondary'}
                className="text-xs shrink-0"
              >
                {agentTask.status === 'awaiting_review' ? 'Review' :
                 agentTask.status === 'processing' ? 'Working...' :
                 agentTask.status === 'approved' ? 'Done' :
                 agentTask.status.replace(/_/g, ' ')}
              </Badge>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Metadata - MOBILE: Horizontally scrollable */}
      <div className="flex items-center gap-3 md:gap-4 text-xs md:text-sm text-muted-foreground overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible scrollbar-hide">
        <div className="flex items-center gap-1 shrink-0">
          <Clock className="h-3 w-3" />
          {/* RESPONSIVE: Shorter format on mobile */}
          <span className="hidden md:inline">Updated {format(new Date(note.updated_at), "MMM d, yyyy 'at' h:mm a")}</span>
          <span className="md:hidden">{format(new Date(note.updated_at), "MMM d, h:mm a")}</span>
        </div>
        {note.project_name && (
          <Badge variant="secondary" className="shrink-0">{note.project_name}</Badge>
        )}
        {note.note_type !== "note" && (
          <Badge variant="outline" className="shrink-0">{note.note_type}</Badge>
        )}
        <span className="shrink-0">{note.word_count} words</span>
      </div>

      {/* Desktop: Side Panel + Editor */}
      <div className="hidden lg:flex gap-0">
        <AttachmentSidePanel
          noteId={note.id}
          projectId={note.project_id}
          onInsert={handleInsertAttachment}
          onUploadClick={() => setShowUploadModal(true)}
          className="min-h-[500px]"
        />

        <div className="flex-1">
          <MarkdownEditor
            content={content}
            onChange={canEditNote ? setContent : () => {}}
            placeholder="Start writing..."
            autoFocus
            editable={canEditNote}
            projectId={note.project_id}
            noteId={note.id}
          />
        </div>
      </div>

      {/* Mobile: Editor + attachment section below */}
      <div className="lg:hidden space-y-4">
        <MarkdownEditor
          content={content}
          onChange={canEditNote ? setContent : () => {}}
          placeholder="Start writing..."
          autoFocus
          editable={canEditNote}
          projectId={note.project_id}
          noteId={note.id}
        />
        {canEditNote && (
          <NoteAttachments
            noteId={note.id}
            projectId={note.project_id}
          />
        )}
      </div>

      {/* Upload Modal (desktop side panel trigger) */}
      <AttachmentPicker
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSelect={(attachments) => {
          attachments.forEach(handleInsertAttachment);
          setShowUploadModal(false);
        }}
        projectId={note.project_id}
        noteId={note.id}
      />

      {/* Share Dialog */}
      <ShareDialog
        noteId={note.id}
        slug={slug}
        isShared={!!note.share_token}
        shareToken={note.share_token}
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
      />

      {/* Cleanup Modal */}
      <CleanupModal
        open={showCleanupModal}
        onOpenChange={setShowCleanupModal}
        noteId={note.id}
        onApplied={() => {
          queryClient.invalidateQueries({ queryKey: ["note", slug] });
        }}
      />

      {/* Deep Analysis Modal */}
      <AnalysisModal
        open={showAnalysisModal}
        onOpenChange={setShowAnalysisModal}
        noteId={note.id}
        noteTitle={note.title}
        onSaved={(newSlug) => {
          queryClient.invalidateQueries({ queryKey: ["notes"] });
          router.push(`/notes/${newSlug}`);
        }}
      />

      {/* AI Review Panel */}
      {reviewingTaskId && (
        <AgentReviewFocusPanel
          taskId={reviewingTaskId}
          open={!!reviewingTaskId}
          onClose={() => {
            setReviewingTaskId(null);
            queryClient.invalidateQueries({ queryKey: ["note-delegations", note.id] });
          }}
        />
      )}
    </div>
  );
}
