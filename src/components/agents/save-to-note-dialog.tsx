'use client';

import { useState, useEffect } from 'react';
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
  onSaved: (slug: string) => void;
}

export function SaveToNoteDialog({
  open,
  onClose,
  taskId,
  defaultTitle,
  onSaved,
}: SaveToNoteDialogProps) {
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string>('none');
  const [linkContextNotes, setLinkContextNotes] = useState(true);
  const [linkTask, setLinkTask] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Update title when dialog opens or defaultTitle changes
  useEffect(() => {
    if (open && defaultTitle) {
      setTitle(defaultTitle);
    }
  }, [open, defaultTitle]);

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
          projectId: projectId === 'none' ? null : projectId,
          linkContextNotes,
          linkTask,
        }),
      });

      if (!res.ok) throw new Error('Failed to save note');

      const { slug } = await res.json();
      toast.success('Note created successfully!');
      onSaved(slug);
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
              <SelectContent position="popper" sideOffset={5}>
                <SelectItem value="none">No project</SelectItem>
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
