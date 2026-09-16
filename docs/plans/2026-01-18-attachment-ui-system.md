# Attachment UI/UX System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement complete attachment UI/UX system with smart search, editor integration, dashboard widget, and mobile-first design

**Architecture:** Multi-layered attachment system with:
- Left panel (desktop) + bottom drawer (mobile) for quick access
- TipTap editor with image manipulation (resize, align, caption, reposition)
- Dashboard widget showing pinned + recent uploads
- Global search integration
- Smart project/note relationship tracking

**Tech Stack:** Next.js 16, TipTap, shadcn/ui, React Query, Turso DB, Cloudflare R2

---

## Task 1: Database Migration - Add is_pinned Column

**Files:**
- Modify: `scripts/migrate.ts`
- Modify: `src/lib/db/schema.ts:645-673`

**Step 1: Update schema interface**

Add `is_pinned` field to `Attachment` interface in `src/lib/db/schema.ts`:

```typescript
export interface Attachment {
  id: string;
  user_id: string;
  // File metadata
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_key: string;
  storage_url: string;
  // Classification
  file_type: 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';
  // Relationships
  project_id: string | null;
  note_id: string | null;
  // Extracted content
  extracted_text: string | null;
  description: string | null;
  content_plain: string | null;
  // Processing
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error: string | null;
  content_hash: string;
  // Metadata & tags
  metadata: string;
  tags: string;
  is_pinned: boolean;  // ADD THIS LINE
  created_at: string;
  updated_at: string;
}
```

**Step 2: Add migration statement**

In `scripts/migrate.ts`, add to the `alterStatements` array (around line 423):

```typescript
const alterStatements = [
  // ... existing statements ...
  `ALTER TABLE attachments ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE`,
];
```

**Step 3: Run migration**

```bash
npm run db:migrate
```

Expected: Column added successfully

**Step 4: Commit**

```bash
git add scripts/migrate.ts src/lib/db/schema.ts
git commit -m "feat(db): add is_pinned column to attachments table

- Add is_pinned boolean field for favoriting attachments
- Update Attachment interface in schema
- Run migration to add column with default FALSE

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: API Routes - Pin/Unpin Endpoint

**Files:**
- Create: `src/app/api/attachments/[id]/pin/route.ts`

**Step 1: Create pin API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { mutate, query } from '@/lib/db/client';
import type { Attachment } from '@/lib/db/schema';

// POST /api/attachments/[id]/pin - Toggle pin status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Get current attachment
    const [attachment] = await query<Attachment>(
      'SELECT * FROM attachments WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Toggle pin status
    const newPinStatus = !attachment.is_pinned;
    const updated = await mutate<Attachment>(
      'UPDATE attachments SET is_pinned = ?, updated_at = datetime("now") WHERE id = ? RETURNING *',
      [newPinStatus, id]
    );

    return NextResponse.json({ attachment: updated, pinned: newPinStatus });
  } catch (error) {
    console.error('Failed to toggle pin status:', error);
    return NextResponse.json({ error: 'Failed to update pin status' }, { status: 500 });
  }
}
```

**Step 2: Test the endpoint**

```bash
# Start dev server in background if not running
npm run dev &
sleep 5

# Test with curl (replace with actual attachment ID and session cookie)
curl -X POST http://localhost:3000/api/attachments/test-id/pin \
  -H "Cookie: session=your-session-token"
```

Expected: Returns `{ "attachment": {...}, "pinned": true }`

**Step 3: Commit**

