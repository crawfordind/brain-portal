'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMobile } from '@/hooks/use-mobile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Edit, Trash2, CheckSquare, Circle, Calendar, FolderOpen, FileText, ChevronDown, Sparkles } from 'lucide-react';
import { useProjects } from '@/hooks/use-projects';
import { format } from 'date-fns';
import Link from 'next/link';
import { rruleToText } from '@/lib/tasks/recurrence';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { Task } from '@/types/task';

interface TaskDetailDialogProps {
  task: Task;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAskAbout: () => void;
  onReview?: (agentTaskId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

export function TaskDetailDialog({
  task,
  open,
  onClose,
  onEdit,
  onAskAbout,
  onReview,
}: TaskDetailDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isUnscheduling, setIsUnscheduling] = useState(false);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const isMobile = useMobile();
  const { data: projects } = useProjects();

  const handleChangeProject = async (projectId: string | null) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!response.ok) throw new Error('Failed to update');
      toast.success('Project updated');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch {
      toast.error('Failed to update project');
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({ title: "Delete this task?", description: "This cannot be undone.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete');

      toast.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    } catch (error) {
      toast.error('Failed to delete task');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleStatus = async () => {
    setIsTogglingStatus(true);
    try {
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error('Failed to update status');

      toast.success(`Task marked as ${newStatus === 'completed' ? 'completed' : 'incomplete'}`);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    } catch {
      toast.error('Failed to update task status');
    } finally {
      setIsTogglingStatus(false);
    }
  };

  const handleUnschedule = async () => {
    setIsUnscheduling(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: null }),
      });
      if (!response.ok) throw new Error('Failed to unschedule task');

      toast.success('Task removed from calendar');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    } catch {
      toast.error('Failed to unschedule task');
    } finally {
      setIsUnscheduling(false);
    }
  };

  const taskTitle = task.title || task.content;

  // Render content as a JSX variable (NOT as a component) to avoid
  // unmount/remount issues from defining a component inside render.
  const taskContent = (
    <div className="space-y-6">
      {/* Status and Priority */}
      <div className="flex flex-wrap gap-2">
        <Badge className={STATUS_COLORS[task.status]}>
          {STATUS_LABELS[task.status]}
        </Badge>
        <Badge variant="outline" className={PRIORITY_COLORS[task.priority]}>
          {PRIORITY_LABELS[task.priority]}
        </Badge>
        {task.delegated_to && (
          <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
            🤖 {task.delegated_to}
          </Badge>
        )}
      </div>

      {/* Task Description */}
      {task.description && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Description</h3>
          <p className="text-sm whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-3 pt-4 border-t">
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Project:</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1 font-medium hover:text-primary transition-colors">
                {task.project_name || 'None'}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={task.project_id ?? 'none'}
                onValueChange={(value) =>
                  handleChangeProject(value === 'none' ? null : value)
                }
              >
                <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                {projects?.map((project) => (
                  <DropdownMenuRadioItem key={project.id} value={project.id}>
                    <span className="flex items-center gap-2">
                      {project.color && (
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: project.color }}
                        />
                      )}
                      {project.name}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {task.note_slug && (
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">From:</span>
            <Link
              href={`/notes/${task.note_slug}`}
              className="font-medium hover:underline text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              {task.note_title}
            </Link>
          </div>
        )}

        {task.due_date && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Due:</span>
            <span className={`font-medium ${
              new Date(task.due_date) < new Date() && task.status !== 'completed'
                ? 'text-red-600 dark:text-red-400'
                : ''
            }`} suppressHydrationWarning>
              {format(new Date(task.due_date), 'PPP')}
            </span>
          </div>
        )}

        {task.scheduled_at && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Scheduled:</span>
            <span className="font-medium text-blue-600 dark:text-blue-400" suppressHydrationWarning>
              {format(new Date(task.scheduled_at), 'PPP p')}
            </span>
          </div>
        )}

        {task.recurrence_rule && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">↻</span>
            <span className="text-muted-foreground">Repeats:</span>
            <span className="font-medium">
              {rruleToText(task.recurrence_rule) || task.recurrence_rule}
            </span>
            {task.recurrence_end_date && (
              <span className="text-muted-foreground">until {task.recurrence_end_date}</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground" suppressHydrationWarning>
          <span>Created {format(new Date(task.created_at), 'PPP')}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-4 border-t">
        <div className="flex gap-2">
          <Button
            onClick={handleToggleStatus}
            disabled={isTogglingStatus}
            variant="outline"
            className="flex-1"
          >
            {isTogglingStatus ? (
              "Updating..."
            ) : task.status === 'completed' ? (
              <>
                <Circle className="h-4 w-4 mr-2" />
                Mark Incomplete
              </>
            ) : (
              <>
                <CheckSquare className="h-4 w-4 mr-2" />
                Mark Complete
              </>
            )}
          </Button>

          <Button onClick={onEdit} variant="outline" className="flex-1">
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
        </div>

        {/* Unschedule button - only show if task is scheduled */}
        {task.scheduled_at && (
          <Button onClick={handleUnschedule} disabled={isUnscheduling} variant="outline" className="w-full">
            <Calendar className="h-4 w-4 mr-2" />
            {isUnscheduling ? "Removing..." : "Remove from Calendar"}
          </Button>
        )}

        {/* AI Actions */}
        {task.delegated_to && task.agent_task_id ? (
          <Button
            onClick={() => {
              if (onReview) {
                onReview(task.agent_task_id!);
                onClose();
              } else {
                router.push(`/review?task=${task.agent_task_id}`);
                onClose();
              }
            }}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            ⏳ Review AI Output
          </Button>
        ) : (
          task.status !== 'completed' && (
            <Button onClick={onAskAbout} variant="outline" className="w-full">
              <Sparkles className="h-4 w-4 mr-2" />
              Ask about this task
            </Button>
          )
        )}

        <Button
          onClick={handleDelete}
          disabled={isDeleting}
          variant="destructive"
          className="w-full"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {isDeleting ? 'Deleting...' : 'Delete Task'}
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[85vh] p-0 gap-0">
          <div className="flex flex-col h-full">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-left">{taskTitle}</SheetTitle>
              <SheetDescription className="sr-only">Task details and actions</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {taskContent}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{taskTitle}</DialogTitle>
          <DialogDescription className="sr-only">Task details and actions</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto">
          {taskContent}
        </div>
      </DialogContent>
    </Dialog>
  );
}
