"use client";

/**
 * One panel for a task — creating it, reading it, changing it.
 *
 * This replaces three separate surfaces. Before, viewing a task opened a
 * read-only dialog whose Edit button *closed that dialog and opened another
 * one*, which was a near-duplicate of the create dialog maintained separately
 * from it. Three files, ~1,100 lines, two of them drifting apart: the create
 * form could hand a task to an agent and the edit form could not, so the only
 * moment you were ever allowed to delegate was the moment you first wrote the
 * task down.
 *
 * Here there is no view mode. The fields are the display — a title you can
 * type into, a row of controls showing what is set. Nothing to open, nothing
 * to switch into. The Save bar appears only once something has actually
 * changed, so reading a task costs no chrome.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { format } from "date-fns";
import {
  Bot,
  Calendar,
  CheckSquare,
  Circle,
  FileText,
  FolderOpen,
  Repeat,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecurrencePicker } from "@/components/tasks/recurrence-picker";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useMobile } from "@/hooks/use-mobile";
import { useNLTaskParser } from "@/lib/hooks/use-nl-task-parser";
import { addToQueue } from "@/lib/offline/simple-queue";
import { rruleToText } from "@/lib/tasks/recurrence";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/task";

interface Project {
  id: string;
  name: string;
}

interface Agent {
  agent_type: string;
  name?: string;
  display_name?: string;
}

export interface TaskPanelProps {
  /** The task being edited, or null to create a new one. */
  task: Task | null;
  open: boolean;
  onClose: () => void;
  projects: Project[];
  /** Open the agent's output in the review panel. */
  onReview?: (agentTaskId: string) => void;
  /** Start a chat pinned to this task. */
  onAskAbout?: (task: Task) => void;
}

/** The editable shape of a task, independent of how it is stored. */
interface Draft {
  title: string;
  description: string;
  status: Task["status"];
  priority: Task["priority"];
  dueDate: string;
  projectId: string;
  recurrenceRule: string | null;
  recurrenceEndDate: string | null;
  delegatedTo: string | null;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  description: "",
  status: "pending",
  priority: "medium",
  dueDate: "",
  projectId: "",
  recurrenceRule: null,
  recurrenceEndDate: null,
  delegatedTo: null,
};

function draftFromTask(task: Task | null): Draft {
  if (!task) return { ...EMPTY_DRAFT };
  return {
    title: task.title || task.content || "",
    description: task.description || "",
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date ? task.due_date.slice(0, 10) : "",
    projectId: task.project_id || "",
    recurrenceRule: task.recurrence_rule,
    recurrenceEndDate: task.recurrence_end_date,
    delegatedTo: task.delegated_to,
  };
}

const STATUS_LABELS: Record<Task["status"], string> = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_TONE: Record<Task["priority"], string> = {
  low: "text-muted-foreground",
  medium: "text-blue-600 dark:text-blue-400",
  high: "text-orange-600 dark:text-orange-400",
  urgent: "text-red-600 dark:text-red-400",
};

