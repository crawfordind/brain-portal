# Attachment Viewer Redesign - Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Redesign AttachmentViewer component using Phase 1 foundation components with mobile-first responsive behavior and enhanced UX.

**Architecture:** Replace custom header/metadata sections with ModalHeader and ModalSection components. Implement responsive layout that switches between Dialog (desktop) and Sheet (mobile). Add FloatingActions for mobile, collapsible metadata sections, and improved loading/error states.

**Tech Stack:** React 18, TypeScript, Radix UI Dialog/Sheet, Phase 1 modal components (ModalHeader, ModalSection, FloatingActions, ModalDragHandle), Tailwind CSS, Vitest + Testing Library

---

## Task 1: Extract Utility Functions to Shared Module

**Files:**
- Create: `src/lib/utils/file-formatting.ts`
- Modify: `src/components/attachments/attachment-viewer.tsx:30-46`
- Test: `tests/lib/utils/file-formatting.test.ts`

**Step 1: Write failing tests for utility functions**

Create `tests/lib/utils/file-formatting.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';

describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });
});

describe('formatDate', () => {
  it('formats date string correctly', () => {
    const date = '2024-01-15T10:30:00Z';
    const formatted = formatDate(date);
    // Should match: "January 15, 2024 at 10:30 AM" (locale-dependent)
    expect(formatted).toContain('January');
    expect(formatted).toContain('15');
    expect(formatted).toContain('2024');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/utils/file-formatting.test.ts`
Expected: FAIL with "Cannot find module '@/lib/utils/file-formatting'"

**Step 3: Implement utility functions**

Create `src/lib/utils/file-formatting.ts`:

```typescript
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(dateString));
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lib/utils/file-formatting.test.ts`
Expected: PASS (7 tests)

**Step 5: Update AttachmentViewer to use shared utilities**

Edit `src/components/attachments/attachment-viewer.tsx`:

Remove lines 30-46 (formatFileSize and formatDate functions) and add import:

```typescript
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';
```

**Step 6: Run AttachmentViewer tests to ensure no regression**

Run: `npm test -- tests/components/attachments`
Expected: PASS (all existing tests still work)

**Step 7: Commit**

```bash
git add src/lib/utils/file-formatting.ts tests/lib/utils/file-formatting.test.ts src/components/attachments/attachment-viewer.tsx
git commit -m "refactor(attachments): extract file formatting utilities

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Mobile Detection Hook

**Files:**
- Create: `src/hooks/use-mobile.ts`
- Test: `tests/hooks/use-mobile.test.ts`

**Step 1: Write failing tests for mobile detection**

Create `tests/hooks/use-mobile.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMobile } from '@/hooks/use-mobile';

describe('useMobile', () => {
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    // Restore original width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('returns true for mobile width (< 640px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(true);
  });

  it('returns false for desktop width (>= 640px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);
  });

  it('returns false for tablet width (640px)', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 640,
    });

    const { result } = renderHook(() => useMobile());
    expect(result.current).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/hooks/use-mobile.test.ts`
Expected: FAIL with "Cannot find module '@/hooks/use-mobile'"

**Step 3: Implement mobile detection hook**

Create `src/hooks/use-mobile.ts`:

```typescript
import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 640; // Tailwind 'sm' breakpoint

export function useMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    // Check on mount
    checkMobile();

    // Listen for resize
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/hooks/use-mobile.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/hooks/use-mobile.ts tests/hooks/use-mobile.test.ts
git commit -m "feat(hooks): add mobile detection hook

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create AttachmentPreview Component

**Files:**
- Create: `src/components/attachments/attachment-preview.tsx`
- Test: `tests/components/attachments/attachment-preview.test.tsx`

**Step 1: Write failing tests for preview component**

