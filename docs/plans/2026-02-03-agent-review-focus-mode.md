# Agent Review Focus Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform agent output review from raw markdown to efficient focus-mode manager approval workflow with beautiful rendering.

**Architecture:** Replace side-by-side review panel with full-width focus mode featuring rendered markdown, collapsible prompt, and floating action bar. Add save-to-note API endpoint.

**Tech Stack:** React, marked (markdown), Tailwind prose, Radix UI, react-hotkeys-hook

---

## Task 1: Create Markdown Renderer Component

**Files:**
- Create: `src/components/markdown/markdown-renderer.tsx`
- Test: Manual testing with various markdown samples

**Step 1: Create markdown renderer with marked library**

```tsx
'use client';

import { useMemo } from 'react';
import { marked } from 'marked';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const html = useMemo(() => {
    // Configure marked for safe rendering
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: true,
      mangle: false,
      sanitize: false, // We'll rely on marked's built-in XSS protection
    });

    // Add target="_blank" to external links
    const renderer = new marked.Renderer();
    const originalLink = renderer.link.bind(renderer);
    renderer.link = (href, title, text) => {
      const html = originalLink(href, title, text);
      return html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
    };

    marked.use({ renderer });

    return marked.parse(content);
  }, [content]);

  return (
    <div
      className={cn(
        'prose prose-slate dark:prose-invert max-w-none',
        'prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-sm',
        'prose-pre:bg-muted prose-pre:border prose-pre:border-border',
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        'prose-blockquote:border-l-primary prose-blockquote:border-l-4 prose-blockquote:pl-4 prose-blockquote:italic',
        'prose-img:rounded-lg prose-img:shadow-md',
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

**Step 2: Test renderer with sample markdown**

Create temporary test in browser console or add to a test page.

**Step 3: Commit markdown renderer**

```bash
git add src/components/markdown/markdown-renderer.tsx
git commit -m "feat(markdown): add markdown renderer component with prose styling"
```

---

## Task 2: Create Save to Note Dialog

**Files:**
- Create: `src/components/agents/save-to-note-dialog.tsx`

**Step 1: Create save to note dialog component**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SaveToNoteDialogProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  defaultTitle: string;
  onSaved: (noteId: string) => void;
}

export function SaveToNoteDialog({
  open,
  onClose,
  taskId,
  defaultTitle,
  onSaved,
}: SaveToNoteDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [projectId, setProjectId] = useState<string>('');
  const [linkContextNotes, setLinkContextNotes] = useState(true);
  const [linkTask, setLinkTask] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },
  });

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Please enter a note title');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/save-as-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          projectId: projectId || null,
          linkContextNotes,
          linkTask,
        }),
      });

      if (!res.ok) throw new Error('Failed to save note');

      const { noteId } = await res.json();
      toast.success('Note created successfully!');
      onSaved(noteId);
      onClose();
    } catch (error) {
      toast.error('Failed to save note');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to Note</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Note Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter note title..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project">Project (Optional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="project">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">No project</SelectItem>
                {projects?.projects?.map((project: any) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="linkTask"
                checked={linkTask}
                onCheckedChange={(checked) => setLinkTask(checked as boolean)}
              />
              <Label htmlFor="linkTask" className="text-sm font-normal cursor-pointer">
                Link to original task
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="linkContext"
                checked={linkContextNotes}
                onCheckedChange={(checked) => setLinkContextNotes(checked as boolean)}
              />
              <Label htmlFor="linkContext" className="text-sm font-normal cursor-pointer">
                Link to context notes
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit save to note dialog**

```bash
git add src/components/agents/save-to-note-dialog.tsx
git commit -m "feat(agents): add save to note dialog component"
```

---

## Task 3: Create Focus Mode Review Panel

**Files:**
- Create: `src/components/agents/agent-review-focus-panel.tsx`

**Step 1: Create focus mode review panel structure**

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModalHeader } from '@/components/modals/modal-header';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { SaveToNoteDialog } from './save-to-note-dialog';
import { Check, Edit, X, Copy, ChevronDown, ChevronUp, MoreVertical, History } from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { motion, AnimatePresence } from 'framer-motion';

interface AgentReviewFocusPanelProps {
  taskId: string;
  open: boolean;
  onClose: () => void;
}

export function AgentReviewFocusPanel({ taskId, open, onClose }: AgentReviewFocusPanelProps) {
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['agent-task', taskId],
    queryFn: async () => {
      const res = await fetch(`/api/agent-tasks/${taskId}`);
      if (!res.ok) throw new Error('Failed to fetch task');
      return res.json();
    },
    enabled: open && !!taskId,
  });

  const task = data?.task;
  const outputs = data?.outputs || [];
  const currentOutput = outputs[0];
  const displayVersion = selectedVersion !== null
    ? outputs.find((o: any) => o.version_number === selectedVersion)
    : currentOutput;

  const handleRevise = async () => {
    if (!feedback.trim()) {
      toast.error('Please provide feedback for revision');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      if (!res.ok) throw new Error('Failed to request revision');
      toast.success('Revision requested, agent is working on it...');
      setFeedback('');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });
    } catch (error) {
      toast.error('Failed to request revision');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to approve');
      toast.success('Task approved!');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] });

      // Open save dialog after approval
      setShowSaveDialog(true);
    } catch (error) {
      toast.error('Failed to approve task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('Are you sure you want to reject this task?')) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/agent-tasks/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: feedback || null }),
      });
      if (!res.ok) throw new Error('Failed to reject');
      toast.success('Task rejected');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      onClose();
    } catch (error) {
      toast.error('Failed to reject task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (displayVersion?.content) {
      navigator.clipboard.writeText(displayVersion.content);
      toast.success('Output copied to clipboard');
    }
  };

  const handleNoteSaved = (noteId: string) => {
    router.push(`/notes/${noteId}`);
    onClose();
  };

  // Keyboard shortcuts
  useHotkeys('mod+enter', (e) => {
    e.preventDefault();
    if (feedback.trim() && canRevise) handleRevise();
  }, { enabled: open });

  useHotkeys('mod+s', (e) => {
    e.preventDefault();
    if (showActions) handleApprove();
  }, { enabled: open });

  useHotkeys('mod+c', (e) => {
    e.preventDefault();
    handleCopy();
  }, { enabled: open });

  if (!open || isLoading || !task) return null;

  const canRevise = task.current_version < task.max_revisions;
  const showActions = task.status === 'awaiting_review' || task.status === 'revision_requested';

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent size="immersive" className="max-w-5xl h-[90vh] p-0 flex flex-col">
          {/* Header */}
          <div className="border-b px-6 py-4">
            <ModalHeader title={task.title} onClose={onClose} showClose />
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline" className="bg-purple-500 text-white">
                {task.status.replace(/_/g, ' ')}
              </Badge>
              {displayVersion && (
                <span className="text-sm text-muted-foreground">
                  Version {displayVersion.version_number} of {task.max_revisions}
                </span>
              )}
            </div>
          </div>

          {/* Collapsible Prompt */}
          <div className="px-6 pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showPrompt ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-2" />
                  Hide Original Prompt
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-2" />
                  View Original Prompt
                </>
              )}
            </Button>

            <AnimatePresence>
              {showPrompt && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="bg-muted rounded-lg p-4 mt-2 text-sm whitespace-pre-wrap">
                    {task.description}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Output */}
          <ScrollArea className="flex-1 px-6">
            {displayVersion ? (
              <div className="py-6">
                <MarkdownRenderer content={displayVersion.content} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {task.status === 'processing' ? 'Processing...' : 'No output yet'}
              </div>
            )}
          </ScrollArea>

          {/* Floating Action Bar */}
          {showActions && (
            <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-4">
              <div className="space-y-3">
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What changes would you like? (Cmd/Ctrl+Enter to submit)"
                  rows={2}
                  disabled={!canRevise}
                  className="resize-none"
                />

                <div className="flex gap-2">
                  <Button
                    onClick={handleRevise}
                    disabled={!feedback.trim() || !canRevise || isSubmitting}
                    variant="outline"
                    className="flex-1"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Request Revision ({task.current_version}/{task.max_revisions})
                  </Button>

                  <Button
                    onClick={handleApprove}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Approve & Save to Note
                  </Button>

                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    size="icon"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {outputs.length > 1 && (
                        <DropdownMenuItem onClick={() => setSelectedVersion(selectedVersion === null ? 1 : null)}>
                          <History className="h-4 w-4 mr-2" />
                          View History
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={handleReject} className="text-destructive">
                        <X className="h-4 w-4 mr-2" />
                        Reject Task
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SaveToNoteDialog
        open={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        taskId={taskId}
        defaultTitle={task?.title || ''}
        onSaved={handleNoteSaved}
      />
    </>
  );
}
```

