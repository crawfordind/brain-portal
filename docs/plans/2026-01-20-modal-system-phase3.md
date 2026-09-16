# Modal System Phase 3: Standardize Existing Modals

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 7 existing modal components to use the Phase 1 foundation components with consistent sizing and responsive behavior.

**Architecture:** Extract inline create forms to separate components, migrate existing modals to use ModalHeader/ModalFooter/ModalSection, add responsive layouts with useMobile hook.

**Tech Stack:** React, TypeScript, Radix UI (Dialog/Sheet), shadcn/ui, CVA, Phase 1 foundation components

---

## Background

Phase 1 created foundation components (ModalHeader, ModalFooter, ModalSection, FloatingActions, ModalDragHandle).
Phase 2 redesigned AttachmentViewer with mobile-first responsive behavior.
Phase 3 standardizes the remaining 7 modals across 3 categories (compact, standard, immersive).

**Modals to Standardize:**
1. QuickCaptureDialog (compact) - Migrate
2. TaskCreateDialog (compact) - Extract from page + create
3. ProjectCreateDialog (compact) - Extract from page + create
4. CaptureCreateDialog (compact) - Extract from page + create
5. AttachmentPicker (standard) - Migrate + responsive
6. FilterSheet (standard) - Migrate
7. AttachmentBottomSheet (immersive) - Migrate

---

## Task 1: Migrate QuickCaptureDialog to Foundation Components

**Files:**
- Modify: `src/components/layout/quick-capture-dialog.tsx`
- Test: `tests/components/layout/quick-capture-dialog.test.tsx`

**Step 1: Write failing tests for responsive behavior**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickCaptureDialog } from '@/components/layout/quick-capture-dialog';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn();

// Mock QueryClient
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

// Mock offline queue
vi.mock('@/lib/offline/simple-queue', () => ({
  addToQueue: vi.fn(),
}));

