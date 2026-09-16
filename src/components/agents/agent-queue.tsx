'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bot, ArrowRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentTaskCard } from './agent-task-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface AgentQueueProps {
  onTaskClick: (taskId: string) => void;
  onCreateTask?: () => void;
}

export function AgentQueue({ onTaskClick, onCreateTask }: AgentQueueProps) {
  const [filter, setFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-tasks', filter],
    queryFn: async () => {
      const url = new URL('/api/agent-tasks', window.location.origin);
      if (filter !== 'all') {
        url.searchParams.set('status', filter);
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch agent tasks');
      return res.json();
    },
    // Only poll while there is actually something in flight. An idle queue
    // doesn't change until the user acts, so polling it wastes a round-trip
    // every 5s per open tab.
    refetchInterval: (q) => {
      const tasks = (q.state.data as { tasks?: { status: string }[] } | undefined)?.tasks ?? [];
      const hasActive = tasks.some(
        (t) => t.status === 'queued' || t.status === 'processing' || t.status === 'awaiting_review'
      );
      return hasActive ? 5000 : false;
    },
  });

  const tasks = data?.tasks || [];

  const counts = {
    queued: tasks.filter((t: { status: string }) => t.status === 'queued').length,
    processing: tasks.filter((t: { status: string }) => t.status === 'processing').length,
    awaiting_review: tasks.filter((t: { status: string }) => t.status === 'awaiting_review').length,
  };

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="queued">
            Queued
            {counts.queued > 0 && (
              <Badge variant="secondary" className="ml-2 bg-orange-500 text-white">
                {counts.queued}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="processing">
            Processing
            {counts.processing > 0 && (
              <Badge variant="secondary" className="ml-2 bg-blue-500 text-white">
                {counts.processing}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="awaiting_review">
            Needs Review
            {counts.awaiting_review > 0 && (
              <Badge variant="secondary" className="ml-2 bg-purple-500 text-white">
                {counts.awaiting_review}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="rounded-full bg-muted p-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg">No agent tasks yet</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Delegate tasks to AI agents — they can write, research, analyze, and code while you focus on other work.
              </p>
            </div>
            {onCreateTask ? (
              <Button variant="default" onClick={onCreateTask}>
                Create a Task
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button asChild variant="default">
                <Link href="/tasks">
                  Go to Tasks
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        ) : (
          tasks.map((task: { id: string; title: string; status: string; priority: string; agent_name?: string; agent_icon?: string; created_at: string; updated_at: string }) => (
            <AgentTaskCard key={task.id} task={task} onView={() => onTaskClick(task.id)} />
          ))
        )}
      </div>
    </div>
  );
}
