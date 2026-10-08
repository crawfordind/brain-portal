'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bot, ArrowRight, PlugZap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentTaskCard } from './agent-task-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { shouldPoll } from './jack-state-badge';

interface QueueTask {
  status: string;
  runtime?: string | null;
  jack_state?: string | null;
}

/** Mirrors the server's "Needs you" filter in /api/agent-tasks. */
function needsYou(t: QueueTask): boolean {
  return (
    t.status === 'awaiting_review' ||
    ['awaiting_approval', 'awaiting_input', 'needs_dispatch', 'needs_review'].includes(t.jack_state ?? '')
  );
}

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
      if (filter === 'needs_you') {
        url.searchParams.set('needsYou', 'true');
      } else if (filter !== 'all') {
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
      const tasks = (q.state.data as { tasks?: QueueTask[] } | undefined)?.tasks ?? [];
      return tasks.some((t) => shouldPoll(t)) ? 5000 : false;
    },
  });

  const tasks = data?.tasks || [];

  const counts = {
    needs_you: tasks.filter((t: QueueTask) => needsYou(t)).length,
    processing: tasks.filter((t: QueueTask) => t.status === 'processing').length,
  };
  const jack: { state: string; message: string } | undefined = data?.jack;

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="needs_you">
            Needs you
            {counts.needs_you > 0 && filter === 'all' && (
              <Badge variant="secondary" className="ml-2 bg-orange-500 text-white">
                {counts.needs_you}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="processing">
            In progress
            {counts.processing > 0 && (
              <Badge variant="secondary" className="ml-2 bg-blue-500 text-white">
                {counts.processing}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">Completed</TabsTrigger>
        </TabsList>
      </Tabs>

      {jack && jack.state !== 'ready' && (
        <div role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <PlugZap className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <p>{jack.message} Delegated work is kept as <strong>Not sent</strong> and nothing is sent anywhere.</p>
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="rounded-full bg-muted p-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-lg">{filter === 'needs_you' ? 'Nothing needs you' : 'Nothing sent to Jack yet'}</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Use &ldquo;Send to Jack&rdquo; on any task, note or capture. Jack does the work with its own tools and reports back here.
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
          tasks.map((task: QueueTask & { id: string; title: string; priority: string; agent_name?: string; agent_icon?: string; created_at: string; updated_at: string }) => (
            <AgentTaskCard key={task.id} task={task} onView={() => onTaskClick(task.id)} />
          ))
        )}
      </div>
    </div>
  );
}