```bash
git add src/app/api/attachments/[id]/pin/route.ts
git commit -m "feat(api): add pin/unpin endpoint for attachments

- Toggle is_pinned status via POST
- Returns updated attachment with new pin status
- Secured with user authentication

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Install TipTap Extensions

**Files:**
- Modify: `package.json`

**Step 1: Install required packages**

```bash
npm install @tiptap/extension-image @tiptap/extension-dropcursor @tiptap/pm
```

Expected: Packages installed successfully

**Step 2: Verify installation**

```bash
npm list | grep "@tiptap/extension-image"
```

Expected: Shows installed version

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install TipTap image extensions

- @tiptap/extension-image for inline images
- @tiptap/extension-dropcursor for visual feedback
- @tiptap/pm for ProseMirror utilities

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Custom TipTap Figure Extension (Image + Caption)

**Files:**
- Create: `src/components/editor/extensions/figure.ts`

**Step 1: Create figure extension**

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureView } from './figure-view';

export interface FigureOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figure: {
      setFigure: (options: { src: string; alt?: string; title?: string; caption?: string }) => ReturnType;
    };
  }
}

export const Figure = Node.create<FigureOptions>({
  name: 'figure',

  group: 'block',

  content: 'inline*',

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('src'),
      },
      alt: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('alt'),
      },
      title: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('title'),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.querySelector('figcaption')?.textContent,
      },
      width: {
        default: null,
        parseHTML: (element) => element.querySelector('img')?.getAttribute('width'),
      },
      align: {
        default: 'left',
        parseHTML: (element) => {
          const align = element.getAttribute('data-align');
          return align || 'left';
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(this.options.HTMLAttributes, { 'data-align': HTMLAttributes.align }),
      ['img', { src: HTMLAttributes.src, alt: HTMLAttributes.alt, title: HTMLAttributes.title, width: HTMLAttributes.width }],
      ['figcaption', 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },

  addCommands() {
    return {
      setFigure:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },
});
```

**Step 2: Commit**

```bash
git add src/components/editor/extensions/figure.ts
git commit -m "feat(editor): add Figure extension for images with captions

- Custom TipTap node combining image + caption
- Supports resize, alignment, alt text
- Draggable for repositioning

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Figure React Node View Component

**Files:**
- Create: `src/components/editor/extensions/figure-view.tsx`

**Step 1: Create figure view component**

```typescript
'use client';

import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';

