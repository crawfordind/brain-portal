# Attachment Components

This directory contains all components for the file and image management system.

## Components

### FileUpload
Drag-and-drop file upload component with progress tracking.

```tsx
import { FileUpload } from '@/components/attachments';

<FileUpload
  onUploadComplete={(attachment) => console.log('Uploaded:', attachment)}
  projectId={projectId}
  noteId={noteId}
  maxFiles={5}
/>
```

### AttachmentCard
Display individual attachments with thumbnail, metadata, and actions.

```tsx
import { AttachmentCard } from '@/components/attachments';

<AttachmentCard
  attachment={attachment}
  onDelete={(id) => console.log('Deleted:', id)}
  onView={(att) => console.log('View:', att)}
  variant="default" // or "compact"
/>
```

### AttachmentGallery
Full-featured gallery with filtering, search, and view modes.

```tsx
import { AttachmentGallery } from '@/components/attachments';

<AttachmentGallery
  projectId={projectId}
  noteId={noteId}
/>
```

### AttachmentViewer
Modal viewer for previewing attachments with metadata sidebar.

```tsx
import { AttachmentViewer } from '@/components/attachments';

<AttachmentViewer
  attachment={attachment}
  onClose={() => setSelectedAttachment(null)}
  onDelete={() => handleDelete(attachment.id)}
/>
```

### AttachmentPicker
Picker dialog for inserting attachments into TipTap editor.

```tsx
import { AttachmentPicker, insertAttachmentReference } from '@/components/attachments';

// In your editor toolbar
<AttachmentPicker
  projectId={projectId}
  noteId={noteId}
  onSelect={(attachment) => insertAttachmentReference(editor, attachment)}
/>
```

## Integration with TipTap Editor

To add attachment support to the markdown editor, you need to:

1. **Install TipTap Image extension:**
```bash
npm install @tiptap/extension-image
```

2. **Update the markdown editor:**

```tsx
// In src/components/editor/markdown-editor.tsx
import Image from '@tiptap/extension-image';
import { AttachmentPicker, insertAttachmentReference } from '@/components/attachments';

// Add to extensions array
const editor = useEditor({
  extensions: [
    // ... existing extensions
    Image.configure({
      inline: true,
      HTMLAttributes: {
        class: 'rounded-lg max-w-full h-auto',
      },
    }),
  ],
  // ...
});

// Add to toolbar (after the Link button)
<AttachmentPicker
  projectId={projectId}
  noteId={noteId}
  onSelect={(attachment) => insertAttachmentReference(editor, attachment)}
/>
```

3. **Pass projectId/noteId to editor:**

```tsx
<MarkdownEditor
  content={content}
  onChange={onChange}
  projectId={note.project_id}
  noteId={note.id}
/>
```

## API Usage

### Upload File
```typescript
const formData = new FormData();
formData.append('file', file);
formData.append('projectId', projectId);
formData.append('noteId', noteId);
formData.append('description', 'My file description');
formData.append('tags', 'tag1,tag2');

const response = await fetch('/api/attachments', {
  method: 'POST',
  body: formData,
});

const { attachment } = await response.json();
```

### List Attachments
```typescript
const params = new URLSearchParams({
  projectId: 'abc123',
  fileType: 'image',
  search: 'screenshot',
  limit: '50',
});

const response = await fetch(`/api/attachments?${params}`);
const { attachments, total } = await response.json();
```

### Update Attachment
```typescript
const response = await fetch(`/api/attachments/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description: 'Updated description',
    tags: ['tag1', 'tag2'],
    projectId: 'new-project-id',
  }),
});
```

### Delete Attachment
```typescript
const response = await fetch(`/api/attachments/${id}`, {
  method: 'DELETE',
});
```

## Features

- ✅ Drag & drop file upload
- ✅ File type validation (images, PDFs, audio, video, documents)
- ✅ File size limits per type
- ✅ SHA-256 deduplication
- ✅ Automatic R2 storage
- ✅ Background processing (metadata, thumbnails, descriptions, embeddings)
- ✅ Full-text search (FTS5)
- ✅ Semantic search via embeddings
- ✅ Image preview with thumbnails
- ✅ PDF viewer
- ✅ Audio/video player
- ✅ EXIF metadata extraction
- ✅ AI-generated descriptions
- ✅ Grid and list view modes
- ✅ Filter by file type
- ✅ Sort by date, name, size
- ✅ Tags support
- ✅ Project and note associations

## File Processing Pipeline

When a file is uploaded:

1. **Upload** → R2 storage
2. **Metadata extraction** (local tier) → EXIF, dimensions, etc.
3. **Thumbnail generation** (local tier) → 300x300 JPEG for images
4. **Text extraction** (embedding/fast_llm tier):
   - PDFs: Extract text with pdf-parse
   - Images: OCR if needed
   - Audio: Transcribe with Whisper
5. **AI description** (fast_llm tier) → Claude 3 Haiku vision for images
6. **Embedding generation** (embedding tier) → Combine filename + description + text
7. **Search indexing** → FTS5 + semantic search ready

## Supported File Types

- **Images:** JPEG, PNG, GIF, WebP, SVG, HEIC
- **PDFs:** application/pdf
- **Audio:** MP3, WAV, M4A, OGG, WebM
- **Video:** MP4, WebM, QuickTime, AVI
- **Documents:** TXT, Markdown, CSV, Word, Excel, PowerPoint