export function TaskPanel({
  task,
  open,
  onClose,
  projects,
  onReview,
  onAskAbout,
}: TaskPanelProps) {
  const isCreate = !task;
  const isMobile = useMobile(768);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>(() => draftFromTask(task));
  const [saving, setSaving] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  /** Fields the user set by hand, which the parser must not overwrite. */
  const [overrides, setOverrides] = useState<Set<keyof Draft>>(new Set());

  const baseline = useMemo(() => draftFromTask(task), [task]);

  // Re-seed whenever the panel opens on a different task.
  useEffect(() => {
    if (!open) return;
    setDraft(draftFromTask(task));
    setOverrides(new Set());
    setShowRecurrence(Boolean(task?.recurrence_rule));
  }, [open, task?.id]);

  useEffect(() => {
    if (!open || !isCreate) return;
    const timer = setTimeout(() => titleRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open, isCreate]);

  const { data: agentsData } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to fetch agents");
      return res.json();
    },
    enabled: open,
  });
  const agents: Agent[] = agentsData?.agents ?? [];

  // Natural language only assists while composing. Re-parsing a saved task's
  // title every keystroke would fight the user over fields they already set.
  const parsed = useNLTaskParser(isCreate ? draft.title : "", projects);

  useEffect(() => {
    if (!isCreate || !parsed || parsed.parsedFields.length === 0) return;
    setDraft((d) => {
      const next = { ...d };
      if (parsed.parsedFields.includes("priority") && !overrides.has("priority")) {
        next.priority = parsed.priority as Task["priority"];
      }
      if (parsed.parsedFields.includes("dueDate") && parsed.dueDate && !overrides.has("dueDate")) {
        next.dueDate = parsed.dueDate;
      }
      if (parsed.parsedFields.includes("projectId") && parsed.projectId && !overrides.has("projectId")) {
        next.projectId = parsed.projectId;
      }
      if (
        parsed.parsedFields.includes("recurrenceRule") &&
        parsed.recurrenceRule &&
        !overrides.has("recurrenceRule")
      ) {
        next.recurrenceRule = parsed.recurrenceRule;
      }
      return next;
    });
  }, [parsed, overrides, isCreate]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setOverrides((o) => new Set(o).add(key));
  }, []);

  const isDirty = useMemo(
    () => (isCreate ? draft.title.trim().length > 0 : JSON.stringify(draft) !== JSON.stringify(baseline)),
    [draft, baseline, isCreate]
  );

  const close = () => {
    setDraft({ ...EMPTY_DRAFT });
    setOverrides(new Set());
    onClose();
  };

  const payload = () => ({
    content: draft.title.trim(),
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    priority: draft.priority,
    projectId: draft.projectId || null,
    dueDate: draft.dueDate || null,
    recurrenceRule: draft.recurrenceRule,
    recurrenceEndDate: draft.recurrenceEndDate,
    delegatedTo: draft.delegatedTo,
    ...(isCreate ? {} : { status: draft.status }),
    // Handing a task to an agent should actually start it, in both modes.
    ...(draft.delegatedTo && draft.delegatedTo !== baseline.delegatedTo
      ? { autoExecute: true }
      : {}),
  });

  const save = async () => {
    if (!draft.title.trim() || saving) return;
    setSaving(true);

    try {
      const res = await fetch(isCreate ? "/api/tasks" : `/api/tasks/${task!.id}`, {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) throw new Error("Request failed");

      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["stream"] });

      const delegatedNow = draft.delegatedTo && draft.delegatedTo !== baseline.delegatedTo;
      toast.success(
        isCreate
          ? delegatedNow
            ? "Task created and handed to an agent"
            : "Task created"
          : delegatedNow
            ? "Handed to an agent"
            : "Saved"
      );
      close();
    } catch {
      if (isCreate) {
        // Offline: keep the task rather than losing what was typed.
        addToQueue({ type: "task", operation: "create", data: payload() });
        toast.success("Task saved — will sync when you're back online");
        close();
      } else {
        toast.error("Couldn't save. Check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async () => {
    if (!task) return;
    const next = draft.status === "completed" ? "pending" : "completed";
    set("status", next);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      set("status", draft.status);
      toast.error("Couldn't update status");
    }
  };

  const remove = async () => {
    if (!task) return;
    const ok = await confirm({
      title: "Delete this task?",
      description: "This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted");
      close();
    } catch {
      toast.error("Couldn't delete task");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  const agentLabel = (type: string) =>
    agents.find((a) => a.agent_type === type)?.display_name ??
    agents.find((a) => a.agent_type === type)?.name ??
    type;

  const body = (
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown}>
      {/* Title — the field is the heading. */}
      <div className="flex items-start gap-2.5">
        {!isCreate && (
          <button
            onClick={toggleDone}
            className="mt-1.5 shrink-0 text-muted-foreground transition-colors hover:text-primary"
            aria-label={draft.status === "completed" ? "Mark as not done" : "Mark as done"}
          >
            {draft.status === "completed" ? (
              <CheckSquare className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <Circle className="h-5 w-5" />
            )}
          </button>
        )}
        <Input
          ref={titleRef}
          variant="title"
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={isCreate ? "What needs doing?" : "Untitled task"}
          className={cn(
            "md:text-xl",
            draft.status === "completed" && "text-muted-foreground line-through"
          )}
        />
      </div>

      {/* What the parser worked out, while it is still guessing. */}
      {isCreate && parsed && parsed.parsedFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
          <Sparkles className="h-3 w-3 text-purple-500" />
          <span className="text-xs text-muted-foreground">Picked up:</span>
          {parsed.parsedFields.map((f: string) => (
            <Badge key={f} variant="secondary" className="h-5 px-1.5 text-[10px]">
              {f === "dueDate" ? "due date" : f === "projectId" ? "project" : f}
            </Badge>
          ))}
        </div>
      )}

      <Textarea
        value={draft.description}
        onChange={(e) => set("description", e.target.value)}
        placeholder="Notes, links, anything worth remembering…"
        className="min-h-[72px]"
      />

      {/* Everything that can be set, on one surface. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!isCreate && (
          <Field icon={<Circle className="h-3.5 w-3.5" />} label="Status">
            <Select value={draft.status} onValueChange={(v) => set("status", v as Task["status"])}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field icon={<Sparkles className="h-3.5 w-3.5" />} label="Priority">
          <Select value={draft.priority} onValueChange={(v) => set("priority", v as Task["priority"])}>
            <SelectTrigger className={cn("h-9", PRIORITY_TONE[draft.priority])}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field icon={<Calendar className="h-3.5 w-3.5" />} label="Due">
          <Input
            type="date"
            variant="boxed"
            value={draft.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
            className="h-9"
          />
        </Field>

        <Field icon={<FolderOpen className="h-3.5 w-3.5" />} label="Project">
          <Select
            value={draft.projectId || "none"}
            onValueChange={(v) => set("projectId", v === "none" ? "" : v)}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/*
          Delegation, available whenever the task exists rather than only at
          the instant it is created. Deciding later that something should be
          handed off is the normal case, and it used to be impossible.
        */}
        <Field icon={<Bot className="h-3.5 w-3.5" />} label="Who does it">
          <Select
            value={draft.delegatedTo ?? "me"}
            onValueChange={(v) => set("delegatedTo", v === "me" ? null : v)}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="me">
                <span className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5" /> Me
                </span>
              </SelectItem>
              <SelectItem value="general">
                <span className="flex items-center gap-2">
                  <Bot className="h-3.5 w-3.5" /> An agent
                </span>
              </SelectItem>
              {agents
                .filter((a) => a.agent_type !== "general")
                .map((a) => (
                  <SelectItem key={a.agent_type} value={a.agent_type}>
                    {a.display_name ?? a.name ?? a.agent_type}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Recurrence stays folded away until it is wanted. */}
      <div>
        {showRecurrence || draft.recurrenceRule ? (
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Repeat className="h-3.5 w-3.5" /> Repeats
            </div>
            <RecurrencePicker
              value={draft.recurrenceRule}
              endDate={draft.recurrenceEndDate}
              onChange={(rule) => {
                set("recurrenceRule", rule);
                if (!rule) setShowRecurrence(false);
              }}
              onEndDateChange={(date) => set("recurrenceEndDate", date)}
            />
          </div>
        ) : (
          <button
            onClick={() => setShowRecurrence(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Repeat className="h-3.5 w-3.5" /> Make it repeat
          </button>
        )}
      </div>

      {/* Context that exists only once the task does. */}
      {task && (
        <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
          {task.recurrence_rule && !showRecurrence && (
            <span className="flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5" /> {rruleToText(task.recurrence_rule)}
            </span>
          )}
          {task.note_slug && (
            <Link
              href={`/notes/${task.note_slug}`}
              className="flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5" /> From “{task.note_title}”
            </Link>
          )}
          {task.delegated_to && (
            <span className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-purple-500" />
              Handed to {agentLabel(task.delegated_to)}
            </span>
          )}
          <span>Created {format(new Date(task.created_at), "MMM d, yyyy")}</span>
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="mt-5 flex items-center gap-2 border-t pt-3">
      {task && (
        <>
          <Button variant="ghost" size="sm" onClick={remove} className="text-destructive">
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
          </Button>
          {onAskAbout && (
            <Button variant="ghost" size="sm" onClick={() => { onAskAbout(task); close(); }}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Ask about this
            </Button>
          )}
          {task.agent_task_id && onReview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onReview(task.agent_task_id!); close(); }}
              className="text-purple-600 dark:text-purple-400"
            >
              <Bot className="mr-1.5 h-3.5 w-3.5" /> Review output
            </Button>
          )}
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={close}>
          {isDirty ? "Cancel" : "Close"}
        </Button>
        {/* Only offered once there is something to save. */}
        {isDirty && (
          <Button size="sm" onClick={save} disabled={saving || !draft.title.trim()}>
            {saving ? "Saving…" : isCreate ? "Create task" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );

  const title = isCreate ? "New task" : "Task";

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && close()}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto p-4">
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {body}
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {body}
        {footer}
      </DialogContent>
    </Dialog>
  );
}

/** A labelled control. Label above, so the row reads top-to-bottom on a phone. */
function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
