'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { VoiceInput } from '@/components/ui/voice-input';
import { useQueryClient } from '@tanstack/react-query';
import { ModalHeader } from '@/components/modals/modal-header';
import { useMobile } from '@/hooks/use-mobile';
import { Link as LinkIcon, Loader2 } from 'lucide-react';
import type { LinkMetadata } from '@/lib/db/schema';

interface CaptureCreateDialogProps {
  open: boolean;
  onClose: () => void;
  projects: Array<{ id: string; name: string }>;
}

export function CaptureCreateDialog({
  open,
  onClose,
  projects,
}: CaptureCreateDialogProps) {
  const [content, setContent] = useState('');
  const [captureType, setCaptureType] = useState('thought');
  const [projectId, setProjectId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [linkMetadata, setLinkMetadata] = useState<LinkMetadata | null>(null);
  const [isScrapingEnabled, setIsScrapingEnabled] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const handleClose = () => {
    setContent('');
    setCaptureType('thought');
    setProjectId('');
    setDetectedUrl(null);
    setLinkMetadata(null);
    setIsScrapingEnabled(false);
    setIsFetchingMetadata(false);
    onClose();
  };

  // Detect URLs in content as user types
  useEffect(() => {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const match = content.match(urlRegex);
    const url = match ? match[0] : null;

    setDetectedUrl(url);

    // Auto-switch to 'link' type when URL is detected
    if (url && captureType !== 'link') {
      setCaptureType('link');
    }
    // If URL is removed and type is 'link', reset to 'thought'
    if (!url && captureType === 'link') {
      setCaptureType('thought');
      setLinkMetadata(null);
      setIsScrapingEnabled(false);
    }
  }, [content, captureType]);

  // Fetch link metadata
  const handleFetchMetadata = async () => {
    if (!detectedUrl) return;

    setIsFetchingMetadata(true);
    try {
      const response = await fetch('/api/captures/link/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: detectedUrl }),
      });

      if (!response.ok) throw new Error('Failed to fetch metadata');

      const metadata = await response.json();
      setLinkMetadata(metadata);
    } catch (error) {
      console.error('Failed to fetch metadata:', error);
      let description = "Failed to fetch link metadata";
      if (error instanceof TypeError) {
        description = "Network error. Check your connection.";
      } else if (error instanceof Error && error.message.includes('404')) {
        description = "URL not found.";
      }
      toast.error(description);
    } finally {
      setIsFetchingMetadata(false);
    }
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Prepare metadata for link captures
      let metadata = {};
      if (captureType === 'link' && detectedUrl) {
        metadata = {
          url: detectedUrl,
          ...(linkMetadata || {}),
          scrapeEnabled: isScrapingEnabled,
        };
      }

      const response = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          captureType,
          projectId: projectId || null,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        }),
      });

      if (!response.ok) throw new Error('Failed to create capture');

      queryClient.invalidateQueries({ queryKey: ['captures'] });
      toast.success('Captured!');
      handleClose();
    } catch {
      toast.error('Failed to capture');
    } finally {
      setIsSubmitting(false);
    }
  };

  const CaptureForm = () => (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="content">What&apos;s on your mind?</Label>
          <div className="relative">
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type or use voice input..."
              rows={4}
              autoFocus
              className="pr-12 resize-none"
            />
            <div className="absolute right-2 top-2">
              <VoiceInput
                onTranscript={(text) => {
                  setContent((prev) => (prev ? `${prev} ${text}` : text));
                }}
                size="sm"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="captureType">Type</Label>
            <Select value={captureType} onValueChange={setCaptureType}>
              <SelectTrigger id="captureType" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thought">Thought</SelectItem>
                <SelectItem value="idea">Idea</SelectItem>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="followup">Follow-up</SelectItem>
                <SelectItem value="quote">Quote</SelectItem>
                <SelectItem value="reference">Reference</SelectItem>
                <SelectItem value="link">Link</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="projectId">Link to project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="projectId" className="h-11">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Link Detection UI */}
        {detectedUrl && (
          <div className="space-y-3 p-3 rounded-lg border bg-muted/50">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="flex items-center gap-1">
                <LinkIcon className="h-3 w-3" />
                Link detected
              </Badge>
            </div>

            {!linkMetadata && !isFetchingMetadata && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFetchMetadata}
                className="w-full"
              >
                Fetch metadata
              </Button>
            )}

            {isFetchingMetadata && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching link details...
              </div>
            )}

            {linkMetadata && (
              <div className="space-y-3">
                {/* Metadata preview */}
                <div className="flex gap-3">
                  {linkMetadata.favicon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={linkMetadata.favicon}
                      alt=""
                      className="h-8 w-8 rounded flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">
                      {linkMetadata.title || 'Untitled Link'}
                    </h4>
                    <p className="text-xs text-muted-foreground truncate">
                      {new URL(detectedUrl).hostname}
                    </p>
                  </div>
                </div>

                {linkMetadata.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {linkMetadata.description}
                  </p>
                )}

                {linkMetadata.ogImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={linkMetadata.ogImage}
                    alt=""
                    className="w-full h-24 object-cover rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}

                {/* Scraping option */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="scrape-content"
                    checked={isScrapingEnabled}
                    onCheckedChange={(checked) => setIsScrapingEnabled(checked === true)}
                  />
                  <Label htmlFor="scrape-content" className="cursor-pointer">
                    Scrape full page content
                  </Label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:gap-3">
        <Button variant="outline" onClick={handleClose} className="flex-1">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!content.trim() || isSubmitting}
          className="flex-1"
        >
          {isSubmitting ? 'Saving...' : 'Capture'}
        </Button>
      </div>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
          <SheetTitle className="sr-only">Quick Capture</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Quick Capture"
                onClose={handleClose}
                showClose={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CaptureForm />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Compact Dialog
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        <DialogTitle className="sr-only">Quick Capture</DialogTitle>
        <ModalHeader title="Quick Capture" onClose={handleClose} showClose={false} />
        <CaptureForm />
      </DialogContent>
    </Dialog>
  );
}
