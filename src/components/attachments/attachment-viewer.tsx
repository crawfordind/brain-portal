'use client';

import { X, Download, ExternalLink, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ModalDragHandle, FloatingActions, ModalHeader } from '@/components/modals';
import { Button } from '@/components/ui/button';
import type { Attachment } from '@/lib/db/schema';
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';
import { useMobile } from '@/hooks/use-mobile';
import { AttachmentPreview } from '@/components/attachments/attachment-preview';
import { AttachmentMetadata } from '@/components/attachments/attachment-metadata';

interface AttachmentViewerProps {
  attachment: Attachment;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: () => void;
}

export function AttachmentViewer({
  attachment,
  isOpen,
  onClose,
  onDelete,
}: AttachmentViewerProps) {
  const isMobile = useMobile();

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = attachment.storage_url;
    link.download = attachment.filename;
    link.click();
  };

  const handleOpen = () => {
    window.open(attachment.storage_url, '_blank', 'noopener,noreferrer');
  };

  if (isMobile) {
    const actions = [
      {
        icon: <Download className="size-5" />,
        label: 'Download',
        onClick: handleDownload,
      },
      {
        icon: <ExternalLink className="size-5" />,
        label: 'Open',
        onClick: handleOpen,
      },
      ...(onDelete
        ? [
            {
              icon: <Trash2 className="size-5" />,
              label: 'Delete',
              onClick: onDelete,
              variant: 'destructive' as const,
            },
          ]
        : []),
    ];

    return (
      <Sheet open onOpenChange={onClose}>
        <SheetContent
          side="bottom"
          className="h-[90vh] p-0 gap-0"
          dismissible
        >
          <SheetTitle className="sr-only">{attachment.filename}</SheetTitle>
          <div className="flex flex-col h-full">
            {/* Drag Handle */}
            <div className="pt-2 pb-4 flex justify-center">
              <ModalDragHandle data-testid="drag-handle" />
            </div>

            {/* Header */}
            <div className="px-4 pb-4">
              <ModalHeader
                title={attachment.filename}
                subtitle={`${formatFileSize(attachment.file_size)} • ${formatDate(attachment.created_at)}`}
                onClose={onClose}
                showClose={false}
              />
            </div>

            {/* Preview Zone */}
            <div className="relative flex-1 bg-muted/30">
              <div className="h-full flex items-center justify-center p-4">
                <AttachmentPreview
                  attachment={attachment}
                  onDownload={handleDownload}
                />
              </div>

              {/* Floating Actions */}
              <FloatingActions actions={actions} position="bottom" />
            </div>

            {/* Metadata Zone (Collapsible) */}
            <div className="border-t bg-card p-4 overflow-y-auto max-h-[40vh]">
              <AttachmentMetadata attachment={attachment} collapsible />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        size="immersive"
        className="max-h-[85vh] p-0 gap-0 flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{attachment.filename}</DialogTitle>
        {/* Custom Header */}
        <div className="flex items-start gap-4 p-6 border-b shrink-0">
          {/* Title and subtitle */}
          <div className="flex-1 min-w-0">
            <h2
              className="text-lg font-semibold truncate mb-1"
              title={attachment.filename}
            >
              {attachment.filename}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatFileSize(attachment.file_size)} • {attachment.mime_type}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              aria-label="Download"
            >
              <a href={attachment.storage_url} download={attachment.filename}>
                <Download className="size-4" />
              </a>
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              aria-label="Open in new tab"
            >
              <a href={attachment.storage_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>

            {onDelete && (
              <Button variant="outline" size="sm" onClick={onDelete}>
                <Trash2 className="size-4 mr-2" />
                Delete
              </Button>
            )}

            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {/* Content area with preview and metadata sidebar */}
        <div className="flex-1 overflow-hidden flex">
          {/* Preview area - 2/3 width on desktop */}
          <div className="flex-[2] overflow-auto flex items-center justify-center bg-muted/30 p-6">
            <AttachmentPreview attachment={attachment} />
          </div>

          {/* Metadata sidebar - 1/3 width on desktop */}
          <div className="flex-1 border-l overflow-y-auto">
            <AttachmentMetadata attachment={attachment} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