**Step 2: Commit focus mode panel**

```bash
git add src/components/agents/agent-review-focus-panel.tsx
git commit -m "feat(agents): add focus mode review panel with markdown rendering"
```

---

## Task 4: Add Save to Note API Endpoint

**Files:**
- Create: `src/app/api/agent-tasks/[id]/save-as-note/route.ts`

**Step 1: Create save-as-note API endpoint**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getCurrentUser } from '@/lib/auth/session';
import slugify from '@/lib/utils/slugify';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title, projectId, linkContextNotes, linkTask } = await request.json();

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const db = await getDb();

    // Get agent task with latest output
    const task = await db.execute({
      sql: `
        SELECT at.*, ato.content, ato.model_used, ato.created_at as output_created_at,
               ac.name as agent_name
        FROM agent_tasks at
        LEFT JOIN agent_task_outputs ato ON ato.agent_task_id = at.id
        LEFT JOIN agent_configs ac ON ac.agent_type = at.assigned_agent
        WHERE at.id = ? AND at.user_id = ?
        ORDER BY ato.version_number DESC
        LIMIT 1
      `,
      args: [params.id, user.id],
    });

    if (!task.rows.length) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const taskData = task.rows[0] as any;

    if (!taskData.content) {
      return NextResponse.json({ error: 'No output to save' }, { status: 400 });
    }

    // Build note content with metadata footer
    const timestamp = new Date(taskData.output_created_at).toLocaleString();
    let noteContent = taskData.content;

    // Add metadata footer
    noteContent += '\n\n---\n\n';
    noteContent += `*Generated by ${taskData.agent_name} using ${taskData.model_used}*\n`;
    noteContent += `*Created: ${timestamp}*\n`;

    if (linkTask) {
      noteContent += `*Task: [${taskData.title}](/agents?task=${params.id})*\n`;
    }

    if (linkContextNotes && taskData.context_note_ids) {
      const contextNoteIds = JSON.parse(taskData.context_note_ids);
      if (contextNoteIds.length > 0) {
        const contextNotes = await db.execute({
          sql: `SELECT id, title, slug FROM notes WHERE id IN (${contextNoteIds.map(() => '?').join(',')})`,
          args: contextNoteIds,
        });

        if (contextNotes.rows.length > 0) {
          noteContent += '\n**Context Notes:**\n';
          for (const note of contextNotes.rows as any[]) {
            noteContent += `- [${note.title}](/notes/${note.slug})\n`;
          }
        }
      }
    }

    // Create note
    const slug = slugify(title.trim());
    let finalSlug = slug;
    let counter = 1;

    // Ensure unique slug
    while (true) {
      const existing = await db.execute({
        sql: 'SELECT id FROM notes WHERE user_id = ? AND slug = ?',
        args: [user.id, finalSlug],
      });

      if (existing.rows.length === 0) break;
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    const noteId = crypto.randomUUID();
    await db.execute({
      sql: `
        INSERT INTO notes (id, user_id, project_id, title, slug, content, note_type)
        VALUES (?, ?, ?, ?, ?, ?, 'note')
      `,
      args: [noteId, user.id, projectId || null, title.trim(), finalSlug, noteContent],
    });

    return NextResponse.json({ noteId, slug: finalSlug });
  } catch (error) {
    console.error('Save to note error:', error);
    return NextResponse.json(
      { error: 'Failed to save note' },
      { status: 500 }
    );
  }
}
```

**Step 2: Check if slugify utility exists**

```bash
ls -la src/lib/utils/slugify.ts
```

If it doesn't exist, create it:

```ts
export default function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

