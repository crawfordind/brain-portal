'use client';

import { useState } from 'react';
import {
  Download,
  FileText,
  Music,
  Video,
  File,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Attachment } from '@/lib/db/schema';

interface AttachmentPreviewProps {
  attachment: Pick<
    Attachment,
    'filename' | 'storage_url' | 'file_type' | 'mime_type' | 'processing_status'
  >;
  onDownload?: () => void;
  className?: string;
}

export function AttachmentPreview({
  attachment,
  onDownload,
  className = '',
}: AttachmentPreviewProps) {
  const [imageError, setImageError] = useState(false);

  if (attachment.processing_status === 'processing') {
    return (
      <div className={`flex flex-col items-center justify-center h-full space-y-4 ${className}`}>
        <Loader2 className="size-12 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Processing file...</p>
      </div>
    );
  }

  switch (attachment.file_type) {
    case 'image':
      if (imageError) {
        return (
          <div className={`flex items-center justify-center h-full bg-muted ${className}`}>
            <div className="text-center space-y-2">
              <FileText className="size-16 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Failed to load image</p>
            </div>
          </div>
        );
      }
      return (
        <img
          src={attachment.storage_url}
          alt={attachment.filename}
          className={`max-w-full max-h-full object-contain ${className}`}
          onError={() => setImageError(true)}
        />
      );

    case 'pdf':
      return (
        <iframe
          src={attachment.storage_url}
          className={`w-full h-full border-0 ${className}`}
          title={attachment.filename}
        />
      );

    case 'audio':
      return (
        <div className={`flex flex-col items-center justify-center h-full space-y-4 ${className}`}>
          <Music className="size-24 text-muted-foreground" />
          <audio controls className="w-full max-w-md">
            <source src={attachment.storage_url} type={attachment.mime_type} />
            Your browser does not support the audio element.
          </audio>
        </div>
      );

    case 'video':
      return (
        <div className={`flex items-center justify-center h-full ${className}`}>
          <video controls className="max-w-full max-h-full">
            <source src={attachment.storage_url} type={attachment.mime_type} />
            Your browser does not support the video element.
          </video>
        </div>
      );

    case 'document':
      if (attachment.mime_type.startsWith('text/')) {
        return (
          <iframe
            src={attachment.storage_url}
            className={`w-full h-full border-0 bg-white ${className}`}
            title={attachment.filename}
          />
        );
      }
      return (
        <div className={`flex flex-col items-center justify-center h-full space-y-4 ${className}`}>
          <FileText className="size-24 text-muted-foreground" />
          <div className="text-center">
            <p className="text-lg font-medium mb-2">Preview not available</p>
            <p className="text-sm text-muted-foreground mb-4">
              Download the file to view it
            </p>
            {onDownload && (
              <Button onClick={onDownload}>
                <Download className="size-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      );

    default:
      return (
        <div className={`flex flex-col items-center justify-center h-full space-y-4 ${className}`}>
          <File className="size-24 text-muted-foreground" />
          <div className="text-center">
            <p className="text-lg font-medium mb-2">Preview not available</p>
            <p className="text-sm text-muted-foreground mb-4">
              Download the file to view it
            </p>
            {onDownload && (
              <Button onClick={onDownload}>
                <Download className="size-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      );
  }
}
