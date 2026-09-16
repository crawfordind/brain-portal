'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDistanceToNow } from 'date-fns';
import { MoreVertical, Trash2, FileText, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { parseUTCDate } from '@/lib/utils/date';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface AgentTaskCardProps {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    agent_name?: string;
    agent_icon?: string;
    project_name?: string;
    note_title?: string;
    note_slug?: string;
    latest_summary?: string | null;
    created_at: string;
    updated_at: string;
  };
  onView: () => void;
}

const statusColors: Record<string, string> = {
  queued: 'bg-gray-500',
  processing: 'bg-blue-500',
  awaiting_review: 'bg-purple-500',
  revision_requested: 'bg-orange-500',
  approved: 'bg-green-500',
  rejected: 'bg-red-500',
  failed: 'bg-red-700',
};

const priorityColors: Record<string, string> = {
  low: 'text-gray-500',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500',
};

export function AgentTaskCard({ task, onView }: AgentTaskCardProps) {
  const timeAgo = formatDistanceToNow(parseUTCDate(task.updated_at), { addSuffix: true });
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    const ok = await confirm({ title: "Delete agent task?", description: "This will permanently delete this task.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;

    try {
      const res = await fetch(`/api/agent-tasks/${task.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
    } catch {
      toast.error('Failed to delete task');
    }
  };

  return (
    <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer" onClick={onView}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{task.agent_icon || '🤖'}</span>
            <Badge variant="outline" className={`${statusColors[task.status]} text-white`}>
              {task.status.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="outline" className={priorityColors[task.priority]}>
              {task.priority}
            </Badge>
          </div>
          <h3 className="font-medium mb-1 truncate">{task.title}</h3>
          {task.latest_summary && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{task.latest_summary}</p>
          )}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {task.agent_name} • {timeAgo}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {task.note_title && task.note_slug && (
                <Link
                  href={`/notes/${task.note_slug}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge variant="outline" className="gap-1 hover:bg-muted cursor-pointer">
                    <FileText className="h-3 w-3" />
                    {task.note_title}
                  </Badge>
                </Link>
              )}
              {task.project_name && (
                <Badge variant="outline" className="gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {task.project_name}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {task.status === 'awaiting_review' && (
            <Button size="sm">Review</Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Card>
  );
}
