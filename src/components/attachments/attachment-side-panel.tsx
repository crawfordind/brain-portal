'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Star } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AttachmentSidePanelProps {
  noteId: string;
  projectId?: string | null;
  onInsert?: (attachment: Attachment) => void;
  onUploadClick?: () => void;
  className?: string;
}

export function AttachmentSidePanel({
  noteId,
  projectId,
  onInsert,
  onUploadClick,
  className,
}: AttachmentSidePanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchAttachments();
  }, [noteId]);

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

  const handlePin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/api/attachments/${id}/pin`, {
        method: 'POST',
      });
      if (response.ok) {
        const data = await response.json();
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, is_pinned: data.pinned } : a))
        );
        toast.success(data.pinned ? 'Pinned' : 'Unpinned');
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      toast.error('Failed to update pin status');
    }
  };

  const handleClick = (attachment: Attachment) => {
    if (onInsert) {
      onInsert(attachment);
      toast.success('Inserted into note');
    }
  };

  const getFileIcon = (attachment: Attachment) => {
    switch (attachment.file_type) {
      case 'image':
        return (
          <img
            src={attachment.storage_url}
            alt={attachment.filename}
            className="w-full h-full object-cover"
          />
        );
      case 'pdf':
        return <div className="text-2xl">📑</div>;
      case 'document':
        return <div className="text-2xl">📄</div>;
      case 'audio':
        return <div className="text-2xl">🎵</div>;
      case 'video':
        return <div className="text-2xl">🎬</div>;
      default:
        return <div className="text-2xl">📎</div>;
    }
  };

  // Sort: pinned first, then by date
  const sortedAttachments = [...attachments].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className={cn('w-[120px] border-r bg-muted/30 flex flex-col', className)}>
      {/* Header */}
      <div className="p-2 border-b">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          onClick={onUploadClick}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Thumbnails */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading ? (
            <div className="text-xs text-center text-muted-foreground py-4">
              Loading...
            </div>
          ) : sortedAttachments.length === 0 ? (
            <div className="text-xs text-center text-muted-foreground py-8">
              <div className="text-2xl mb-2">📎</div>
              <div>No files yet</div>
              <div className="mt-1">Click + to upload</div>
            </div>
          ) : (
            sortedAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative group cursor-pointer"
                onClick={() => handleClick(attachment)}
                title={attachment.filename}
              >
                <div className="w-[96px] h-[96px] rounded-lg border-2 border-border hover:border-primary transition-colors overflow-hidden bg-background flex items-center justify-center">
                  {getFileIcon(attachment)}
                </div>

                {/* Pin indicator */}
                {attachment.is_pinned && (
                  <Star className="absolute top-1 right-1 size-4 text-yellow-500 fill-yellow-500" />
                )}

                {/* Pin button (on hover) */}
                <button
                  onClick={(e) => handlePin(attachment.id, e)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 rounded p-1"
                >
                  <Star
                    className={cn(
                      'size-3',
                      attachment.is_pinned
                        ? 'text-yellow-500 fill-yellow-500'
                        : 'text-muted-foreground'
                    )}
                  />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t text-xs text-center text-muted-foreground">
        {sortedAttachments.length}/{attachments.length}
      </div>
    </div>
  );
}
