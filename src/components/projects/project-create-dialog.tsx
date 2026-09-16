'use client';

import { useState } from 'react';
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
import { useQueryClient } from '@tanstack/react-query';
import { ModalHeader } from '@/components/modals/modal-header';
import { useMobile } from '@/hooks/use-mobile';

interface ProjectCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ProjectCreateDialog({
  open,
  onClose,
}: ProjectCreateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  const handleClose = () => {
    setName('');
    setDescription('');
    setStatus('active');
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          status,
        }),
      });

      if (!response.ok) throw new Error('Failed to create project');

      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created');
      handleClose();
    } catch (error) {
      toast.error('Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formContent = (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            autoFocus
            className="h-11"
            style={{ direction: 'ltr' }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description (optional)"
            rows={3}
            className="resize-none"
            style={{ direction: 'ltr' }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="status" className="h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="planning">Planning</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="stalled">Stalled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end sm:gap-3">
        <Button variant="outline" onClick={handleClose} className="flex-1">
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!name.trim() || isSubmitting}
          className="flex-1"
        >
          {isSubmitting ? 'Creating...' : 'Create Project'}
        </Button>
      </div>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
          <SheetTitle className="sr-only">Create Project</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Create Project"
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

  // Desktop: Compact Dialog
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent size="compact">
        <DialogTitle className="sr-only">Create Project</DialogTitle>
        <ModalHeader title="Create Project" onClose={handleClose} showClose={false} />
        {formContent}
      </DialogContent>
    </Dialog>
  );
}