**Step 3: Commit API endpoint**

```bash
git add src/app/api/agent-tasks/[id]/save-as-note/route.ts
git add src/lib/utils/slugify.ts  # if created
git commit -m "feat(api): add save agent output to note endpoint"
```

---

## Task 5: Update Agents Page to Use Focus Panel

**Files:**
- Modify: `src/app/(dashboard)/agents/page.tsx`

**Step 1: Replace old panel with new focus panel**

Find the import of `AgentReviewPanel` and replace it:

```tsx
// OLD:
// import { AgentReviewPanel } from '@/components/agents/agent-review-panel';

// NEW:
import { AgentReviewFocusPanel } from '@/components/agents/agent-review-focus-panel';
```

Find where `AgentReviewPanel` is used and replace:

```tsx
// OLD:
// <AgentReviewPanel taskId={selectedTaskId} open={!!selectedTaskId} onClose={...} />

// NEW:
<AgentReviewFocusPanel taskId={selectedTaskId} open={!!selectedTaskId} onClose={() => setSelectedTaskId(null)} />
```

**Step 2: Test the integration**

Run dev server:
```bash
npm run dev
```

Visit: http://localhost:3000/agents

Test:
1. Click on a task with `awaiting_review` status
2. Verify markdown renders beautifully
3. Test collapsible prompt
4. Test revision request
5. Test approve & save to note
6. Test keyboard shortcuts