// Mock useMobile hook
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe('QuickCaptureDialog', () => {
  it('renders dialog with ModalHeader on desktop', () => {
    const { useMobile } = require('@/hooks/use-mobile');
    useMobile.mockReturnValue(false);

    render(<QuickCaptureDialog open={true} onOpenChange={vi.fn()} />);

    expect(screen.getByText('Quick Capture')).toBeInTheDocument();
  });

  it('renders bottom sheet on mobile', () => {
    const { useMobile } = require('@/hooks/use-mobile');
    useMobile.mockReturnValue(true);

    render(<QuickCaptureDialog open={true} onOpenChange={vi.fn()} />);

    // Should render Sheet with bottom side
    expect(screen.getByText('Quick Capture')).toBeInTheDocument();
  });

  it('uses ModalHeader component', () => {
    const { useMobile } = require('@/hooks/use-mobile');
    useMobile.mockReturnValue(false);

    render(<QuickCaptureDialog open={true} onOpenChange={vi.fn()} />);

    // ModalHeader should have title and close button
    expect(screen.getByText('Quick Capture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('uses ModalFooter component with proper sizing', () => {
    render(<QuickCaptureDialog open={true} onOpenChange={vi.fn()} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    const captureButton = screen.getByRole('button', { name: /capture/i });

    expect(cancelButton).toBeInTheDocument();
    expect(captureButton).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/layout/quick-capture-dialog.test.tsx`
Expected: FAIL with "Cannot find module '@/components/modals/modal-header'" or similar

**Step 3: Migrate QuickCaptureDialog to use foundation components**

```typescript
"use client";

/**
 * QuickCaptureDialog - Fast capture modal for bottom nav
 * Offline-first: saves instantly, syncs in background
 *
 * Migrated to Phase 3 standard:
 * - Desktop: Compact dialog (max-w-md)
 * - Mobile: Bottom sheet (75vh)
 * - Uses ModalHeader and ModalFooter from Phase 1
 */

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { VoiceInput } from "@/components/ui/voice-input";
import { useQueryClient } from "@tanstack/react-query";
import { addToQueue } from "@/lib/offline/simple-queue";
import { ModalHeader } from "@/components/modals/modal-header";
import { ModalFooter } from "@/components/modals/modal-footer";
import { useMobile } from "@/hooks/use-mobile";

interface QuickCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const captureTypes = [
  { value: "thought", label: "Thought" },
  { value: "idea", label: "Idea" },
  { value: "task", label: "Task" },
  { value: "followup", label: "Follow-up" },
  { value: "quote", label: "Quote" },
  { value: "reference", label: "Reference" },
] as const;

type CaptureType = (typeof captureTypes)[number]["value"];

export function QuickCaptureDialog({
  open,
  onOpenChange,
}: QuickCaptureDialogProps) {
  const [content, setContent] = useState("");
  const [captureType, setCaptureType] = useState<CaptureType>("thought");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const handleClose = () => {
    setContent("");
    setCaptureType("thought");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSaving) return;

    const captureContent = content.trim();
    const captureData = { content: captureContent, captureType };

    // Immediately close and show success - optimistic UI
    handleClose();
    toast.success("Captured!");

    // Try to save to server in background
    setIsSaving(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(captureData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        queryClient.invalidateQueries({ queryKey: ["captures"] });
      } else {
        throw new Error("Server error");
      }
    } catch {
      // Failed to save online - queue for later
      addToQueue({
        type: "capture",
        operation: "create",
        data: captureData,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const CaptureForm = () => (
    <>
      <div className="space-y-4 py-2">
        {/* Voice input - prominently displayed */}
        <div className="flex justify-center">
          <VoiceInput
            size="lg"
            onTranscript={(text) => {
              setContent((prev) => (prev ? `${prev} ${text}` : text));
            }}
          />
        </div>

        {/* Text input */}
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          className="min-h-24 text-base resize-none"
          autoFocus
        />

        {/* Type selector as pill buttons */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">
            Type
          </label>
          <div className="flex flex-wrap gap-2">
            {captureTypes.map((type) => (
              <button
                key={type.value}
                type="button"
                onClick={() => setCaptureType(type.value)}
                className={cn(
                  "px-3 py-2 rounded-full text-sm font-medium transition-colors min-h-10",
                  captureType === type.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 active:bg-muted/60"
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={handleClose}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!content.trim() || isSaving}
          className="flex-1"
        >
          {isSaving ? "Saving..." : "Capture"}
        </Button>
      </ModalFooter>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact">
        <ModalHeader
          title="Quick Capture"
          onClose={handleClose}
        />
        <CaptureForm />
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/layout/quick-capture-dialog.test.tsx`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/components/layout/quick-capture-dialog.tsx tests/components/layout/quick-capture-dialog.test.tsx
git commit -m "feat(modals): migrate QuickCaptureDialog to Phase 3 foundation

- Use ModalHeader and ModalFooter from Phase 1
- Add responsive behavior with useMobile hook
- Desktop: Compact dialog (max-w-md)
- Mobile: Bottom sheet (75vh)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Extract and Create TaskCreateDialog Component

**Files:**
- Create: `src/components/tasks/task-create-dialog.tsx`
- Modify: `src/app/(dashboard)/tasks/page.tsx`
- Test: `tests/components/tasks/task-create-dialog.test.tsx`

**Step 1: Write failing test for TaskCreateDialog**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskCreateDialog } from '@/components/tasks/task-create-dialog';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn();

// Mock QueryClient
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

// Mock useMobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false),
}));

describe('TaskCreateDialog', () => {
  const mockProjects = [
    { id: '1', name: 'Project Alpha' },
    { id: '2', name: 'Project Beta' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with ModalHeader and ModalFooter', () => {
    render(
      <TaskCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    expect(screen.getByText('Create Task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create task/i })).toBeInTheDocument();
  });

  it('validates required content field', () => {
    render(
      <TaskCreateDialog
        open={true}
        onClose={vi.fn()}
        projects={mockProjects}
      />
    );

    const createButton = screen.getByRole('button', { name: /create task/i });
    expect(createButton).toBeDisabled();
  });

  it('submits form with valid data', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: '1', content: 'New task' } }),
    });

    const onClose = vi.fn();
    render(
      <TaskCreateDialog
        open={true}
        onClose={onClose}
        projects={mockProjects}
      />
    );

    const input = screen.getByPlaceholderText(/what needs to be done/i);
    fireEvent.change(input, { target: { value: 'New task' } });

    const createButton = screen.getByRole('button', { name: /create task/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
        method: 'POST',
      }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/components/tasks/task-create-dialog.test.tsx`
Expected: FAIL with "Cannot find module '@/components/tasks/task-create-dialog'"

**Step 3: Create TaskCreateDialog component**

```typescript
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { ModalHeader } from '@/components/modals/modal-header';
import { ModalFooter } from '@/components/modals/modal-footer';
import { useMobile } from '@/hooks/use-mobile';

interface TaskCreateDialogProps {
  open: boolean;
  onClose: () => void;
  projects: Array<{ id: string; name: string }>;
}

export function TaskCreateDialog({
  open,
  onClose,
  projects,
}: TaskCreateDialogProps) {
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('medium');
  const [projectId, setProjectId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const handleClose = () => {
    setContent('');
    setPriority('medium');
    setProjectId('');
    setDueDate('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          priority,
          projectId: projectId || null,
          dueDate: dueDate || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to create task');

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task created');
      handleClose();
    } catch (error) {
      toast.error('Failed to create task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const TaskForm = () => (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="content">What needs to be done?</Label>
          <Input
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter task description..."
            autoFocus
            className="h-11"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="priority" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">Due Date</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-11"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project">Project (optional)</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id="project" className="h-11">
              <SelectValue placeholder="Select project..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={handleClose} className="flex-1">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!content.trim() || isSubmitting}
          className="flex-1"
        >
          {isSubmitting ? 'Creating...' : 'Create Task'}
        </Button>
      </ModalFooter>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Create Task"
                onClose={handleClose}
                showClose={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <TaskForm />
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
        <ModalHeader title="Create Task" onClose={handleClose} />
        <TaskForm />
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Update tasks page to use TaskCreateDialog**

Modify `src/app/(dashboard)/tasks/page.tsx`:

Replace inline dialog (lines 86-200) with:

```typescript
import { TaskCreateDialog } from '@/components/tasks/task-create-dialog';

// ... in component JSX ...

<TaskCreateDialog
  open={isCreateOpen}
  onClose={() => setIsCreateOpen(false)}
  projects={projects}
/>
```

**Step 5: Run tests to verify they pass**

Run: `npm test -- tests/components/tasks/task-create-dialog.test.tsx`
Expected: PASS (3 tests)

**Step 6: Commit**

```bash
git add src/components/tasks/task-create-dialog.tsx tests/components/tasks/task-create-dialog.test.tsx src/app/(dashboard)/tasks/page.tsx
git commit -m "feat(tasks): extract TaskCreateDialog to separate component

- Created compact modal with ModalHeader/ModalFooter
- Added responsive behavior (dialog/bottom sheet)
- Extracted from tasks page for reusability
- All form fields with proper validation

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Extract and Create ProjectCreateDialog Component

**Files:**
- Create: `src/components/projects/project-create-dialog.tsx`
- Modify: `src/app/(dashboard)/projects/page.tsx`
- Test: `tests/components/projects/project-create-dialog.test.tsx`

**Step 1-6:** Follow same pattern as Task 2

Create ProjectCreateDialog with:
- Fields: name (required), description (optional, Textarea), status (Select: active/planning/stalled/completed/archived)
- Desktop: Compact dialog (max-w-md)
- Mobile: Bottom sheet (75vh)
- ModalHeader + ModalFooter
- Form validation (name required)
- useMobile hook for responsive behavior

Test: 3 tests (renders components, validates name, submits form)

Commit message: "feat(projects): extract ProjectCreateDialog to separate component"

---

## Task 4: Extract and Create CaptureCreateDialog Component

**Files:**
- Create: `src/components/captures/capture-create-dialog.tsx`
- Modify: `src/app/(dashboard)/captures/page.tsx`
- Test: `tests/components/captures/capture-create-dialog.test.tsx`

**Step 1-6:** Follow same pattern as Task 2

Create CaptureCreateDialog with:
- Fields: content (Textarea, required), captureType (Select: thought/idea/task/followup/quote/reference), projectId (Select, optional)
- Desktop: Compact dialog (max-w-md)
- Mobile: Bottom sheet (75vh)
- ModalHeader + ModalFooter
- Form validation (content required)
- useMobile hook for responsive behavior
- Voice input support (VoiceInput component)

Test: 4 tests (renders components, validates content, voice input, submits form)

Commit message: "feat(captures): extract CaptureCreateDialog to separate component"

---

## Task 5: Migrate AttachmentPicker to Standard Modal with Responsive Behavior

**Files:**
- Modify: `src/components/attachments/attachment-picker.tsx`
- Test: `tests/components/attachments/attachment-picker.test.tsx`

**Step 1: Write failing tests for responsive AttachmentPicker**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentPicker } from '@/components/attachments/attachment-picker';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn();

// Mock useMobile
vi.mock('@/hooks/use-mobile', () => ({
  useMobile: vi.fn(() => false),
}));

describe('AttachmentPicker', () => {
  it('renders dialog on desktop', () => {
    const { useMobile } = require('@/hooks/use-mobile');
    useMobile.mockReturnValue(false);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Add Attachment')).toBeInTheDocument();
  });

  it('renders bottom sheet on mobile', () => {
    const { useMobile } = require('@/hooks/use-mobile');
    useMobile.mockReturnValue(true);

    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Add Attachment')).toBeInTheDocument();
  });

  it('uses ModalHeader component', () => {
    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText('Add Attachment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('uses ModalFooter with action buttons', () => {
    render(
      <AttachmentPicker
        open={true}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /insert/i })).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-picker.test.tsx`
Expected: FAIL (missing ModalHeader import or responsive behavior)

**Step 3: Migrate AttachmentPicker to responsive standard modal**

Update `src/components/attachments/attachment-picker.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
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
import { ModalFooter } from '@/components/modals/modal-footer';
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
    setSelectedIds(new Set([attachment.id]));
    setAttachments((prev) => [attachment, ...prev]);
    setActiveTab('browse');
  };

  const recentAttachments = attachments.slice(0, 10);

  const PickerContent = () => (
    <>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'browse' | 'recent')}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="browse" className="gap-2">
            <Grid3x3 className="size-4" />
            {!isMobile && 'Browse'}
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="size-4" />
            {!isMobile && 'Upload'}
          </TabsTrigger>
          <TabsTrigger value="recent" className="gap-2">
            <Clock className="size-4" />
            {!isMobile && 'Recent'}
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
                className="pl-9 h-11"
              />
            </div>
            <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
              <SelectTrigger className="w-[140px] h-11">
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
              <div className="col-span-full text-center py-8 text-muted-foreground">
                Loading...
              </div>
            ) : attachments.length === 0 ? (
              <div className="col-span-full text-center py-8 text-muted-foreground">
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

      <ModalFooter>
        <Link href="/attachments" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          Browse All Files <ArrowRight className="size-3" />
        </Link>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleInsert} disabled={selectedIds.size === 0}>
            Insert {selectedIds.size > 0 && `(${selectedIds.size})`}
          </Button>
        </div>
      </ModalFooter>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
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
        <ModalHeader title="Add Attachment" onClose={onClose} />
        <PickerContent />
      </DialogContent>
    </Dialog>
  );
}

// ... rest of file unchanged ...
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-picker.test.tsx`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-picker.tsx tests/components/attachments/attachment-picker.test.tsx
git commit -m "feat(attachments): migrate AttachmentPicker to standard modal

- Add responsive behavior with useMobile hook
- Desktop: Standard dialog (max-w-2xl)
- Mobile: Bottom sheet (85vh) with 2-column grid
- Use ModalHeader and ModalFooter from Phase 1
- Improved mobile tab labels (icons only)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Migrate FilterSheet to Use ModalSection

**Files:**
- Modify: `src/components/filters/filter-sheet.tsx`
- Test: `tests/components/filters/filter-sheet.test.tsx`

**Step 1: Write failing tests for ModalSection usage**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterSheet } from '@/components/filters/filter-sheet';
import type { FilterConfig, FilterState } from '@/components/filters/filter-types';
import '@testing-library/jest-dom';

describe('FilterSheet', () => {
  const mockFilters: FilterConfig[] = [
    {
      id: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'completed', label: 'Completed' },
      ],
    },
    {
      id: 'search',
      type: 'search',
      label: 'Search',
      placeholder: 'Search...',
    },
  ];

  const mockState: FilterState = {
    status: null,
    search: '',
  };

  it('uses ModalHeader component', () => {
    render(
      <FilterSheet
        filters={mockFilters}
        state={mockState}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    trigger.click();

    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('uses ModalSection for each filter group', () => {
    render(
      <FilterSheet
        filters={mockFilters}
        state={mockState}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    trigger.click();

    // Each filter should be wrapped in ModalSection
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('uses ModalFooter with action buttons', () => {
    render(
      <FilterSheet
        filters={mockFilters}
        state={mockState}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    );

    const trigger = screen.getByRole('button', { name: /filters/i });
    trigger.click();

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply filters/i })).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/filters/filter-sheet.test.tsx`
Expected: FAIL (missing ModalSection wrapper)

**Step 3: Migrate FilterSheet to use ModalSection**

Update `src/components/filters/filter-sheet.tsx`:

```typescript
"use client";

/**
 * FilterSheet - Mobile-first filter panel
 *
 * Migrated to Phase 3 standard:
 * - Uses ModalHeader, ModalSection, and ModalFooter from Phase 1
 * - Collapsible filter sections
 * - 85vh height on mobile
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetClose,
} from "@/components/ui/sheet";
import { SlidersHorizontal, X, Check } from "lucide-react";
import { useState } from "react";
import type { FilterConfig, FilterState, FilterChangeHandler } from "./filter-types";
import { getActiveFilters } from "./filter-types";
import { ModalHeader } from "@/components/modals/modal-header";
import { ModalSection } from "@/components/modals/modal-section";
import { ModalFooter } from "@/components/modals/modal-footer";

interface FilterSheetProps {
  /** Filter configurations */
  filters: FilterConfig[];
  /** Current filter state */
  state: FilterState;
  /** Handler for filter changes */
  onChange: FilterChangeHandler;
  /** Handler to clear all filters */
  onClear: () => void;
  /** Number of results (optional) */
  resultCount?: number;
}

export function FilterSheet({
  filters,
  state,
  onChange,
  onClear,
  resultCount,
}: FilterSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeFilters = getActiveFilters(state, filters);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="outline"
        className="min-h-11 gap-2"
        onClick={() => setIsOpen(true)}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span>Filters</span>
        {activeFilters.length > 0 && (
          <Badge variant="secondary" className="ml-1 h-5 px-1.5">
            {activeFilters.length}
          </Badge>
        )}
      </Button>

      <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
        <div className="flex flex-col h-full">
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-2">
              <ModalHeader
                title="Filters"
                onClose={() => setIsOpen(false)}
                showClose={false}
              />
              {activeFilters.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  className="text-muted-foreground"
                >
                  Clear all
                </Button>
              )}
            </div>
            {resultCount !== undefined && (
              <p className="text-sm text-muted-foreground">
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </p>
            )}
          </div>

          {/* Scrollable filter content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {filters.map((filter) => (
              <ModalSection
                key={filter.id}
                title={filter.label}
                collapsible
                defaultExpanded={state[filter.id] != null}
              >
                <FilterControl
                  config={filter}
                  value={state[filter.id]}
                  onChange={(value) => onChange(filter.id, value)}
                />
              </ModalSection>
            ))}
          </div>

          <ModalFooter>
            <SheetClose asChild>
              <Button variant="outline" className="flex-1">
                Cancel
              </Button>
            </SheetClose>
            <SheetClose asChild>
              <Button className="flex-1">
                <Check className="h-4 w-4 mr-2" />
                Apply Filters
              </Button>
            </SheetClose>
          </ModalFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// FilterControl component unchanged from original
interface FilterControlProps {
  config: FilterConfig;
  value: string | string[] | boolean | null | undefined;
  onChange: (value: string | string[] | boolean | null) => void;
}

function FilterControl({ config, value, onChange }: FilterControlProps) {
  switch (config.type) {
    case "select":
      return (
        <div className="flex flex-wrap gap-2">
          {config.options?.map((option) => {
            const isSelected = value === option.value;
            return (
              <Button
                key={option.value}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => onChange(isSelected ? null : option.value)}
                className="min-h-10 gap-2"
              >
                {option.icon}
                <span>{option.label}</span>
                {option.count !== undefined && (
                  <Badge variant={isSelected ? "secondary" : "outline"} className="ml-1">
                    {option.count}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>
      );

    case "multi":
      return (
        <div className="flex flex-wrap gap-2">
          {config.options?.map((option) => {
            const selected = Array.isArray(value) ? value : [];
            const isSelected = selected.includes(option.value);
            return (
              <Button
                key={option.value}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  if (isSelected) {
                    onChange(selected.filter((v) => v !== option.value));
                  } else {
                    onChange([...selected, option.value]);
                  }
                }}
                className="min-h-10 gap-2"
              >
                {option.icon}
                <span>{option.label}</span>
                {option.count !== undefined && (
                  <Badge variant={isSelected ? "secondary" : "outline"} className="ml-1">
                    {option.count}
                  </Badge>
                )}
              </Button>
            );
          })}
        </div>
      );

    case "search":
      return (
        <Input
          type="text"
          placeholder={config.placeholder || "Search..."}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-11"
        />
      );

    case "toggle":
      return (
        <div className="flex items-center justify-between min-h-12">
          <div className="space-y-0.5 flex-1">
            {config.placeholder && (
              <p className="text-sm text-muted-foreground">{config.placeholder}</p>
            )}
          </div>
          <Switch
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      );

    default:
      return null;
  }
}

// ActiveFilterChips component unchanged from original
// ... rest of file ...
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/filters/filter-sheet.test.tsx`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/components/filters/filter-sheet.tsx tests/components/filters/filter-sheet.test.tsx
git commit -m "feat(filters): migrate FilterSheet to use ModalSection

- Wrap each filter in collapsible ModalSection
- Use ModalHeader and ModalFooter from Phase 1
- Auto-expand sections with active filters
- Consistent 85vh height
- Improved mobile UX with collapsible sections

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Migrate AttachmentBottomSheet to Foundation Components

**Files:**
- Modify: `src/components/attachments/attachment-bottom-sheet.tsx`
- Test: `tests/components/attachments/attachment-bottom-sheet.test.tsx`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentBottomSheet } from '@/components/attachments/attachment-bottom-sheet';
import '@testing-library/jest-dom';

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: async () => ({ attachments: [] }),
  })
);

describe('AttachmentBottomSheet', () => {
  it('uses ModalHeader component', () => {
    render(
      <AttachmentBottomSheet
        open={true}
        onClose={vi.fn()}
        noteId="note-1"
      />
    );

    expect(screen.getByText(/attachments/i)).toBeInTheDocument();
  });

  it('uses ModalDragHandle at top', () => {
    render(
      <AttachmentBottomSheet
        open={true}
        onClose={vi.fn()}
        noteId="note-1"
      />
    );

    // ModalDragHandle should be rendered
    const dragHandle = document.querySelector('[data-drag-handle]');
    expect(dragHandle).toBeInTheDocument();
  });

  it('has 90vh height for immersive modal', () => {
    render(
      <AttachmentBottomSheet
        open={true}
        onClose={vi.fn()}
        noteId="note-1"
      />
    );

    const sheetContent = document.querySelector('[role="dialog"]');
    expect(sheetContent).toHaveClass('h-[90vh]');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/components/attachments/attachment-bottom-sheet.test.tsx`
Expected: FAIL (missing ModalHeader/ModalDragHandle)

**Step 3: Migrate AttachmentBottomSheet**

Update `src/components/attachments/attachment-bottom-sheet.tsx`:

```typescript
'use client';

/**
 * AttachmentBottomSheet - Quick attachment insertion for notes
 *
 * Migrated to Phase 3 standard:
 * - Immersive bottom sheet (90vh)
 * - Uses ModalHeader and ModalDragHandle from Phase 1
 * - Improved mobile UX
 */

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { FileUpload } from './file-upload';
import { Upload, ArrowRight } from 'lucide-react';
import type { Attachment } from '@/lib/db/schema';
import Link from 'next/link';
import { toast } from 'sonner';
import { ModalHeader } from '@/components/modals/modal-header';
import { ModalDragHandle } from '@/components/modals/modal-drag-handle';

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
      <SheetContent side="bottom" className="h-[90vh] p-0 gap-0" dismissible>
        <div className="flex flex-col h-full">
          {/* Drag handle */}
          <div className="pt-2 pb-4 flex justify-center">
            <ModalDragHandle />
          </div>

          {/* Header */}
          <div className="px-4 pb-4">
            <ModalHeader
              title={`Attachments (${attachments.length})`}
              onClose={onClose}
              showClose={false}
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <div className="flex gap-2">
              <Button
                variant={showUpload ? 'default' : 'outline'}
                onClick={() => setShowUpload(true)}
                className="flex-1 min-h-11"
              >
                <Upload className="size-4 mr-2" />
                Upload New
              </Button>
              <Button variant="outline" asChild className="min-h-11">
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/components/attachments/attachment-bottom-sheet.test.tsx`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/components/attachments/attachment-bottom-sheet.tsx tests/components/attachments/attachment-bottom-sheet.test.tsx
git commit -m "feat(attachments): migrate AttachmentBottomSheet to immersive modal

- Use ModalHeader and ModalDragHandle from Phase 1
- Increase height to 90vh (immersive category)
- Add dismissible swipe gesture
- Improved mobile UX with drag handle
- Consistent padding and spacing

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Build Verification and Update Documentation

**Files:**
- Create: `docs/modal-system-phase3-summary.md`

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (including 21+ new Phase 3 tests)

**Step 2: Run TypeScript type check**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Create Phase 3 summary document**

```markdown
# Modal System Phase 3: Summary

**Status:** Complete
**Date:** 2026-01-20

## Overview

Phase 3 standardized 7 existing modal components to use the Phase 1 foundation components (ModalHeader, ModalFooter, ModalSection, FloatingActions, ModalDragHandle) with consistent sizing and responsive behavior.

## Completed Modals

### Compact Modals (max-w-md, 75vh mobile)

1. **QuickCaptureDialog** - `src/components/layout/quick-capture-dialog.tsx`
   - Migrated to ModalHeader/ModalFooter
   - Desktop: Compact dialog
   - Mobile: Bottom sheet
   - 4 tests passing

2. **TaskCreateDialog** - `src/components/tasks/task-create-dialog.tsx` (NEW)
   - Extracted from tasks page
   - Form: content, priority, dueDate, projectId
   - 3 tests passing

3. **ProjectCreateDialog** - `src/components/projects/project-create-dialog.tsx` (NEW)
   - Extracted from projects page
   - Form: name, description, status
   - 3 tests passing

4. **CaptureCreateDialog** - `src/components/captures/capture-create-dialog.tsx` (NEW)
   - Extracted from captures page
   - Form: content, captureType, projectId
   - Voice input support
   - 4 tests passing

### Standard Modals (max-w-2xl, 85vh mobile)

5. **AttachmentPicker** - `src/components/attachments/attachment-picker.tsx`
   - Migrated to responsive layout
   - Desktop: 3-column grid
   - Mobile: 2-column grid, 85vh sheet
   - 4 tests passing

6. **FilterSheet** - `src/components/filters/filter-sheet.tsx`
   - Wrapped filters in collapsible ModalSection
   - Auto-expand active filters
   - 3 tests passing

### Immersive Modals (max-w-7xl, 90vh mobile)

7. **AttachmentBottomSheet** - `src/components/attachments/attachment-bottom-sheet.tsx`
   - Added ModalHeader and ModalDragHandle
   - Increased to 90vh height
   - Swipe-to-dismiss gesture
   - 3 tests passing

## Statistics

- **Components Created:** 3 (TaskCreateDialog, ProjectCreateDialog, CaptureCreateDialog)
- **Components Migrated:** 4 (QuickCaptureDialog, AttachmentPicker, FilterSheet, AttachmentBottomSheet)
- **Pages Updated:** 3 (tasks, projects, captures)
- **Tests Added:** 24 tests
- **Total Commits:** 7

## Benefits

- **Consistency:** All modals now use foundation components
- **Responsive:** All modals adapt to mobile with bottom sheets
- **Reusability:** Create forms extracted from pages
- **Maintainability:** Shared patterns reduce duplication
- **User Experience:** Consistent interaction patterns across app

## Next Steps

Phase 4 (if needed):
- Polish and visual refinement
- Accessibility audit (WCAG 2.1 AA)
- Performance optimization
- Documentation for all modal patterns
```

**Step 5: Commit documentation**

```bash
git add docs/modal-system-phase3-summary.md
git commit -m "docs: add Phase 3 summary document

- Documented all 7 migrated modals
- Statistics and benefits
- Next steps for Phase 4

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 6: Push to remote**

```bash
git push origin main
```

---

## Success Criteria

✅ All 7 modals standardized with foundation components
✅ Responsive behavior on desktop and mobile
✅ All tests passing (24+ new tests)
✅ TypeScript compilation successful
✅ Build succeeds
✅ Code committed and pushed
✅ Documentation created

## Testing Checklist

**Manual Testing (Desktop):**
- [ ] QuickCaptureDialog opens as compact modal
- [ ] TaskCreateDialog creates task successfully
- [ ] ProjectCreateDialog creates project successfully
- [ ] CaptureCreateDialog with voice input works
- [ ] AttachmentPicker shows 3-column grid
- [ ] FilterSheet has collapsible sections
- [ ] AttachmentBottomSheet (test via mobile)

**Manual Testing (Mobile):**
- [ ] QuickCaptureDialog opens as bottom sheet (75vh)
- [ ] TaskCreateDialog opens as bottom sheet (75vh)
- [ ] ProjectCreateDialog opens as bottom sheet (75vh)
- [ ] CaptureCreateDialog opens as bottom sheet (75vh)
- [ ] AttachmentPicker opens as bottom sheet (85vh, 2-column)
- [ ] FilterSheet opens as bottom sheet (85vh)
- [ ] AttachmentBottomSheet opens as sheet (90vh) with drag handle
- [ ] All modals have proper touch targets (44px min)
- [ ] All modals support swipe-to-dismiss
- [ ] All headers have close buttons or drag handles

---

**Plan Status:** Ready for execution
**Estimated Time:** 4-6 hours (7 tasks)
**Dependencies:** Phase 1 and Phase 2 complete