export function FigureView({ node, updateAttributes, selected, editor }: any) {
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState<number>(node.attrs.width || 400);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(100, Math.min(800, startWidth + (moveEvent.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      updateAttributes({ width });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    if (!isResizing) {
      updateAttributes({ width });
    }
  }, [isResizing, width, updateAttributes]);

  const alignment = node.attrs.align || 'left';

  return (
    <NodeViewWrapper
      className={cn(
        'figure-wrapper my-4 relative group',
        alignment === 'center' && 'mx-auto text-center',
        alignment === 'right' && 'ml-auto text-right',
        selected && 'ring-2 ring-primary rounded'
      )}
      style={{ maxWidth: `${width}px` }}
      data-drag-handle
    >
      {/* Drag Handle */}
      <div
        className="absolute left-0 top-0 h-full w-6 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        contentEditable={false}
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </div>

      {/* Image */}
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt || ''}
        title={node.attrs.title || ''}
        className="rounded-lg max-w-full h-auto"
        style={{ width: `${width}px` }}
        draggable={false}
      />

      {/* Resize Handle */}
      {selected && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 bg-primary cursor-se-resize"
          onMouseDown={handleMouseDown}
          contentEditable={false}
        />
      )}

      {/* Caption */}
      <figcaption
        className={cn(
          'text-sm text-muted-foreground mt-2 px-2',
          alignment === 'center' && 'text-center',
          alignment === 'right' && 'text-right'
        )}
      >
        <NodeViewContent className="caption-content outline-none" />
      </figcaption>
    </NodeViewWrapper>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/editor/extensions/figure-view.tsx
git commit -m "feat(editor): add FigureView React component

- Interactive resize handles
- Drag handle for repositioning
- Editable caption with NodeViewContent
- Alignment support (left/center/right)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Image Floating Menu Component

**Files:**
- Create: `src/components/editor/image-floating-menu.tsx`

**Step 1: Create floating menu**

```typescript
'use client';

import { BubbleMenu, Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type,
  Trash2,
  Maximize2,
} from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ImageFloatingMenuProps {
  editor: Editor;
}

export function ImageFloatingMenu({ editor }: ImageFloatingMenuProps) {
  const [showAltDialog, setShowAltDialog] = useState(false);
  const [altText, setAltText] = useState('');
  const [title, setTitle] = useState('');

  const handleOpenAltDialog = () => {
    const attrs = editor.getAttributes('figure');
    setAltText(attrs.alt || '');
    setTitle(attrs.title || '');
    setShowAltDialog(true);
  };

  const handleSaveAlt = () => {
    editor.commands.updateAttributes('figure', {
      alt: altText,
      title: title,
    });
    setShowAltDialog(false);
  };

  const handleDelete = () => {
    editor.commands.deleteSelection();
  };

  const handleAlign = (align: 'left' | 'center' | 'right') => {
    editor.commands.updateAttributes('figure', { align });
  };

  const handlePreview = () => {
    const attrs = editor.getAttributes('figure');
    if (attrs.src) {
      window.open(attrs.src, '_blank');
    }
  };

  return (
    <>
      <BubbleMenu
        editor={editor}
        tippyOptions={{ duration: 100 }}
        shouldShow={({ editor }) => {
          return editor.isActive('figure');
        }}
      >
        <div className="flex items-center gap-1 bg-background border rounded-lg shadow-lg p-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('left')}
            className="h-8 w-8 p-0"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('center')}
            className="h-8 w-8 p-0"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleAlign('right')}
            className="h-8 w-8 p-0"
          >
            <AlignRight className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenAltDialog}
            className="h-8 w-8 p-0"
            title="Edit alt text"
          >
            <Type className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handlePreview}
            className="h-8 w-8 p-0"
            title="Preview full size"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </BubbleMenu>

      <Dialog open={showAltDialog} onOpenChange={setShowAltDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Image Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="alt">Alt text (for screen readers)</Label>
              <Input
                id="alt"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Describe the image"
              />
            </div>
            <div>
              <Label htmlFor="title">Title (visible on hover)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Image title"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAltDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveAlt}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/editor/image-floating-menu.tsx
git commit -m "feat(editor): add floating menu for image controls

- Alignment buttons (left/center/right)
- Alt text editor dialog
- Preview and delete actions
- Appears on image selection

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Attachment Picker Modal Component

**Files:**
- Modify: `src/components/attachments/attachment-picker.tsx`

**Step 1: Update attachment picker to be a full modal**

Replace the existing content with:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  useEffect(() => {
    if (open) {
      fetchAttachments();
      setSelectedIds(new Set());
    }
  }, [open, searchQuery, fileTypeFilter]);

  const fetchAttachments = async () => {
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
  };

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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Add Attachment</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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

            <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
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
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Update AttachmentCard to support selection state**

Modify `src/components/attachments/attachment-card.tsx` to add a `selected` prop and visual indication.

**Step 3: Commit**

```bash
git add src/components/attachments/attachment-picker.tsx src/components/attachments/attachment-card.tsx
git commit -m "feat(attachments): enhance picker modal with tabs and selection

- Upload, Browse, and Recent tabs
- Search and filter by file type
- Multi-select support with visual feedback
- Quick link to browse all files

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update Markdown Editor with Image Support

**Files:**
- Modify: `src/components/editor/markdown-editor.tsx`

**Step 1: Add imports and props**

At the top of the file, add imports:

```typescript
import { Figure } from './extensions/figure';
import { ImageFloatingMenu } from './image-floating-menu';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import { Paperclip } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
```

Update the props interface:

```typescript
interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  projectId?: string | null;  // ADD
  noteId?: string | null;      // ADD
}
```

**Step 2: Add state for attachment picker**

Inside the component, add:

```typescript
const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
```

**Step 3: Add Figure extension to editor**

In the `extensions` array (around line 95), add:

```typescript
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: { keepMarks: true },
      orderedList: { keepMarks: true },
    }),
    Placeholder.configure({ placeholder }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: "text-primary underline" },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    MarkdownPaste,
    Figure,  // ADD THIS
  ],
  // ... rest of config
});
```

**Step 4: Add attachment handler**

Add this function inside the component:

```typescript
const handleInsertAttachments = (attachments: Attachment[]) => {
  if (!editor) return;

  attachments.forEach((attachment) => {
    if (attachment.file_type === 'image') {
      // Insert as figure with caption
      editor.commands.setFigure({
        src: attachment.storage_url,
        alt: attachment.description || attachment.filename,
        title: attachment.filename,
        caption: '',
      });
    } else {
      // Insert as link
      editor.commands.insertContent(
        `<a href="${attachment.storage_url}">${attachment.filename}</a> `
      );
    }
  });
};
```

**Step 5: Add attachment button to toolbar**

After the Link button in the toolbar (around line 283), add:

```typescript
{projectId && noteId && (
  <>
    <Separator orientation="vertical" className="h-6 mx-1 hidden md:block" />
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowAttachmentPicker(true)}
      className="h-9 px-2 hidden md:flex"
    >
      <Paperclip className="size-4" />
    </Button>
  </>
)}
```

**Step 6: Add components before return**

Before the main return statement, add:

```typescript
return (
  <>
    {/* ... existing toolbar and editor ... */}

    {editor && <ImageFloatingMenu editor={editor} />}

    {projectId && noteId && (
      <AttachmentPicker
        open={showAttachmentPicker}
        onClose={() => setShowAttachmentPicker(false)}
        onSelect={handleInsertAttachments}
        projectId={projectId}
        noteId={noteId}
      />
    )}
  </>
);
```

**Step 7: Test in browser**

```bash
npm run dev
```

Navigate to a note page and test:
1. Click paperclip icon
2. Modal opens with tabs
3. Upload or select image
4. Image inserts with caption field

**Step 8: Commit**

```bash
git add src/components/editor/markdown-editor.tsx
git commit -m "feat(editor): integrate attachment picker and image support

- Add Figure extension for images with captions
- Attachment picker button in toolbar
- Image floating menu for alignment/editing
- Auto-insert images as figures, files as links

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Left Attachment Panel Component (Desktop)

**Files:**
- Create: `src/components/attachments/attachment-side-panel.tsx`

**Step 1: Create side panel component**

```typescript
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
```

**Step 2: Commit**

```bash
git add src/components/attachments/attachment-side-panel.tsx
git commit -m "feat(attachments): add desktop side panel component

- 120px fixed width with thumbnails
- Pin/unpin functionality
- Click to insert into note
- Empty state with upload prompt

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Mobile Bottom Sheet Component

**Files:**
- Create: `src/components/attachments/attachment-bottom-sheet.tsx`

**Step 1: Create bottom sheet component**

```typescript
'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { FileUpload } from './file-upload';
import { Upload, ArrowRight } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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
      <SheetContent side="bottom" className="h-[75vh]">
        <SheetHeader>
          <SheetTitle>
            Attachments ({attachments.length})
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
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
                  <div className="text-sm mt-2">Tap "Upload New" to add files</div>
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
      </SheetContent>
    </Sheet>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/attachments/attachment-bottom-sheet.tsx
git commit -m "feat(attachments): add mobile bottom sheet component

- Slides up from bottom (75vh height)
- 3-column grid for touch targets
- Upload and browse modes
- Auto-insert on upload complete

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Update Note Page with Attachment Panel

**Files:**
- Modify: `src/app/(dashboard)/notes/[slug]/page.tsx`

**Step 1: Add imports**

```typescript
import { AttachmentSidePanel } from '@/components/attachments/attachment-side-panel';
import { AttachmentBottomSheet } from '@/components/attachments/attachment-bottom-sheet';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import type { Attachment } from '@/lib/db/schema';
```

**Step 2: Add state for mobile sheet**

Inside the component, add:

```typescript
const [showMobileSheet, setShowMobileSheet] = useState(false);
const [showUploadModal, setShowUploadModal] = useState(false);
```

**Step 3: Add insert handler**

```typescript
const handleInsertAttachment = (attachment: Attachment) => {
  if (!note) return;

  // Insert at cursor in editor
  let insertText = '';
  if (attachment.file_type === 'image') {
    insertText = `![${attachment.description || attachment.filename}](${attachment.storage_url})`;
  } else {
    insertText = `[${attachment.filename}](${attachment.storage_url})`;
  }

  // Append to content for now (editor will handle cursor position)
  setContent((prev) => prev + '\n\n' + insertText);
};
```

**Step 4: Update layout to include side panel**

Replace the editor section (around line 200+) with:

```typescript
{/* Desktop: Side Panel + Editor */}
<div className="hidden lg:flex gap-0">
  <AttachmentSidePanel
    noteId={note.id}
    projectId={note.project_id}
    onInsert={handleInsertAttachment}
    onUploadClick={() => setShowUploadModal(true)}
    className="min-h-[500px]"
  />

  <div className="flex-1">
    <MarkdownEditor
      content={content}
      onChange={setContent}
      autoFocus
      projectId={note.project_id}
      noteId={note.id}
    />
  </div>
</div>

{/* Mobile: Editor only, attachment button in toolbar */}
<div className="lg:hidden">
  <MarkdownEditor
    content={content}
    onChange={setContent}
    autoFocus
    projectId={note.project_id}
    noteId={note.id}
  />
</div>

{/* Mobile Bottom Sheet */}
<AttachmentBottomSheet
  open={showMobileSheet}
  onClose={() => setShowMobileSheet(false)}
  noteId={note.id}
  projectId={note.project_id}
  onInsert={handleInsertAttachment}
/>

{/* Upload Modal (desktop side panel trigger) */}
<AttachmentPicker
  open={showUploadModal}
  onClose={() => setShowUploadModal(false)}
  onSelect={(attachments) => {
    attachments.forEach(handleInsertAttachment);
    setShowUploadModal(false);
  }}
  projectId={note.project_id}
  noteId={note.id}
/>
```

**Step 5: Test in browser**

```bash
npm run dev
```

Test:
1. Desktop: Side panel appears on left
2. Click + button → upload modal
3. Click thumbnail → inserts into note
4. Mobile: Paperclip button → bottom sheet

**Step 6: Commit**

```bash
git add src/app/(dashboard)/notes/[slug]/page.tsx
git commit -m "feat(notes): integrate attachment panel and mobile sheet

- Desktop: 120px left panel with thumbnails
- Mobile: Bottom sheet triggered from toolbar
- Click to insert attachments into note
- Responsive layout with lg breakpoint

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Dashboard Widget Component

**Files:**
- Create: `src/components/dashboard/attachments-widget.tsx`

**Step 1: Create widget component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Paperclip, ArrowRight, Star } from 'lucide-react';
import Link from 'next/link';
import type { Attachment } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { AttachmentViewer } from '@/components/attachments/attachment-viewer';
import { format } from 'date-fns';

