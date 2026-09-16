'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ModalSection } from '@/components/modals';
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';
import type { Attachment } from '@/lib/db/schema';

interface AttachmentMetadataProps {
  attachment: Attachment;
  collapsible?: boolean;
  className?: string;
}

export function AttachmentMetadata({
  attachment,
  collapsible = false,
  className = '',
}: AttachmentMetadataProps) {
  const metadata = useMemo(() => {
    if (!attachment.metadata) return {};
    try {
      return JSON.parse(attachment.metadata);
    } catch {
      console.error('Failed to parse attachment metadata');
      return {};
    }
  }, [attachment.metadata]);

  const tags = useMemo(() => {
    if (!attachment.tags) return [];
    try {
      const parsed = JSON.parse(attachment.tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.error('Failed to parse attachment tags');
      return [];
    }
  }, [attachment.tags]);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Description */}
      {attachment.description && (
        <ModalSection title="Description" collapsible={collapsible}>
          <p className="text-sm text-muted-foreground">{attachment.description}</p>
        </ModalSection>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <ModalSection title="Tags" collapsible={collapsible}>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: string, index: number) => (
              <Badge key={index} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </ModalSection>
      )}

      {/* Extracted Text Preview */}
      {attachment.extracted_text && (
        <ModalSection title="Extracted Text" collapsible={collapsible}>
          <p className="text-sm text-muted-foreground line-clamp-6">
            {attachment.extracted_text}
          </p>
        </ModalSection>
      )}

      {/* File Details */}
      <ModalSection title="File Details" collapsible={collapsible}>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Type</dt>
            <dd className="font-medium capitalize">{attachment.file_type}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">MIME Type</dt>
            <dd className="font-medium font-mono text-xs">{attachment.mime_type}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="font-medium">{formatFileSize(attachment.file_size)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-medium">{formatDate(attachment.created_at)}</dd>
          </div>
          {attachment.updated_at !== attachment.created_at && (
            <div>
              <dt className="text-muted-foreground">Modified</dt>
              <dd className="font-medium">{formatDate(attachment.updated_at)}</dd>
            </div>
          )}
        </dl>
      </ModalSection>

      {/* Image Metadata */}
      {attachment.file_type === 'image' && metadata.width && (
        <ModalSection title="Image Info" collapsible={collapsible}>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Dimensions</dt>
              <dd className="font-medium">
                {metadata.width} × {metadata.height}
              </dd>
            </div>
            {metadata.format && (
              <div>
                <dt className="text-muted-foreground">Format</dt>
                <dd className="font-medium uppercase">{metadata.format}</dd>
              </div>
            )}
          </dl>
        </ModalSection>
      )}

      {/* PDF Metadata */}
      {attachment.file_type === 'pdf' && metadata.numPages && (
        <ModalSection title="PDF Info" collapsible={collapsible}>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Pages</dt>
              <dd className="font-medium">{metadata.numPages}</dd>
            </div>
          </dl>
        </ModalSection>
      )}
    </div>
  );
}