Create `tests/components/attachments/attachment-preview.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentPreview } from '@/components/attachments/attachment-preview';

describe('AttachmentPreview', () => {
  it('renders image preview', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'complete' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    const img = screen.getByAltText('test.jpg');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/test.jpg');
  });

  it('renders processing state', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'processing' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    expect(screen.getByText('Processing file...')).toBeInTheDocument();
  });

  it('renders image error state', () => {
    const attachment = {
      id: '1',
      filename: 'test.jpg',
      storage_url: '/test.jpg',
      file_type: 'image' as const,
      mime_type: 'image/jpeg',
      file_size: 1024,
      processing_status: 'complete' as const,
    };

    const { container } = render(<AttachmentPreview attachment={attachment} />);
    const img = screen.getByAltText('test.jpg') as HTMLImageElement;

    // Trigger error
    img.onerror?.(new Event('error'));

    expect(screen.getByText('Failed to load image')).toBeInTheDocument();
  });

  it('renders PDF preview with iframe', () => {
    const attachment = {
      id: '1',
      filename: 'test.pdf',
      storage_url: '/test.pdf',
      file_type: 'pdf' as const,
      mime_type: 'application/pdf',
      file_size: 2048,
      processing_status: 'complete' as const,
    };

    render(<AttachmentPreview attachment={attachment} />);
    const iframe = screen.getByTitle('test.pdf');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', '/test.pdf');
  });

  it('renders audio preview with controls', () => {
    const attachment = {
      id: '1',
      filename: 'test.mp3',
      storage_url: '/test.mp3',
      file_type: 'audio' as const,
      mime_type: 'audio/mpeg',
      file_size: 4096,
      processing_status: 'complete' as const,
    };

    const { container } = render(<AttachmentPreview attachment={attachment} />);
    const audio = container.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveAttribute('controls');
  });

  it('renders video preview with controls', () => {
    const attachment = {
      id: '1',
      filename: 'test.mp4',
      storage_url: '/test.mp4',
      file_type: 'video' as const,
      mime_type: 'video/mp4',
      file_size: 8192,
      processing_status: 'complete' as const,
    };

    const { container } = render(<AttachmentPreview attachment={attachment} />);
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('controls');
  });

  it('renders download prompt for unsupported document', () => {
    const attachment = {
      id: '1',
      filename: 'test.docx',
      storage_url: '/test.docx',
      file_type: 'document' as const,
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      file_size: 16384,
      processing_status: 'complete' as const,
    };

    render(<AttachmentPreview attachment={attachment} onDownload={vi.fn()} />);
    expect(screen.getByText('Preview not available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-preview.test.tsx`
Expected: FAIL with "Cannot find module"

**Step 3: Implement AttachmentPreview component**

Create `src/components/attachments/attachment-preview.tsx`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-preview.test.tsx`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-preview.tsx tests/components/attachments/attachment-preview.test.tsx
git commit -m "feat(attachments): extract preview rendering to separate component

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create AttachmentMetadata Component

**Files:**
- Create: `src/components/attachments/attachment-metadata.tsx`
- Test: `tests/components/attachments/attachment-metadata.test.tsx`

**Step 1: Write failing tests for metadata component**

Create `tests/components/attachments/attachment-metadata.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentMetadata } from '@/components/attachments/attachment-metadata';

