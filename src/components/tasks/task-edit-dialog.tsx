'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { RecurrencePicker } from '@/components/tasks/recurrence-picker';

interface Task {
  id: string;
  content: string;
  status: string;
  priority: string;
  project_id: string | null;
  due_date: string | null;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
}

interface TaskEditDialogProps {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  projects: Array<{ id: string; name: string }>;
}

export function TaskEditDialog({
  open,
  onClose,
  task,
  projects,
}: TaskEditDialogProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('pending');
  const [priority, setPriority] = useState('medium');
  const [projectId, setProjectId] = useState<string>('');
  const [dueDate, setDueDate] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const isMobile = useMobile();

  // Update form when task changes
  useEffect(() => {
    if (task) {
      setContent(task.content);
      setStatus(task.status);
      setPriority(task.priority);
      setProjectId(task.project_id || ''); // Empty string is fine for internal state
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '');
      setRecurrenceRule(task.recurrence_rule || null);
      setRecurrenceEndDate(task.recurrence_end_date || null);
    }
  }, [task]);

  const handleClose = () => {
    onClose();
  };

  const handleSubmit = async () => {
    if (!task || !content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          status,
          priority,
          projectId: projectId || null,
          dueDate: dueDate || null,
          recurrenceRule: recurrenceRule,
          recurrenceEndDate: recurrenceEndDate,
        }),
      });

      if (!response.ok) throw new Error('Failed to update task');

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task updated');
      handleClose();
    } catch (error) {
      toast.error('Failed to update task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const TaskForm = () => (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor="content">Task description</Label>
          <Input
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter task description..."
            autoFocus
            className="h-11"
            dir="ltr"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

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

        <div className="space-y-2">
          <Label htmlFor="project">Project</Label>
          <Select value={projectId || "none"} onValueChange={(val) => setProjectId(val === "none" ? "" : val)}>
            <SelectTrigger id="project" className="h-11">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="recurrence" className="text-sm">Repeat</Label>
          <RecurrencePicker
            value={recurrenceRule}
            endDate={recurrenceEndDate}
            onChange={setRecurrenceRule}
            onEndDateChange={setRecurrenceEndDate}
          />
        </div>
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
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </>
  );

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[80vh] p-0 gap-0">
          <SheetTitle className="sr-only">Edit Task</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Edit Task"
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
        <DialogTitle className="sr-only">Edit Task</DialogTitle>
        <ModalHeader title="Edit Task" onClose={handleClose} showClose={false} />
        <TaskForm />
      </DialogContent>
    </Dialog>
  );
}
