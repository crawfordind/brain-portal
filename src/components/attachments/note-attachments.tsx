'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileUpload } from './file-upload';
import { AttachmentCard } from './attachment-card';
import { AttachmentViewer } from './attachment-viewer';
import { Button } from '@/components/ui/button';
import { Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/lib/db/schema';
import { useDeleteAttachment } from '@/hooks/use-delete-attachment';
import {
  ATTACHMENTS_CHANGED_EVENT,
  type AttachmentsChangedDetail,
} from '@/lib/attachments/upload-client';

interface NoteAttachmentsProps {
  noteId: string;
  projectId?: string | null;
  /** False for someone who may read the note but not change it: no upload. */
  canEdit?: boolean;
  className?: string;
}

export function NoteAttachments({ noteId, projectId, canEdit = true, className }: NoteAttachmentsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const deleteAttachment = useDeleteAttachment();

  const fetchAttachments = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ noteId });
      const response = await fetch(`/api/attachments?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAttachments(data.attachments || []);
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error);
    } finally {
      setIsLoading(false);
    }
  }, [noteId]);

  // Loaded up front so the header's count is right before it is opened, and
  // again whenever a file is added or removed elsewhere on the page (the
  // editor's picker, the side panel).
  useEffect(() => {
    fetchAttachments();
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<AttachmentsChangedDetail>).detail;
      if (!detail?.noteId || detail.noteId === noteId) fetchAttachments();
    };
    window.addEventListener(ATTACHMENTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ATTACHMENTS_CHANGED_EVENT, onChanged);
  }, [noteId, fetchAttachments]);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  const handleUploadComplete = (attachment: Attachment) => {
    setAttachments((prev) =>
      prev.some((att) => att.id === attachment.id) ? prev : [attachment, ...prev]
    );
  };

  const handleDelete = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  return (
    <div className={cn('border rounded-lg', className)}>
      {/* Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Paperclip className="size-5 text-muted-foreground" />
          <span className="font-medium">
            Attachments
            {attachments.length > 0 && (
              <span className="ml-2 text-sm text-muted-foreground">({attachments.length})</span>
            )}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="size-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-5 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4 border-t">
          {/* Upload Section */}
          {canEdit && (
            <FileUpload
              onUploadComplete={handleUploadComplete}
              projectId={projectId}
              noteId={noteId}
              maxFiles={5}
            />
          )}

          {/* Existing Attachments */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading attachments...</div>
          ) : attachments.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Attached Files</h3>
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <AttachmentCard
                    key={attachment.id}
                    attachment={attachment}
                    variant="compact"
                    onDelete={attachment.can_manage === false ? undefined : handleDelete}
                    onView={setSelectedAttachment}
                  />
                ))}
              </div>
            </div>
          ) : !canEdit ? (
            <div className="text-center py-4 text-sm text-muted-foreground">No files attached</div>
          ) : null}
        </div>
      )}

      {/* Viewer Modal */}
      {selectedAttachment && (
        <AttachmentViewer
          attachment={selectedAttachment}
          isOpen={true}
          onClose={() => setSelectedAttachment(null)}
          onDelete={
            selectedAttachment.can_manage === false
              ? undefined
              : async () => {
                  if (await deleteAttachment(selectedAttachment)) {
                    handleDelete(selectedAttachment.id);
                    setSelectedAttachment(null);
                  }
                }
          }
        />
      )}
    </div>
  );
}
