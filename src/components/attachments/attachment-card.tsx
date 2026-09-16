'use client';

import { useState } from 'react';
import {
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  Download,
  Trash2,
  ExternalLink,
  MoreVertical,
  Loader2,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { Attachment } from '@/lib/db/schema';

interface AttachmentCardProps {
  attachment: Attachment;
  onDelete?: (id: string) => void;
  onView?: (attachment: Attachment) => void;
  className?: string;
  variant?: 'default' | 'compact' | 'grid';
  selected?: boolean;
}

export function AttachmentCard({
  attachment,
  onDelete,
  onView,
  className,
  variant = 'default',
  selected = false,
}: AttachmentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const confirm = useConfirm();

  const getFileIcon = () => {
    switch (attachment.file_type) {
      case 'image':
        return ImageIcon;
      case 'pdf':
        return FileText;
      case 'audio':
        return Music;
      case 'video':
        return Video;
      default:
        return File;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        -Math.floor(diffInHours),
        'hour'
      );
    } else if (diffInHours < 24 * 7) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        -Math.floor(diffInHours / 24),
        'day'
      );
    } else {
      return new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      }).format(date);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;

    const ok = await confirm({ title: `Delete "${attachment.filename}"?`, description: "This file will be permanently removed.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/attachments/${attachment.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete attachment');
      }

      onDelete(attachment.id);
      toast.success('Attachment deleted');
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete attachment');
      setIsDeleting(false);
    }
  };

  const handleDownload = () => {
    window.open(attachment.storage_url, '_blank');
  };

  const Icon = getFileIcon();

  // Get thumbnail from metadata if available
  const metadata = attachment.metadata ? JSON.parse(attachment.metadata) : {};
  const thumbnail = metadata.thumbnail;

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors cursor-pointer group relative',
          selected && 'ring-2 ring-primary ring-offset-2',
          className
        )}
        onClick={() => onView?.(attachment)}
      >
        {selected && (
          <div className="absolute top-2 left-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center z-10">
            <Check className="size-4 text-primary-foreground" />
          </div>
        )}
        <div className="shrink-0">
          <Icon className="size-5 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{attachment.filename}</p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(attachment.file_size)} • {formatDate(attachment.created_at)}
          </p>
        </div>

        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="size-4" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open(attachment.storage_url, '_blank')}>
                <ExternalLink className="size-4" />
                Open in new tab
              </DropdownMenuItem>
              {onDelete && (
                <DropdownMenuItem
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="text-destructive"
                >
                  {isDeleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'group relative border rounded-lg overflow-hidden bg-card',
      selected && 'ring-2 ring-primary ring-offset-2',
      className
    )}>
      {/* Selection Indicator */}
      {selected && (
        <div className="absolute top-2 left-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center z-10">
          <Check className="size-4 text-primary-foreground" />
        </div>
      )}

      {/* Thumbnail or Icon */}
      <div
        className="aspect-video bg-muted flex items-center justify-center cursor-pointer"
        onClick={() => onView?.(attachment)}
      >
        {attachment.file_type === 'image' && !thumbnailError ? (
          thumbnail ? (
            <img
              src={`data:image/jpeg;base64,${thumbnail}`}
              alt={attachment.filename}
              className="w-full h-full object-cover"
              onError={() => setThumbnailError(true)}
            />
          ) : (
            <img
              src={attachment.storage_url}
              alt={attachment.filename}
              className="w-full h-full object-cover"
              onError={() => setThumbnailError(true)}
            />
          )
        ) : (
          <Icon className="size-12 text-muted-foreground" />
        )}

        {/* Processing Status */}
        {attachment.processing_status === 'processing' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="size-8 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        <div className="space-y-1">
          <p className="text-sm font-medium truncate" title={attachment.filename}>
            {attachment.filename}
          </p>

          {attachment.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{attachment.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatFileSize(attachment.file_size)}</span>
          <span>•</span>
          <span>{formatDate(attachment.created_at)}</span>
        </div>

        {/* Tags */}
        {attachment.tags && JSON.parse(attachment.tags).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {JSON.parse(attachment.tags).map((tag: string, index: number) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon-sm" className="bg-background/80 backdrop-blur">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDownload}>
              <Download className="size-4" />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.open(attachment.storage_url, '_blank')}>
              <ExternalLink className="size-4" />
              Open in new tab
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-destructive"
              >
                {isDeleting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