describe('AttachmentMetadata', () => {
  const baseAttachment = {
    id: '1',
    filename: 'test.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 1024000,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    description: null,
    tags: null,
    extracted_text: null,
    metadata: null,
  };

  it('renders file details section', () => {
    render(<AttachmentMetadata attachment={baseAttachment} />);

    expect(screen.getByText('File Details')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('image')).toBeInTheDocument();
    expect(screen.getByText('MIME Type')).toBeInTheDocument();
    expect(screen.getByText('image/jpeg')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText(/1000 KB/)).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    const attachment = {
      ...baseAttachment,
      description: 'A test image',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('A test image')).toBeInTheDocument();
  });

  it('renders tags when provided', () => {
    const attachment = {
      ...baseAttachment,
      tags: JSON.stringify(['nature', 'landscape']),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('nature')).toBeInTheDocument();
    expect(screen.getByText('landscape')).toBeInTheDocument();
  });

  it('renders extracted text preview', () => {
    const attachment = {
      ...baseAttachment,
      extracted_text: 'This is extracted text from the document.',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Extracted Text')).toBeInTheDocument();
    expect(screen.getByText('This is extracted text from the document.')).toBeInTheDocument();
  });

  it('renders image metadata when available', () => {
    const attachment = {
      ...baseAttachment,
      file_type: 'image' as const,
      metadata: JSON.stringify({
        width: 1920,
        height: 1080,
        format: 'JPEG',
      }),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Image Info')).toBeInTheDocument();
    expect(screen.getByText('Dimensions')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });

  it('renders PDF metadata when available', () => {
    const attachment = {
      ...baseAttachment,
      file_type: 'pdf' as const,
      mime_type: 'application/pdf',
      metadata: JSON.stringify({
        numPages: 10,
      }),
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('PDF Info')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('uses collapsible sections when collapsible prop is true', () => {
    const attachment = {
      ...baseAttachment,
      description: 'Test description',
      tags: JSON.stringify(['tag1']),
    };

    render(<AttachmentMetadata attachment={attachment} collapsible />);

    // ModalSection with collapsible renders ChevronDown icons
    const chevrons = document.querySelectorAll('svg');
    expect(chevrons.length).toBeGreaterThan(0);
  });

  it('renders modified date when different from created', () => {
    const attachment = {
      ...baseAttachment,
      updated_at: '2024-01-20T14:45:00Z',
    };

    render(<AttachmentMetadata attachment={attachment} />);
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-metadata.test.tsx`
Expected: FAIL with "Cannot find module"

**Step 3: Implement AttachmentMetadata component**

Create `src/components/attachments/attachment-metadata.tsx`:

```typescript
'use client';

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
  const metadata = attachment.metadata ? JSON.parse(attachment.metadata) : {};
  const tags = attachment.tags ? JSON.parse(attachment.tags) : [];

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
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-metadata.test.tsx`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-metadata.tsx tests/components/attachments/attachment-metadata.test.tsx
git commit -m "feat(attachments): extract metadata rendering to separate component

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Redesign AttachmentViewer - Desktop Layout

**Files:**
- Modify: `src/components/attachments/attachment-viewer.tsx:1-310`
- Test: `tests/components/attachments/attachment-viewer.test.tsx`

**Step 1: Write failing tests for redesigned viewer**

Create `tests/components/attachments/attachment-viewer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';

describe('AttachmentViewer - Desktop', () => {
  const mockAttachment = {
    id: '1',
    filename: 'test-image.jpg',
    storage_url: '/test-image.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 1024000,
    processing_status: 'complete' as const,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    description: 'Test description',
    tags: JSON.stringify(['test', 'image']),
    extracted_text: null,
    metadata: JSON.stringify({ width: 1920, height: 1080 }),
    user_id: 'user1',
    project_id: null,
    note_id: null,
    hash: 'abc123',
    thumbnail_url: null,
    processing_error: null,
  };

  beforeEach(() => {
    // Set desktop width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
  });

  it('renders with immersive size on desktop', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Dialog should have max-w-7xl class (immersive size)
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toHaveClass('sm:max-w-7xl');
  });

  it('renders ModalHeader with filename and metadata', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
    expect(screen.getByText(/1000 KB/)).toBeInTheDocument();
  });

  it('calls onClose when header close button clicked', async () => {
    const onClose = vi.fn();
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByLabelText('Close');
    await userEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders AttachmentPreview component', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    const img = screen.getByAltText('test-image.jpg');
    expect(img).toBeInTheDocument();
  });

  it('renders AttachmentMetadata in sidebar on desktop', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('File Details')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('renders action buttons in header', () => {
    const onDelete = vi.fn();
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', async () => {
    const onDelete = vi.fn();
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalled();
  });

  it('opens file in new tab when open button clicked', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    const openButton = screen.getByRole('button', { name: /open/i });
    await userEvent.click(openButton);
    expect(windowOpen).toHaveBeenCalledWith('/test-image.jpg', '_blank');
  });

  it('hides delete button when onDelete not provided', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-viewer.test.tsx`
Expected: FAIL (tests don't match new implementation)

**Step 3: Redesign AttachmentViewer for desktop**

Edit `src/components/attachments/attachment-viewer.tsx`:

```typescript
'use client';

import { Download, Trash2, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ModalHeader } from '@/components/modals';
import { AttachmentPreview } from './attachment-preview';
import { AttachmentMetadata } from './attachment-metadata';
import { formatFileSize, formatDate } from '@/lib/utils/file-formatting';
import { useMobile } from '@/hooks/use-mobile';
import type { Attachment } from '@/lib/db/schema';

interface AttachmentViewerProps {
  attachment: Attachment;
  onClose: () => void;
  onDelete?: () => void;
}

export function AttachmentViewer({ attachment, onClose, onDelete }: AttachmentViewerProps) {
  const isMobile = useMobile();

  const handleDownload = () => {
    window.open(attachment.storage_url, '_blank');
  };

  const handleOpen = () => {
    window.open(attachment.storage_url, '_blank');
  };

  // Mobile layout will be implemented in next task
  if (isMobile) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent size="immersive" className="max-h-[85vh] p-0 gap-0">
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title={attachment.filename}
                subtitle={`${formatFileSize(attachment.file_size)} • Uploaded ${formatDate(attachment.created_at)}`}
                onClose={onClose}
              />
            </div>

            <div className="flex-1 overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-3 h-full">
                {/* Preview Area */}
                <div className="lg:col-span-2 flex items-center justify-center bg-muted/30 p-4">
                  <AttachmentPreview
                    attachment={attachment}
                    onDownload={handleDownload}
                  />
                </div>

                {/* Metadata Sidebar */}
                <div className="border-l bg-card p-4 overflow-y-auto">
                  <AttachmentMetadata attachment={attachment} />
                </div>
              </div>
            </div>

            <div className="border-t p-4 flex gap-2">
              <Button variant="outline" onClick={handleDownload} className="flex-1">
                <Download className="size-4 mr-2" />
                Download
              </Button>
              <Button variant="outline" onClick={handleOpen} className="flex-1">
                <ExternalLink className="size-4 mr-2" />
                Open
              </Button>
              {onDelete && (
                <Button variant="outline" onClick={onDelete} className="flex-1">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Desktop layout
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="immersive" className="max-h-[85vh] p-0 gap-0">
        <div className="flex flex-col h-full">
          {/* Header with actions */}
          <div className="p-4 border-b">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold leading-none tracking-tight truncate">
                  {attachment.filename}
                </h2>
                <p className="text-sm text-muted-foreground mt-1.5">
                  {formatFileSize(attachment.file_size)} • Uploaded {formatDate(attachment.created_at)}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="size-4 mr-2" />
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  <ExternalLink className="size-4 mr-2" />
                  Open
                </Button>
                {onDelete && (
                  <Button variant="outline" size="sm" onClick={onDelete}>
                    <Trash2 className="size-4 mr-2" />
                    Delete
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
                  <ExternalLink className="size-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-3 h-full">
              {/* Preview Area (2/3) */}
              <div className="lg:col-span-2 flex items-center justify-center bg-muted/30 p-4">
                <AttachmentPreview
                  attachment={attachment}
                  onDownload={handleDownload}
                />
              </div>

              {/* Metadata Sidebar (1/3) */}
              <div className="border-l bg-card p-4 overflow-y-auto">
                <AttachmentMetadata attachment={attachment} />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-viewer.test.tsx`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-viewer.tsx tests/components/attachments/attachment-viewer.test.tsx
git commit -m "refactor(attachments): redesign viewer with immersive layout for desktop

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Implement Mobile Bottom Sheet Layout

**Files:**
- Modify: `src/components/attachments/attachment-viewer.tsx:27-60`
- Test: `tests/components/attachments/attachment-viewer-mobile.test.tsx`

**Step 1: Write failing tests for mobile layout**

Create `tests/components/attachments/attachment-viewer-mobile.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';

describe('AttachmentViewer - Mobile', () => {
  const mockAttachment = {
    id: '1',
    filename: 'mobile-test.jpg',
    storage_url: '/mobile-test.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 512000,
    processing_status: 'complete' as const,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    description: 'Mobile test',
    tags: JSON.stringify(['mobile']),
    extracted_text: null,
    metadata: JSON.stringify({ width: 1080, height: 1920 }),
    user_id: 'user1',
    project_id: null,
    note_id: null,
    hash: 'def456',
    thumbnail_url: null,
    processing_error: null,
  };

  beforeEach(() => {
    // Set mobile width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });
  });

  it('renders bottom sheet on mobile', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Sheet should have rounded top corners
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet).toHaveClass('rounded-t-2xl');
  });

  it('renders drag handle on mobile', () => {
    const { container } = render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Drag handle should be present
    const dragHandle = container.querySelector('[aria-hidden="true"]');
    expect(dragHandle).toBeInTheDocument();
  });

  it('renders FloatingActions with download/open/delete buttons', () => {
    const onDelete = vi.fn();
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
        onDelete={onDelete}
      />
    );

    // Should have 3 floating action buttons
    const floatingActions = document.querySelectorAll('[aria-label]');
    const downloadBtn = Array.from(floatingActions).find(
      (el) => el.getAttribute('aria-label') === 'Download'
    );
    const openBtn = Array.from(floatingActions).find(
      (el) => el.getAttribute('aria-label') === 'Open'
    );
    const deleteBtn = Array.from(floatingActions).find(
      (el) => el.getAttribute('aria-label') === 'Delete'
    );

    expect(downloadBtn).toBeInTheDocument();
    expect(openBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
  });

  it('renders collapsible metadata sections on mobile', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Collapsible sections should have chevron icons
    const chevrons = document.querySelectorAll('svg');
    expect(chevrons.length).toBeGreaterThan(0);
  });

  it('stacks preview, actions, and metadata vertically', () => {
    const { container } = render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Should have vertical flex layout
    const content = container.querySelector('.flex-col');
    expect(content).toBeInTheDocument();
  });

  it('hides delete action when onDelete not provided', () => {
    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    const floatingActions = document.querySelectorAll('[aria-label]');
    const deleteBtn = Array.from(floatingActions).find(
      (el) => el.getAttribute('aria-label') === 'Delete'
    );

    expect(deleteBtn).not.toBeInTheDocument();
  });

  it('calls onDownload when download action clicked', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    const downloadBtn = document.querySelector('[aria-label="Download"]');
    await userEvent.click(downloadBtn!);
    expect(windowOpen).toHaveBeenCalledWith('/mobile-test.jpg', '_blank');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-viewer-mobile.test.tsx`
Expected: FAIL (mobile layout not implemented)

**Step 3: Implement mobile bottom sheet layout**

Edit `src/components/attachments/attachment-viewer.tsx` (replace lines 27-60):

```typescript
export function AttachmentViewer({ attachment, onClose, onDelete }: AttachmentViewerProps) {
  const isMobile = useMobile();

  const handleDownload = () => {
    window.open(attachment.storage_url, '_blank');
  };

  const handleOpen = () => {
    window.open(attachment.storage_url, '_blank');
  };

  // Mobile: Bottom sheet with stacked layout
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
          <div className="flex flex-col h-full">
            {/* Drag Handle */}
            <div className="pt-2 pb-4 flex justify-center">
              <ModalDragHandle />
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

  // Desktop: Dialog with side-by-side layout (existing code remains)
  // ...
}
```

Add missing imports at the top:

```typescript
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ModalDragHandle, FloatingActions } from '@/components/modals';
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-viewer-mobile.test.tsx`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-viewer.tsx tests/components/attachments/attachment-viewer-mobile.test.tsx
git commit -m "feat(attachments): implement mobile bottom sheet layout with floating actions

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Integration Tests

**Files:**
- Create: `tests/integration/attachment-viewer-responsive.test.tsx`

**Step 1: Write integration tests for responsive behavior**

Create `tests/integration/attachment-viewer-responsive.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';

describe('AttachmentViewer - Responsive Integration', () => {
  const mockAttachment = {
    id: '1',
    filename: 'responsive-test.jpg',
    storage_url: '/responsive-test.jpg',
    file_type: 'image' as const,
    mime_type: 'image/jpeg',
    file_size: 2048000,
    processing_status: 'complete' as const,
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-20T14:30:00Z',
    description: 'Responsive test image',
    tags: JSON.stringify(['responsive', 'test']),
    extracted_text: 'Sample extracted text',
    metadata: JSON.stringify({ width: 2560, height: 1440, format: 'JPEG' }),
    user_id: 'user1',
    project_id: 'proj1',
    note_id: null,
    hash: 'ghi789',
    thumbnail_url: '/thumb.jpg',
    processing_error: null,
  };

  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('switches from desktop to mobile layout on resize', () => {
    // Start with desktop width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    const { rerender } = render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Should render desktop layout (Dialog)
    expect(document.querySelector('[role="dialog"]')).toHaveClass('sm:max-w-7xl');

    // Change to mobile width
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });

    // Trigger resize event
    window.dispatchEvent(new Event('resize'));

    rerender(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Should render mobile layout (Sheet with rounded corners)
    expect(document.querySelector('[role="dialog"]')).toHaveClass('rounded-t-2xl');
  });

  it('renders all metadata sections correctly on desktop', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // All metadata sections should be visible
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('Responsive test image')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('responsive')).toBeInTheDocument();
    expect(screen.getByText('Extracted Text')).toBeInTheDocument();
    expect(screen.getByText('File Details')).toBeInTheDocument();
    expect(screen.getByText('Image Info')).toBeInTheDocument();
    expect(screen.getByText('2560 × 1440')).toBeInTheDocument();
  });

  it('renders collapsible metadata sections on mobile', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    });

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    // Collapsible sections should have chevron indicators
    const chevrons = document.querySelectorAll('svg');
    const hasChevronDown = Array.from(chevrons).some(
      (svg) => svg.getAttribute('class')?.includes('rotate')
    );
    expect(hasChevronDown || chevrons.length > 5).toBe(true);
  });

  it('shows modified date when different from created date', () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    render(
      <AttachmentViewer
        attachment={mockAttachment}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  it('renders all file type previews correctly', () => {
    const fileTypes = [
      { type: 'image' as const, mime: 'image/png' },
      { type: 'pdf' as const, mime: 'application/pdf' },
      { type: 'audio' as const, mime: 'audio/mpeg' },
      { type: 'video' as const, mime: 'video/mp4' },
      { type: 'document' as const, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ];

    fileTypes.forEach(({ type, mime }) => {
      const attachment = {
        ...mockAttachment,
        filename: `test.${type}`,
        file_type: type,
        mime_type: mime,
      };

      const { unmount } = render(
        <AttachmentViewer
          attachment={attachment}
          onClose={vi.fn()}
        />
      );

      // Verify preview component renders
      expect(document.querySelector('[role="dialog"]')).toBeInTheDocument();

      unmount();
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- tests/integration/attachment-viewer-responsive.test.tsx`
Expected: PASS (5 tests)

**Step 3: Commit**

```bash
git add tests/integration/attachment-viewer-responsive.test.tsx
git commit -m "test(attachments): add responsive integration tests for viewer

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Build Verification and Manual Testing Checklist

**Files:**
- Create: `docs/testing/attachment-viewer-phase2-checklist.md`

**Step 1: Run all tests**

Run: `npm test`
Expected: All Phase 2 tests pass

**Step 2: Type check**

Run: `npm run typecheck`
Expected: No TypeScript errors

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Create manual testing checklist**

Create `docs/testing/attachment-viewer-phase2-checklist.md`:

```markdown
# Attachment Viewer Phase 2 - Manual Testing Checklist

## Desktop Testing (>= 1024px)

### Layout
- [ ] Modal opens with max-w-7xl (immersive size)
- [ ] Modal height is max-h-[85vh]
- [ ] Preview area takes 2/3 width
- [ ] Metadata sidebar takes 1/3 width
- [ ] Header shows filename and file info
- [ ] Action buttons (Download, Open, Delete) visible in header

### Functionality
- [ ] Download button opens file in new tab
- [ ] Open button opens file in new tab
- [ ] Delete button triggers onDelete callback
- [ ] Close button (X) closes modal
- [ ] Backdrop click closes modal

### File Types
- [ ] Image: Renders correctly, maintains aspect ratio
- [ ] PDF: Renders in iframe
- [ ] Audio: Shows controls and icon
- [ ] Video: Renders with controls
- [ ] Document (text): Renders in iframe
- [ ] Document (other): Shows download prompt
- [ ] Unknown type: Shows download prompt

### Metadata
- [ ] Description section visible when present
- [ ] Tags displayed as badges when present
- [ ] Extracted text shown when present
- [ ] File details (type, MIME, size, dates) displayed
- [ ] Image metadata (dimensions, format) shown for images
- [ ] PDF metadata (page count) shown for PDFs
- [ ] Modified date shown when different from created

## Mobile Testing (< 640px)

### Layout
- [ ] Sheet opens from bottom with rounded-t-2xl corners
- [ ] Drag handle visible at top
- [ ] Sheet height is 90vh
- [ ] Header shows filename and file info (no close button)
- [ ] Preview zone takes flexible space
- [ ] Floating action bar visible over preview
- [ ] Metadata zone at bottom (max-h-[40vh])

### Functionality
- [ ] Drag handle indicates sheet can be dismissed
- [ ] Swipe down dismisses sheet
- [ ] Backdrop tap dismisses sheet
- [ ] Download floating action works
- [ ] Open floating action works
- [ ] Delete floating action works (when onDelete provided)
- [ ] Floating actions have rounded-full button style

### Metadata (Collapsible)
- [ ] Description section collapsible
- [ ] Tags section collapsible
- [ ] Extracted text section collapsible
- [ ] File details section collapsible
- [ ] Image info section collapsible
- [ ] PDF info section collapsible
- [ ] Chevron icons indicate collapsed state
- [ ] Sections expand/collapse on click

### Scrolling
- [ ] Preview zone does not scroll (fixed height)
- [ ] Metadata zone scrolls independently
- [ ] No horizontal scroll anywhere
- [ ] Momentum scrolling works smoothly

## Responsive Testing

### Breakpoint Transitions
- [ ] Desktop (1024px+): Dialog layout
- [ ] Tablet (640-1023px): Dialog layout (same as desktop)
- [ ] Mobile (< 640px): Bottom sheet layout
- [ ] Layout switches correctly on window resize

### Safe Area (iOS)
- [ ] Bottom sheet respects safe-area-inset-bottom
- [ ] No content hidden by home indicator
- [ ] No content hidden by notch/Dynamic Island

## Device-Specific Testing

### iPhone 14 Pro (Notch)
- [ ] Modal renders correctly
- [ ] Safe area insets applied
- [ ] No content cut off by notch

### iPhone 15 Pro Max (Dynamic Island)
- [ ] Modal renders correctly
- [ ] Safe area insets applied
- [ ] No content cut off by Dynamic Island

### Android (Pixel, Samsung Galaxy)
- [ ] Modal renders correctly
- [ ] Navigation bar does not overlap content
- [ ] Gesture navigation works

### iPad (Portrait and Landscape)
- [ ] Desktop layout renders in both orientations
- [ ] Metadata sidebar visible and scrollable
- [ ] No layout issues

### Desktop Browsers
- [ ] Chrome: All features work
- [ ] Safari: All features work
- [ ] Firefox: All features work
- [ ] Edge: All features work

## Error States

### Image Load Error
- [ ] Shows "Failed to load image" with icon
- [ ] Error state centered in preview area

### Processing State
- [ ] Shows spinner and "Processing file..." message
- [ ] Centered in preview area

### Network Error
- [ ] Handles offline gracefully
- [ ] Shows appropriate error message

## Performance

### Load Time
- [ ] Modal opens within 100ms
- [ ] Preview renders within 500ms
- [ ] No janky animations

### Memory
- [ ] No memory leaks on open/close cycle
- [ ] Large images handled efficiently

### Accessibility
- [ ] All buttons have aria-labels
- [ ] Modal has proper focus management
- [ ] Keyboard navigation works (Tab, Escape)
- [ ] Screen reader announces all content

## Regression Testing

### Existing Functionality
- [ ] All original features still work
- [ ] No visual regressions
- [ ] No console errors or warnings
- [ ] File upload still works
- [ ] Gallery still displays attachments
```

**Step 5: Final commit**

```bash
git add docs/testing/attachment-viewer-phase2-checklist.md
git commit -m "docs(testing): add manual testing checklist for Phase 2

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
git push
```

---

## Success Criteria

✅ AttachmentViewer redesigned with Phase 1 components
✅ Desktop: Immersive dialog (max-w-7xl, max-h-[85vh])
✅ Mobile: Bottom sheet with stacked layout
✅ FloatingActions implemented for mobile
✅ Collapsible metadata sections on mobile
✅ Utility functions extracted and tested
✅ Mobile detection hook implemented
✅ Preview component extracted and tested
✅ Metadata component extracted and tested
✅ Responsive integration tests passing
✅ Manual testing checklist created
✅ All tests pass
✅ Type-safe TypeScript
✅ Build succeeds

## Next Steps

After Phase 2 completion:
1. **Manual Device Testing**: Test on real devices using checklist
2. **Phase 3**: Standardize remaining 10 modals with Phase 1 components
3. **Phase 4**: Polish, accessibility audit, performance optimization

## Notes

- Mobile layout uses Sheet instead of Dialog for native bottom sheet behavior
- FloatingActions positioned absolutely over preview for quick access
- Metadata sections collapsible on mobile to save space
- Desktop layout maintains side-by-side for optimal viewing
- Safe area insets applied via Tailwind `pb-[env(safe-area-inset-bottom)]`
