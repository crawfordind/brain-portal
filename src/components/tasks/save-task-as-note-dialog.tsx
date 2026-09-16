'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { ModalHeader } from '@/components/modals/modal-header';
import { useMobile } from '@/hooks/use-mobile';
import { useRouter } from 'next/navigation';

interface Task {
  id: string;
  title: string | null;
  content: string;
  project_id: string | null;
}

interface AgentTaskOutput {
  content: string;
  version_number: number;
  model_used: string;
  created_at: string;
}

interface SaveTaskAsNoteDialogProps {
  task: Task;
  agentOutput: AgentTaskOutput;
  open: boolean;
  onClose: () => void;
}

export function SaveTaskAsNoteDialog({
  task,
  agentOutput,
  open,
  onClose,
}: SaveTaskAsNoteDialogProps) {
  const [title, setTitle] = useState(task.title || task.content);
  const [editedContent, setEditedContent] = useState('');
  const [projectId, setProjectId] = useState(task.project_id || '');
  const [tags, setTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const isMobile = useMobile();

  // Fetch projects for dropdown
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },
  });

  const projects = projectsData?.projects || [];

  const handleClose = () => {
    setTitle(task.title || task.content);
    setEditedContent('');
    setProjectId(task.project_id || '');
    setTags('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}/save-as-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          editedContent: editedContent.trim() || undefined,
          projectId: projectId || undefined,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create note');
      }

      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note created successfully');
      handleClose();

      // Navigate to the new note
      router.push(`/notes/${result.slug}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create note');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate preview content
  const previewContent = editedContent || `# ${title}

## AI Output

${agentOutput.content}

---

## Generation Details

- **Model:** ${agentOutput.model_used}
- **Generated:** ${new Date(agentOutput.created_at).toLocaleString()}
- **Version:** ${agentOutput.version_number}`;

  const formContent = (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="title">Note Title *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter note title..."
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="preview">Preview</Label>
          <Textarea
            id="preview"
            value={previewContent}
            onChange={(e) => setEditedContent(e.target.value)}
            rows={12}
            className="resize-none font-mono text-xs"
            placeholder="Edit content before saving..."
          />
          <p className="text-xs text-muted-foreground">
            Edit the content above to customize before saving
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="project">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="project">
                <SelectValue placeholder="Select project..." />
              </SelectTrigger>
              <SelectContent className="bg-popover text-foreground !z-[9999]">
                <SelectItem value="" className="text-foreground">None</SelectItem>
                {projects.map((project: any) => (
                  <SelectItem key={project.id} value={project.id} className="text-foreground">
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="ai-generated, research"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated tags
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:gap-3">
        <Button variant="outline" onClick={handleClose} className="flex-1 sm:flex-initial">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!title.trim() || isSubmitting}
          className="flex-1 sm:flex-initial"
        >
          {isSubmitting ? 'Saving...' : 'Save as Note'}
        </Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
          <SheetTitle className="sr-only">Save AI Output as Note</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Save AI Output as Note"
                onClose={handleClose}
                showClose={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {formContent}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="standard">
        <DialogTitle className="sr-only">Save AI Output as Note</DialogTitle>
        <ModalHeader title="Save AI Output as Note" onClose={handleClose} showClose={false} />
        {formContent}
      </DialogContent>
    </Dialog>
  );
}
