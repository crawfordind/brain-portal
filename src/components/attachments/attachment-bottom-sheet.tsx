'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { FileUpload } from './file-upload';
import { Upload, ArrowRight } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ModalHeader } from '@/components/modals/modal-header';

interface AttachmentBottomSheetProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  projectId?: string | null;
  onInsert?: (attachment: Attachment) => void;
}

export function AttachmentBottomSheet({
  open,
  onClose,
  noteId,
  projectId,
  onInsert,
}: AttachmentBottomSheetProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAttachments();
      setShowUpload(false);
    }
  }, [open, noteId]);

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

  const handleUploadComplete = (attachment: Attachment) => {
    setAttachments((prev) => [attachment, ...prev]);
    setShowUpload(false);
    if (onInsert) {
      onInsert(attachment);
      toast.success('Uploaded and inserted');
      onClose();
    }
  };

  const handleClick = (attachment: Attachment) => {
    if (onInsert) {
      onInsert(attachment);
      toast.success('Inserted into note');
      onClose();
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
        return <div className="text-3xl">📑</div>;
      case 'document':
        return <div className="text-3xl">📄</div>;
      case 'audio':
        return <div className="text-3xl">🎵</div>;
      case 'video':
        return <div className="text-3xl">🎬</div>;
      default:
        return <div className="text-3xl">📎</div>;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
        <SheetTitle className="sr-only">Attachments</SheetTitle>
        <div className="flex flex-col h-full">
          <div className="p-4 border-b">
            <ModalHeader
              title={`Attachments (${attachments.length})`}
              onClose={onClose}
              showClose={false}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex gap-2">
              <Button
                variant={showUpload ? 'default' : 'outline'}
                onClick={() => setShowUpload(true)}
                className="flex-1"
              >
                <Upload className="size-4 mr-2" />
                Upload New
              </Button>
              <Button variant="outline" asChild>
                <Link href="/attachments">
                  Browse All <ArrowRight className="size-4 ml-2" />
                </Link>
              </Button>
            </div>

            {showUpload ? (
              <FileUpload
                onUploadComplete={handleUploadComplete}
                projectId={projectId}
                noteId={noteId}
                maxFiles={5}
              />
            ) : (
              <div className="grid grid-cols-3 gap-3 overflow-y-auto max-h-[50vh]">
                {isLoading ? (
                  <div className="col-span-3 text-center py-8 text-muted-foreground">
                    Loading...
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="col-span-3 text-center py-12 text-muted-foreground">
                    <div className="text-4xl mb-3">📎</div>
                    <div>No attachments yet</div>
                    <div className="text-sm mt-2">Tap &quot;Upload New&quot; to add files</div>
                  </div>
                ) : (
                  attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      onClick={() => handleClick(attachment)}
                      className="cursor-pointer"
                    >
                      <div className="aspect-square rounded-lg border-2 border-border active:border-primary transition-colors overflow-hidden bg-background flex flex-col items-center justify-center p-2">
                        <div className="flex-1 flex items-center justify-center">
                          {getFileIcon(attachment)}
                        </div>
                        <div className="text-xs text-center truncate w-full mt-2">
                          {attachment.filename.split('.')[0]}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="text-xs text-center text-muted-foreground">
              Tap to insert • Long-press for options
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
