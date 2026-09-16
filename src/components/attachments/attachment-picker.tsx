'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FileUpload } from './file-upload';
import { AttachmentCard } from './attachment-card';
import { Upload, Grid3x3, Clock, Search, ArrowRight } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
import Link from 'next/link';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ModalHeader } from '@/components/modals/modal-header';
import { useMobile } from '@/hooks/use-mobile';

interface AttachmentPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (attachments: Attachment[]) => void;
  projectId?: string | null;
  noteId?: string | null;
  allowMultiple?: boolean;
}

export function AttachmentPicker({
  open,
  onClose,
  onSelect,
  projectId,
  noteId,
  allowMultiple = true,
}: AttachmentPickerProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'browse' | 'recent'>('browse');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const isMobile = useMobile();

  const fetchAttachments = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (fileTypeFilter !== 'all') params.append('fileType', fileTypeFilter);
      params.append('limit', '20');

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
  }, [searchQuery, fileTypeFilter]);

  useEffect(() => {
    if (open) {
      fetchAttachments();
      setSelectedIds(new Set());
    }
  }, [open, fetchAttachments]);

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      if (!allowMultiple) {
        newSet.clear();
      }
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleInsert = () => {
    const selected = attachments.filter((a) => selectedIds.has(a.id));
    onSelect(selected);
    onClose();
  };

  const handleUploadComplete = (attachment: Attachment) => {
    // Auto-select newly uploaded file
    setSelectedIds(new Set([attachment.id]));
    // Add to list
    setAttachments((prev) => [attachment, ...prev]);
    // Switch to browse tab to show it
    setActiveTab('browse');
  };

  const recentAttachments = attachments.slice(0, 10);

  const PickerContent = () => (
    <>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'browse' | 'recent')}>
          <TabsList>
            <TabsTrigger value="browse" className="gap-2">
              <Grid3x3 className="size-4" />
              Browse
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="size-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="recent" className="gap-2">
              <Clock className="size-4" />
              Recent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <FileUpload
              onUploadComplete={handleUploadComplete}
              projectId={projectId}
              noteId={noteId}
              maxFiles={5}
            />
          </TabsContent>

          <TabsContent value="browse" className="mt-4 space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                  <SelectItem value="pdf">PDFs</SelectItem>
                  <SelectItem value="document">Documents</SelectItem>
                  <SelectItem value="audio">Audio</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-3'} gap-3 max-h-[400px] overflow-y-auto`}>
              {isLoading ? (
                <div className="col-span-3 text-center py-8 text-muted-foreground">
                  Loading...
                </div>
              ) : attachments.length === 0 ? (
                <div className="col-span-3 text-center py-8 text-muted-foreground">
                  No files found
                </div>
              ) : (
                attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    onClick={() => handleToggleSelect(attachment.id)}
                    className="cursor-pointer"
                  >
                    <AttachmentCard
                      attachment={attachment}
                      variant="grid"
                      selected={selectedIds.has(attachment.id)}
                    />
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="recent" className="mt-4">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {recentAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  onClick={() => handleToggleSelect(attachment.id)}
                  className="cursor-pointer"
                >
                  <AttachmentCard
                    attachment={attachment}
                    variant="compact"
                    selected={selectedIds.has(attachment.id)}
                  />
                </div>
              ))}
            </div>
          </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between border-t pt-4">
        <Link href="/attachments" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          Browse All Files <ArrowRight className="size-3" />
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={selectedIds.size === 0}>
            Insert {selectedIds.size > 0 && `(${selectedIds.size})`}
          </Button>
        </div>
      </div>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
          <SheetTitle className="sr-only">Add Attachment</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Add Attachment"
                onClose={onClose}
                showClose={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <PickerContent />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Standard Dialog
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        <DialogTitle className="sr-only">Add Attachment</DialogTitle>
        <ModalHeader title="Add Attachment" onClose={onClose} showClose={false} />
        <PickerContent />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Insert attachment markdown reference into TipTap editor
 */
export function insertAttachmentReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  attachment: Attachment
): void {
  if (!editor) return;

  const isImage = attachment.file_type === 'image';
  const url = attachment.storage_url;
  const title = attachment.filename;

  if (isImage) {
    // Insert image
    editor
      .chain()
      .focus()
      .setImage({ src: url, alt: title })
      .run();
  } else {
    // Insert link
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'text',
        text: title,
        marks: [{ type: 'link', attrs: { href: url } }],
      })
      .run();
  }
}
