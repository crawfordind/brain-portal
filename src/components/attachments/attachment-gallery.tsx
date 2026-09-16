'use client';

import { useState, useEffect } from 'react';
import { Search, Grid3x3, List, Filter, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AttachmentCard } from './attachment-card';
import { AttachmentViewer } from './attachment-viewer';
import { cn } from '@/lib/utils';
import { parseUTCDate } from '@/lib/utils/date';
import type { Attachment } from '@/lib/db/schema';

interface AttachmentGalleryProps {
  projectId?: string | null;
  noteId?: string | null;
  className?: string;
}

type ViewMode = 'grid' | 'list';
type FileTypeFilter = 'all' | 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';
type SortBy = 'created' | 'updated' | 'filename' | 'size';

export function AttachmentGallery({ projectId, noteId, className }: AttachmentGalleryProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [filteredAttachments, setFilteredAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  // Fetch attachments
  useEffect(() => {
    fetchAttachments();
  }, [projectId, noteId]);

  // Filter and sort attachments
  useEffect(() => {
    let filtered = [...attachments];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (att) =>
          att.filename.toLowerCase().includes(query) ||
          att.description?.toLowerCase().includes(query) ||
          att.content_plain?.toLowerCase().includes(query)
      );
    }

    // Apply file type filter
    if (fileTypeFilter !== 'all') {
      filtered = filtered.filter((att) => att.file_type === fileTypeFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'filename':
          return a.filename.localeCompare(b.filename);
        case 'size':
          return b.file_size - a.file_size;
        case 'updated':
          return parseUTCDate(b.updated_at).getTime() - parseUTCDate(a.updated_at).getTime();
        case 'created':
        default:
          return parseUTCDate(b.created_at).getTime() - parseUTCDate(a.created_at).getTime();
      }
    });

    setFilteredAttachments(filtered);
  }, [attachments, searchQuery, fileTypeFilter, sortBy]);

  const fetchAttachments = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (noteId) params.set('noteId', noteId);

      const response = await fetch(`/api/attachments?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch attachments');

      const data = await response.json();
      setAttachments(data.attachments || []);
    } catch (error) {
      console.error('Error fetching attachments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    setAttachments((prev) => prev.filter((att) => att.id !== id));
  };

  const handleView = (attachment: Attachment) => {
    setSelectedAttachment(attachment);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <Select value={fileTypeFilter} onValueChange={(value) => setFileTypeFilter(value as FileTypeFilter)}>
            <SelectTrigger className="w-[140px]">
              <Filter className="size-4 mr-2" />
              <SelectValue placeholder="File type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All files</SelectItem>
              <SelectItem value="image">Images</SelectItem>
              <SelectItem value="pdf">PDFs</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="document">Documents</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Date added</SelectItem>
              <SelectItem value="updated">Last modified</SelectItem>
              <SelectItem value="filename">Name</SelectItem>
              <SelectItem value="size">Size</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex border rounded-lg">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setViewMode('grid')}
              className="rounded-r-none"
            >
              <Grid3x3 className="size-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setViewMode('list')}
              className="rounded-l-none border-l"
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Results Count */}
      <div className="text-sm text-muted-foreground">
        {filteredAttachments.length === attachments.length ? (
          <span>{attachments.length} file{attachments.length !== 1 ? 's' : ''}</span>
        ) : (
          <span>
            {filteredAttachments.length} of {attachments.length} file{attachments.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Gallery */}
      {filteredAttachments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No attachments found</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredAttachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onDelete={handleDelete}
              onView={handleView}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAttachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              onDelete={handleDelete}
              onView={handleView}
              variant="compact"
            />
          ))}
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
