'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { addToQueue } from '@/lib/offline/simple-queue';
import { ModalHeader } from '@/components/modals/modal-header';
import { useMobile } from '@/hooks/use-mobile';
import { ChevronDown, ChevronUp, Calendar, Flag, FolderOpen, Repeat } from 'lucide-react';
import { RecurrencePicker } from '@/components/tasks/recurrence-picker';
import { Badge } from '@/components/ui/badge';
import { useNLTaskParser } from '@/lib/hooks/use-nl-task-parser';


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

  // Assignment state
  const [assignTo, setAssignTo] = useState<'auto' | 'me' | 'ai'>('auto');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const isMobile = useMobile(768); // Show Sheet for phones AND tablets (< md)
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch available agents
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      return res.json();
    },
  });

  const agents = agentsData?.agents || [];

  // NL task parsing
  const parsedTask = useNLTaskParser(content, projects);

  // Auto-fill fields from NL parser when not manually overridden
  useEffect(() => {
    if (!parsedTask || parsedTask.parsedFields.length === 0) return;

    if (parsedTask.parsedFields.includes('priority') && !manualOverrides.has('priority')) {
      setPriority(parsedTask.priority);
    }
    if (parsedTask.parsedFields.includes('dueDate') && parsedTask.dueDate && !manualOverrides.has('dueDate')) {
      setDueDate(parsedTask.dueDate);
    }
    if (parsedTask.parsedFields.includes('projectId') && parsedTask.projectId && !manualOverrides.has('projectId')) {
      setProjectId(parsedTask.projectId);
    }
    if (parsedTask.parsedFields.includes('recurrenceRule') && parsedTask.recurrenceRule && !manualOverrides.has('recurrenceRule')) {
      setRecurrenceRule(parsedTask.recurrenceRule);
    }

    // Auto-expand advanced options when fields are detected
    if (parsedTask.parsedFields.some(f => ['priority', 'dueDate', 'projectId', 'recurrenceRule'].includes(f))) {
      setShowAdvanced(true);
    }
  }, [parsedTask, manualOverrides]);

  // Wrapped setters that track manual overrides
  const handleSetPriority = (val: string) => {
    setPriority(val);
    setManualOverrides(prev => new Set(prev).add('priority'));
  };
  const handleSetDueDate = (val: string) => {
    setDueDate(val);
    setManualOverrides(prev => new Set(prev).add('dueDate'));
  };
  const handleSetProjectId = (val: string) => {
    setProjectId(val);
    setManualOverrides(prev => new Set(prev).add('projectId'));
  };
  const handleSetRecurrenceRule = (val: string | null) => {
    setRecurrenceRule(val);
    setManualOverrides(prev => new Set(prev).add('recurrenceRule'));
  };
  // Auto-focus textarea when dialog opens
  useEffect(() => {
    if (open && textareaRef.current) {
      // Small delay to ensure dialog is fully rendered
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleClose = () => {
    setContent('');
    setPriority('medium');
    setProjectId('');
    setDueDate('');
    setAssignTo('auto');
    setSelectedAgent(null);
    setShowAdvanced(false);
    setRecurrenceRule(null);
    setRecurrenceEndDate(null);
    setManualOverrides(new Set());
    onClose();
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload: any = {
        content: content.trim(),
        priority,
        projectId: projectId || null,
        dueDate: dueDate || null,
      };

      if (recurrenceRule) {
        payload.recurrenceRule = recurrenceRule;
        payload.recurrenceEndDate = recurrenceEndDate;
      }

      // If AI agent selected (either auto-detected or manual), add delegation info
      if (assignTo === 'ai' || (assignTo === 'auto' && selectedAgent)) {
        payload.delegatedTo = selectedAgent || 'general';
        payload.autoExecute = true; // Auto-execute AI tasks
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to create task');

      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ['tasks'] });

      const parsedInfo = data.parsed;
      const parts: string[] = ['Task created'];
      if (parsedInfo?.dueDate) {
        const d = new Date(parsedInfo.dueDate + 'T00:00:00');
        parts.push(`due ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
      }
      if (parsedInfo?.priority && parsedInfo.priority !== 'medium') {
        parts.push(parsedInfo.priority);
      }
      if (payload.delegatedTo) {
        parts.push('→ AI agent');
      }
      toast.success(parts.join(' · '));

      handleClose();
    } catch {
      // Offline or server error - queue for later sync
      const payload: any = {
        content: content.trim(),
        priority,
        projectId: projectId || null,
        dueDate: dueDate || null,
      };
      if (recurrenceRule) {
        payload.recurrenceRule = recurrenceRule;
        payload.recurrenceEndDate = recurrenceEndDate;
      }
      addToQueue({
        type: 'task',
        operation: 'create',
        data: payload,
      });
      toast.success('Task created (queued for sync)');
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const taskFormContent = useMemo(() => (
    <>
      <div className="space-y-4 py-2">
        <div className="space-y-2" dir="ltr" style={{ direction: 'ltr' }}>
          <Label htmlFor="task-create-input-field" dir="ltr">What needs to be done?</Label>
          <textarea
            ref={textareaRef}
            id="task-create-input-field"
            name="task-description"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Enter task description here..."
            rows={3}
            dir="ltr"
            lang="en"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={true}
            inputMode="text"
            className="resize-none border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            style={{
              direction: 'ltr !important' as any,
              textAlign: 'left !important' as any,
              unicodeBidi: 'bidi-override' as any,
              writingMode: 'horizontal-tb',
            }}
          />
        </div>

        {/* NL Detected Fields */}
        {parsedTask && parsedTask.parsedFields.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground self-center">Detected:</span>
            {parsedTask.parsedFields.includes('dueDate') && parsedTask.dueDate && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Calendar className="h-3 w-3" />
                {parsedTask.dueDate}
              </Badge>
            )}
            {parsedTask.parsedFields.includes('priority') && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Flag className="h-3 w-3" />
                {parsedTask.priority}
              </Badge>
            )}
            {parsedTask.parsedFields.includes('projectId') && parsedTask.projectName && (
              <Badge variant="secondary" className="text-xs gap-1">
                <FolderOpen className="h-3 w-3" />
                {parsedTask.projectName}
              </Badge>
            )}
            {parsedTask.parsedFields.includes('recurrenceRule') && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Repeat className="h-3 w-3" />
                recurring
              </Badge>
            )}
          </div>
        )}

        {/* Assignment Section */}
        <div className="space-y-2">
          <Label>Assign to</Label>

          {/* Assignment Mode Selector */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={assignTo === 'auto' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAssignTo('auto')}
              className="flex-1 h-9 text-xs"
            >
              🤖 Smart Assign
            </Button>
            <Button
              type="button"
              variant={assignTo === 'me' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setAssignTo('me');
                setSelectedAgent(null);
              }}
              className="flex-1 h-9 text-xs"
            >
              👤 Me
            </Button>
            <Button
              type="button"
              variant={assignTo === 'ai' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAssignTo('ai')}
              className="flex-1 h-9 text-xs"
            >
              🤖 AI Agent
            </Button>
          </div>

          {/* AI Agent Selector */}
          {assignTo === 'ai' && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {agents.map((agent: any) => (
                  <button
                    key={agent.agent_type}
                    type="button"
                    onClick={() => setSelectedAgent(agent.agent_type)}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors ${
                      selectedAgent === agent.agent_type
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <span className="text-2xl">{agent.icon}</span>
                    <span className="text-xs font-medium">{agent.display_name}</span>
                  </button>
                ))}
              </div>
              {selectedAgent && (
                <p className="text-xs text-muted-foreground">
                  {agents.find((a: any) => a.agent_type === selectedAgent)?.description}
                </p>
              )}
            </>
          )}
        </div>

        {/* Advanced Options Toggle */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-muted-foreground h-8 text-xs -ml-2"
        >
          {showAdvanced ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              Hide Options
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              More Options
            </>
          )}
        </Button>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={handleSetPriority}>
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
                  onChange={(e) => handleSetDueDate(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="project">Project (optional)</Label>
              <Select value={projectId || "none"} onValueChange={(val) => handleSetProjectId(val === "none" ? "" : val)}>
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
              <Label className="text-sm">Repeat</Label>
              <RecurrencePicker
                value={recurrenceRule}
                endDate={recurrenceEndDate}
                onChange={handleSetRecurrenceRule}
                onEndDateChange={setRecurrenceEndDate}
              />
            </div>
          </div>
        )}
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
          {isSubmitting ? 'Creating...' : 'Create Task'}
        </Button>
      </div>
    </>
  ), [content, priority, projectId, dueDate, assignTo, selectedAgent, showAdvanced, isSubmitting, agents, projects, recurrenceRule, recurrenceEndDate, parsedTask, manualOverrides]);

  // Mobile: Bottom Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onClose}>
        <SheetContent side="bottom" className="h-[75vh] p-0 gap-0">
          <SheetTitle className="sr-only">Create Task</SheetTitle>
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <ModalHeader
                title="Create Task"
                onClose={handleClose}
                showClose={false}
              />
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {taskFormContent}
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
        <DialogTitle className="sr-only">Create Task</DialogTitle>
        <ModalHeader title="Create Task" onClose={handleClose} showClose={false} />
        {taskFormContent}
      </DialogContent>
    </Dialog>
  );
}