**Step 3: Commit integration**

```bash
git add src/app/(dashboard)/agents/page.tsx
git commit -m "feat(agents): integrate focus mode review panel"
```

---

## Task 6: Archive Old Review Panel

**Files:**
- Delete: `src/components/agents/agent-review-panel.tsx`

**Step 1: Remove old panel file**

```bash
git rm src/components/agents/agent-review-panel.tsx
git commit -m "refactor(agents): remove old review panel"
```

---

## Task 7: Add Tailwind Typography Plugin (if needed)

**Files:**
- Modify: `package.json`
- Modify: `tailwind.config.ts`

**Step 1: Check if @tailwindcss/typography is installed**

```bash
grep "@tailwindcss/typography" package.json
```

**Step 2: If not installed, add it**

```bash
npm install -D @tailwindcss/typography
```

**Step 3: Update tailwind config**

Check `tailwind.config.ts` and add typography plugin if not present:

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  // ... other config
  plugins: [
    require('@tailwindcss/typography'),
    // ... other plugins
  ],
}
```

**Step 4: Commit dependency**

```bash
git add package.json package-lock.json tailwind.config.ts
git commit -m "deps: add tailwindcss typography plugin for markdown rendering"
```

---

## Task 8: Manual Testing & Polish

**Step 1: Test complete workflow**

1. Start dev server: `npm run dev`
2. Navigate to `/agents`
3. Select task with output
4. Test all interactions:
   - View prompt (expand/collapse)
   - Scroll through rendered markdown
   - Request revision with feedback
   - Approve task
   - Save to note with options
   - Copy output
   - Keyboard shortcuts (Cmd+Enter, Cmd+S, Cmd+C)
   - Version switching (if multiple revisions)

**Step 2: Test various markdown formats**

Create test tasks with different markdown:
- Headers (h1-h6)
- Code blocks (with and without language)
- Lists (ordered, unordered, nested)
- Blockquotes
- Tables
- Links
- Images
- Bold, italic, strikethrough

**Step 3: Test edge cases**

- Empty output
- Very long output (scrolling)
- Max revisions reached
- Rejected task
- Failed task
- Dark mode vs light mode

**Step 4: Performance check**

- Large markdown documents (1000+ lines)
- Multiple rapid interactions
- Network latency simulation

---

## Testing Checklist

- [ ] Markdown renders with proper typography
- [ ] Code blocks have background and proper spacing
- [ ] Links are clickable and open in new tab
- [ ] Prompt expands/collapses smoothly
- [ ] Revision textarea works and submits feedback
- [ ] Approve button opens save dialog
- [ ] Save dialog creates note with metadata
- [ ] Copy button copies raw markdown
- [ ] Keyboard shortcuts work (Cmd+Enter, Cmd+S, Cmd+C, Esc)
- [ ] Version switching works (if applicable)
- [ ] Loading states display correctly
- [ ] Error messages show for failures
- [ ] Dark mode renders correctly
- [ ] Mobile responsive (if applicable)

---

## Rollback Plan

If issues arise:

```bash
# Revert to old review panel
git revert HEAD~6..HEAD
git push origin main

# Or cherry-pick specific fixes
git cherry-pick <commit-hash>
```

---

## Future Enhancements

- Syntax highlighting for code blocks (e.g., prism.js, highlight.js)
- Inline editing of output before saving
- Side-by-side version comparison
- Batch approval mode
- Export to PDF/Word
- AI-powered quality scoring