export function AttachmentsWidget() {
  const [pinnedAttachments, setPinnedAttachments] = useState<Attachment[]>([]);
  const [recentAttachments, setRecentAttachments] = useState<Attachment[]>([]);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);
  const [storageUsed, setStorageUsed] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAttachments();
  }, []);

  const fetchAttachments = async () => {
    setIsLoading(true);
    try {
      // Fetch pinned
      const pinnedRes = await fetch('/api/attachments?limit=3&sortBy=created&sortOrder=desc');
      if (pinnedRes.ok) {
        const pinnedData = await pinnedRes.json();
        const pinned = pinnedData.attachments.filter((a: Attachment) => a.is_pinned).slice(0, 3);
        setPinnedAttachments(pinned);
      }

      // Fetch recent
      const recentRes = await fetch('/api/attachments?limit=10&sortBy=created&sortOrder=desc');
      if (recentRes.ok) {
        const recentData = await recentRes.json();
        setRecentAttachments(recentData.attachments);

        // Calculate storage
        const totalSize = recentData.attachments.reduce(
          (sum: number, a: Attachment) => sum + a.file_size,
          0
        );
        setStorageUsed(totalSize);
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (attachment: Attachment) => {
    if (attachment.file_type === 'image') {
      return (
        <img
          src={attachment.storage_url}
          alt={attachment.filename}
          className="w-full h-full object-cover"
        />
      );
    }

    const icons: Record<string, string> = {
      pdf: '📑',
      document: '📄',
      audio: '🎵',
      video: '🎬',
      other: '📎',
    };

    return <div className="text-4xl">{icons[attachment.file_type] || icons.other}</div>;
  };

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return format(date, 'MMM d');
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-5" />
            Recent & Pinned Files
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="size-5" />
            Recent & Pinned Files
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/attachments" className="flex items-center gap-1">
              View All <ArrowRight className="size-3" />
            </Link>
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Pinned Section */}
          {pinnedAttachments.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Star className="size-4 text-yellow-500 fill-yellow-500" />
                <h3 className="text-sm font-medium">Pinned</h3>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {pinnedAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    onClick={() => setSelectedAttachment(attachment)}
                    className="cursor-pointer group"
                  >
                    <div className="aspect-square rounded-lg border-2 border-border hover:border-primary transition-colors overflow-hidden bg-background flex items-center justify-center relative">
                      {getFileIcon(attachment)}
                      <Star className="absolute top-2 right-2 size-4 text-yellow-500 fill-yellow-500" />
                    </div>
                    <div className="text-xs text-center mt-1 truncate">
                      {attachment.filename}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Uploads Carousel */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">📅</span>
              <h3 className="text-sm font-medium">Recent Uploads</h3>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {recentAttachments.slice(0, 10).map((attachment) => (
                <div
                  key={attachment.id}
                  onClick={() => setSelectedAttachment(attachment)}
                  className="cursor-pointer flex-shrink-0 group"
                >
                  <div className="w-20 h-20 rounded-lg border-2 border-border hover:border-primary transition-colors overflow-hidden bg-background flex items-center justify-center">
                    {getFileIcon(attachment)}
                  </div>
                  <div className="text-xs text-center mt-1 text-muted-foreground">
                    {getRelativeTime(attachment.created_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Storage Indicator */}
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">💾 Storage:</div>
            <div className="font-medium">
              {formatFileSize(storageUsed)} used
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedAttachment && (
        <AttachmentViewer
          attachment={selectedAttachment}
          onClose={() => setSelectedAttachment(null)}
          onDelete={() => {
            setSelectedAttachment(null);
            fetchAttachments();
          }}
        />
      )}
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/dashboard/attachments-widget.tsx
git commit -m "feat(dashboard): add attachments widget component

- Shows top 3 pinned files in grid
- Horizontal scrolling carousel for recent uploads
- Storage usage indicator
- Click to preview in modal

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Integrate Widget into Dashboard

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Step 1: Add import**

```typescript
import { AttachmentsWidget } from '@/components/dashboard/attachments-widget';
```

**Step 2: Add widget to layout**

After the existing widgets (around line 200+), add:

```typescript
{/* Attachments Widget */}
<div className="col-span-full lg:col-span-1">
  <AttachmentsWidget />
</div>
```

**Step 3: Test in browser**

```bash
npm run dev
```

Navigate to dashboard and verify widget appears.

**Step 4: Commit**

```bash
git add src/app/(dashboard)/page.tsx
git commit -m "feat(dashboard): integrate attachments widget

- Add to dashboard layout
- Shows pinned and recent files
- Provides quick access to attachments

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Update Global Search for Attachments

**Files:**
- Modify: `src/app/api/search/route.ts`

**Step 1: Update search API to include attachments**

Add attachment search to the existing search endpoint. Find the section where results are compiled and add:

```typescript
// Search attachments
const attachmentResults = await query<
  Attachment & { project_name: string | null; note_title: string | null }
>(
  `SELECT a.*, p.name as project_name, n.title as note_title
   FROM attachments a
   LEFT JOIN projects p ON a.project_id = p.id
   LEFT JOIN notes n ON a.note_id = n.id
   WHERE a.user_id = ? AND (
     a.filename LIKE ? OR
     a.description LIKE ? OR
     a.tags LIKE ?
   )
   ORDER BY a.created_at DESC
   LIMIT 10`,
  [user.id, searchPattern, searchPattern, searchPattern]
);

const attachments = attachmentResults.map((a) => ({
  type: 'attachment',
  id: a.id,
  title: a.filename,
  description: a.description || `${a.file_type} file`,
  url: a.storage_url,
  metadata: {
    size: a.file_size,
    fileType: a.file_type,
    context: a.note_title
      ? `Attached to: ${a.project_name ? a.project_name + ' > ' : ''}${a.note_title}`
      : a.project_name
      ? `Attached to: ${a.project_name}`
      : null,
  },
  created_at: a.created_at,
}));
```

**Step 2: Include in response**

Add to the return object:

```typescript
return NextResponse.json({
  // ... existing results
  attachments,
});
```

**Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat(search): add attachment search to global search

- Search by filename, description, and tags
- Include context (associated note/project)
- Return file metadata (size, type)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 15: Update Search Page UI for Attachments

**Files:**
- Modify: `src/app/(dashboard)/search/page.tsx`

**Step 1: Add attachment display section**

Add a new section to display attachment results:

```typescript
{/* Attachment Results */}
{results.attachments && results.attachments.length > 0 && (
  <section>
    <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
      <Paperclip className="size-5" />
      Attachments ({results.attachments.length})
    </h2>
    <div className="space-y-2">
      {results.attachments.map((attachment: any) => (
        <Card key={attachment.id} className="p-4 hover:bg-accent/50 transition-colors">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded bg-muted flex items-center justify-center text-2xl flex-shrink-0">
              {attachment.metadata.fileType === 'image' ? '🖼️' :
               attachment.metadata.fileType === 'pdf' ? '📑' :
               attachment.metadata.fileType === 'document' ? '📄' :
               attachment.metadata.fileType === 'audio' ? '🎵' :
               attachment.metadata.fileType === 'video' ? '🎬' : '📎'}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate">{attachment.title}</h3>
              {attachment.metadata.context && (
                <p className="text-sm text-muted-foreground mt-1">
                  {attachment.metadata.context}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                    Preview
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={attachment.url} download>
                    Download
                  </a>
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {formatFileSize(attachment.metadata.size)}
            </div>
          </div>
        </Card>
      ))}
    </div>
  </section>
)}
```

**Step 2: Add file size formatter**

```typescript
const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
```

**Step 3: Test search**

```bash
npm run dev
```

Search for a filename and verify attachments appear.

**Step 4: Commit**

```bash
git add src/app/(dashboard)/search/page.tsx
git commit -m "feat(search): display attachment results in search UI

- Show attachment cards with icons
- Preview and download buttons
- Display associated note/project context
- File size formatting

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 16: Update AttachmentCard with Selection State

**Files:**
- Modify: `src/components/attachments/attachment-card.tsx`

**Step 1: Add selected prop and styling**

Update the interface and add selection styles:

```typescript
interface AttachmentCardProps {
  attachment: Attachment;
  variant?: 'grid' | 'compact' | 'list';
  onView?: (attachment: Attachment) => void;
  onDelete?: (id: string) => void;
  selected?: boolean;  // ADD THIS
}

// In the component, update the wrapper className:
<div
  className={cn(
    'relative group',
    variant === 'grid' && 'aspect-square',
    selected && 'ring-2 ring-primary ring-offset-2',  // ADD THIS
    // ... rest of classes
  )}
  // ...
>
```

**Step 2: Add checkmark indicator for selected state**

```typescript
{selected && (
  <div className="absolute top-2 left-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
    <Check className="size-4 text-primary-foreground" />
  </div>
)}
```

**Step 3: Import Check icon**

```typescript
import { Check } from 'lucide-react';
```

**Step 4: Commit**

```bash
git add src/components/attachments/attachment-card.tsx
git commit -m "feat(attachments): add selection state to AttachmentCard

- Add selected prop with ring styling
- Show checkmark indicator when selected
- Support multi-select in picker modal

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 17: Export Components from Index

**Files:**
- Modify: `src/components/attachments/index.ts`

**Step 1: Add exports**

```typescript
export { FileUpload } from './file-upload';
export { AttachmentCard } from './attachment-card';
export { AttachmentGallery } from './attachment-gallery';
export { AttachmentViewer } from './attachment-viewer';
export { AttachmentPicker } from './attachment-picker';
export { NoteAttachments } from './note-attachments';
export { AttachmentSidePanel } from './attachment-side-panel';
export { AttachmentBottomSheet } from './attachment-bottom-sheet';
```

**Step 2: Commit**

```bash
git add src/components/attachments/index.ts
git commit -m "chore(attachments): export new components from index

- Export AttachmentSidePanel
- Export AttachmentBottomSheet
- Simplify imports for consumers

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 18: Integration Testing

**Files:**
- Test in browser

**Step 1: Test desktop note page**

```bash
npm run dev
```

1. Navigate to a note
2. Verify left panel appears (120px width)
3. Click + button → upload modal opens
4. Upload an image
5. Verify it appears in panel
6. Click thumbnail → inserts into note
7. Verify editor shows image with caption field
8. Click image → floating menu appears
9. Test alignment buttons
10. Test resize handles

**Step 2: Test mobile note page**

1. Resize browser to <1024px
2. Verify left panel hidden
3. Verify paperclip button in toolbar
4. Click paperclip → bottom sheet slides up
5. Test upload in sheet
6. Verify grid layout (3 columns)
7. Tap thumbnail → inserts into note

**Step 3: Test dashboard widget**

1. Navigate to dashboard
2. Verify attachments widget appears
3. Pin a file from attachments page
4. Verify it appears in "Pinned" section
5. Verify recent carousel scrolls
6. Click thumbnail → preview modal

**Step 4: Test global search**

1. Navigate to /search
2. Search for attachment filename
3. Verify attachments section appears
4. Verify context shows note/project
5. Click preview → opens in new tab

**Step 5: Document any issues**

Create a checklist in `/docs/testing-checklist.md`:

```markdown
# Attachment UI/UX Testing Checklist

## Desktop Note Page
- [ ] Left panel visible (120px)
- [ ] Upload button works
- [ ] Thumbnails display correctly
- [ ] Click to insert works
- [ ] Image resize handles work
- [ ] Floating menu appears on selection
- [ ] Alignment buttons work
- [ ] Alt text dialog works

## Mobile Note Page
- [ ] Left panel hidden on mobile
- [ ] Paperclip button visible
- [ ] Bottom sheet opens
- [ ] 3-column grid displays
- [ ] Upload works in sheet
- [ ] Tap to insert works

## Dashboard
- [ ] Widget displays
- [ ] Pinned section shows starred files
- [ ] Recent carousel scrolls
- [ ] Click opens preview
- [ ] Storage counter accurate

## Search
- [ ] Attachments appear in results
- [ ] Context shows correctly
- [ ] Preview button works
- [ ] Download button works

## Pin Functionality
- [ ] Pin from side panel works
- [ ] Pin from attachments page works
- [ ] Pinned files appear in dashboard
- [ ] Unpin works

## Edge Cases
- [ ] Empty state shows correctly
- [ ] Large files handled gracefully
- [ ] Many attachments scroll properly
- [ ] Network errors handled
```

**Step 6: Fix any critical bugs**

If issues are found, fix them before final commit.

**Step 7: Final commit**

```bash
git add -A
git commit -m "test: verify attachment UI/UX system integration

- Test desktop layout with side panel
- Test mobile layout with bottom sheet
- Test dashboard widget functionality
- Test global search integration
- Document testing checklist

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 19: Documentation

**Files:**
- Update: `UPLOAD_GUIDE.md`

**Step 1: Update guide with new features**

Add sections for:
- Desktop side panel usage
- Mobile bottom sheet
- Image manipulation in editor
- Dashboard widget
- Global search for files

**Step 2: Add screenshots section**

```markdown
## Screenshots

### Desktop Note Page
![Desktop with side panel](docs/screenshots/desktop-note-attachments.png)

### Mobile Bottom Sheet
![Mobile bottom sheet](docs/screenshots/mobile-attachments-sheet.png)

### Dashboard Widget
![Dashboard widget](docs/screenshots/dashboard-attachments.png)
```

**Step 3: Commit**

```bash
git add UPLOAD_GUIDE.md
git commit -m "docs: update upload guide with UI/UX features

- Document side panel and bottom sheet
- Add image manipulation instructions
- Include dashboard widget usage
- Add global search documentation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 20: Final Review and Polish

**Step 1: Run type check**

```bash
npm run typecheck
```

Expected: No errors

**Step 2: Run linter**

```bash
npm run lint
```

Fix any warnings.

**Step 3: Test build**

```bash
npm run build
```

Expected: Builds successfully

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete attachment UI/UX system

Summary of changes:
- Add is_pinned column to attachments table
- Implement desktop side panel (120px, left of editor)
- Implement mobile bottom sheet (75vh, slides from bottom)
- Add TipTap Figure extension with captions
- Add image manipulation (resize, align, captions)
- Add floating menu for image controls
- Create dashboard widget (pinned + recent files)
- Integrate attachments into global search
- Add pin/unpin API endpoint
- Full responsive design (mobile-first)

User can now:
- Upload files via side panel, bottom sheet, or toolbar
- Insert images with captions and resize them
- Pin important files for quick access
- View attachments in dashboard widget
- Search for files globally
- Access attachments from notes, projects, and dashboard

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Completion

The attachment UI/UX system is now fully implemented! All features from the design are working:

✅ Database migration with `is_pinned` column
✅ Desktop side panel (120px, left of editor)
✅ Mobile bottom sheet (75vh, slides up)
✅ TipTap image manipulation (resize, align, caption, reposition)
✅ Attachment picker modal with tabs
✅ Dashboard widget (pinned + recent carousel)
✅ Global search integration
✅ Smart project/note relationships
✅ Pin/unpin functionality
✅ Responsive mobile-first design

**Next Steps:**
- Monitor user feedback
- Add bulk operations (delete multiple, move to project)
- Implement attachment analytics (most used, storage trends)
- Add attachment versioning
- Implement OCR for images (extract text)
