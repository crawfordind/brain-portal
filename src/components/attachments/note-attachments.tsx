'use client';

import { useState } from 'react';
import { FileUpload } from './file-upload';
import { AttachmentCard } from './attachment-card';
import { AttachmentViewer } from './attachment-viewer';
import { Button } from '@/components/ui/button';
import { Paperclip, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/lib/db/schema';

interface NoteAttachmentsProps {
  noteId: string;
  projectId?: string | null;
  className?: string;
}

export function NoteAttachments({ noteId, projectId, className }: NoteAttachmentsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const fetchAttachments = async () => {
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
  };

  const handleToggle = async () => {
    if (!isExpanded && attachments.length === 0) {
      await fetchAttachments();
    }
    setIsExpanded(!isExpanded);
  };

  const handleUploadComplete = (attachment: Attachment) => {
    setAttachments((prev) => [attachment, ...prev]);
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
          <FileUpload
            onUploadComplete={handleUploadComplete}
            projectId={projectId}
            noteId={noteId}
            maxFiles={5}
          />

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
                    onDelete={handleDelete}
                    onView={setSelectedAttachment}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Viewer Modal */}
      {selectedAttachment && (
        <AttachmentViewer
          attachment={selectedAttachment}
          isOpen={true}
          onClose={() => setSelectedAttachment(null)}
          onDelete={() => {
            handleDelete(selectedAttachment.id);
            setSelectedAttachment(null);
          }}
        />
      )}
    </div>
  );
}
