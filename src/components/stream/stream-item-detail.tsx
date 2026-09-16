"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useStreamStore } from "@/lib/stores/stream-store";
import { cn } from "@/lib/utils";
import {
  X,
  ExternalLink,

  Archive,
  Check,
  Clock,
  Lightbulb,
  CheckSquare,
  FileText,
  HelpCircle,
  Link as LinkIcon,
  Bell,
  GitFork,
  Sparkles,
  Bot,
  Zap,
  BookOpen,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAskAbout, toChatItemType } from "@/hooks/use-ask-about";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import type { StreamItemType } from "@/lib/stream/types";

const TYPE_CONFIG: Record<
  StreamItemType,
  { icon: typeof Lightbulb; color: string; bg: string; label: string }
> = {
  thought: { icon: Lightbulb, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", label: "Thought" },
  task: { icon: CheckSquare, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", label: "Task" },
  note: { icon: FileText, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", label: "Note" },
  journal: { icon: BookOpen, color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-50 dark:bg-teal-950/30", label: "Journal" },
  question: { icon: HelpCircle, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30", label: "Question" },
  decision: { icon: GitFork, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30", label: "Decision" },
  reference: { icon: LinkIcon, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-50 dark:bg-cyan-950/30", label: "Reference" },
  insight: { icon: Sparkles, color: "text-pink-600 dark:text-pink-400", bg: "bg-pink-50 dark:bg-pink-950/30", label: "Insight" },
  agent_output: { icon: Bot, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/30", label: "Agent Output" },
  reminder: { icon: Bell, color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/30", label: "Reminder" },
  capture: { icon: Zap, color: "text-gray-600 dark:text-gray-400", bg: "bg-gray-50 dark:bg-gray-950/30", label: "Capture" },
};

interface DetailItem {
  id: string;
  type: StreamItemType;
  status: string;
  title: string;
  content: string;
  priority: string;
  projectName?: string | null;
  projectColor?: string | null;
  tags: string[];
  dueDate?: string | null;
  delegatedTo?: string | null;
  agentStatus?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function StreamItemDetail() {
  const router = useRouter();
  const { selectedItemId, setSelectedItemId } = useStreamStore();
  const [item, setItem] = useState<DetailItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const { askAbout } = useAskAbout();

  const fetchItem = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stream/${id}`);
      if (res.ok) {
        const data = await res.json();
        setItem(data);
      } else {
        toast.error("Failed to load item details");
        setSelectedItemId(null);
      }
    } catch {
      toast.error("Failed to load item details");
      setSelectedItemId(null);
    } finally {
      setIsLoading(false);
    }
  }, [setSelectedItemId]);

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedItemId) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedItemId(null);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedItemId, setSelectedItemId]);

  useEffect(() => {
    if (selectedItemId && panelRef.current) {
      panelRef.current.focus();
    }
  }, [selectedItemId, item]);

  useEffect(() => {
    if (selectedItemId) {
      fetchItem(selectedItemId);
    } else {
      setItem(null);
    }
  }, [selectedItemId, fetchItem]);

  if (!selectedItemId) return null;

  const handleClose = () => setSelectedItemId(null);

  const handleComplete = async () => {
    if (!item) return;
    setIsCompleting(true);
    try {
      const res = await fetch(`/api/tasks/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (res.ok) {
        setItem({ ...item, status: "completed" });
        toast.success("Marked as completed");
      } else {
        toast.error("Failed to complete item");
      }
    } catch {
      toast.error("Failed to complete item");
    } finally {
      setIsCompleting(false);
    }
  };

  const handleArchive = async () => {
    if (!item) return;
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/stream/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      if (res.ok) {
        toast.success("Archived");
        setSelectedItemId(null);
      } else {
        toast.error("Failed to archive");
      }
    } catch {
      toast.error("Failed to archive");
    } finally {
      setIsArchiving(false);
    }
  };

  const handleOpenFull = () => {
    if (!item) return;
    if (item.type === "note") {
      router.push(`/notes/${item.id}`);
    } else if (item.type === "journal") {
      router.push("/journal");
    } else if (item.type === "task") {
      router.push(`/tasks?selected=${item.id}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(item.title)}`);
    }
    setSelectedItemId(null);
  };

  const config = item ? (TYPE_CONFIG[item.type] || TYPE_CONFIG.capture) : TYPE_CONFIG.capture;
  const Icon = config.icon;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-50 lg:hidden"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Item details"
        tabIndex={-1}
        className={cn(
          "fixed z-50 bg-background border-l shadow-xl outline-none",
          "inset-x-0 bottom-0 top-auto rounded-t-2xl max-h-[80vh] lg:rounded-none",
          "lg:top-0 lg:right-0 lg:bottom-0 lg:left-auto lg:w-[480px] lg:max-h-full",
          "animate-in slide-in-from-bottom lg:slide-in-from-right duration-200"
        )}
      >
        {/* Handle (mobile) */}
        <div className="flex justify-center pt-2 lg:hidden">
          <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          {item && (
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn("flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0", config.bg)}>
                <Icon className={cn("h-3.5 w-3.5", config.color)} />
              </div>
              <span className={cn("text-xs font-medium", config.color)}>{config.label}</span>
            </div>
          )}
          <button
            onClick={handleClose}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-auto max-h-[calc(80vh-60px)] lg:max-h-[calc(100vh-60px)]">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && item && (
            <>
              {/* Title */}
              <div>
                <h2 className={cn(
                  "text-lg font-semibold leading-tight",
                  item.status === "completed" && "line-through text-muted-foreground"
                )}>
                  {item.title}
                </h2>
              </div>

              {/* Metadata row */}
              <div className="flex items-center gap-2 flex-wrap">
                {item.priority && item.priority !== "medium" && (
                  <Badge variant={item.priority === "urgent" ? "destructive" : "outline"} className="text-xs capitalize">
                    {item.priority}
                  </Badge>
                )}
                {item.status !== "active" && (
                  <Badge variant="secondary" className="text-xs capitalize">
                    {item.status}
                  </Badge>
                )}
                {item.projectName && (
                  <Badge variant="outline" className="text-xs" style={{
                    borderColor: item.projectColor || undefined,
                    color: item.projectColor || undefined,
                  }}>
                    {item.projectName}
                  </Badge>
                )}
                {item.dueDate && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Due {item.dueDate}
                  </span>
                )}
              </div>

              {/* Tags */}
              {item.tags?.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Content body */}
              {item.content && item.content !== item.title && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {item.content}
                  </p>
                </div>
              )}

              {/* Agent status */}
              {item.delegatedTo && (
                <div className="flex items-center gap-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3">
                  <Bot className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                  <div className="text-xs">
                    <span className="font-medium">Delegated to {item.delegatedTo}</span>
                    {item.agentStatus && (
                      <span className="text-muted-foreground"> &middot; {item.agentStatus}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="space-y-1 text-xs text-muted-foreground border-t pt-3">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Created {(() => {
                    try { return formatDistanceToNow(new Date(item.createdAt), { addSuffix: true }); }
                    catch { return item.createdAt; }
                  })()}
                </div>
                {item.updatedAt !== item.createdAt && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Updated {(() => {
                      try { return format(new Date(item.updatedAt), "MMM d, yyyy 'at' h:mm a"); }
                      catch { return item.updatedAt; }
                    })()}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {item.type === "task" && item.status !== "completed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs flex-1 min-w-[100px]"
                    onClick={handleComplete}
                    disabled={isCompleting}
                  >
                    {isCompleting ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Complete
                  </Button>
                )}
                {item.type !== "agent_output" && toChatItemType(item.type) !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs flex-1 min-w-[100px]"
                    onClick={() =>
                      askAbout({
                        id: item.id,
                        type: item.type,
                        title: item.title,
                        content: item.content,
                      })
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Ask about this
                  </Button>
                )}
                <Button variant="outline" size="sm" className="text-xs flex-1 min-w-[100px]" onClick={handleOpenFull}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open full
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs flex-1 min-w-[100px] text-muted-foreground hover:text-foreground"
                  onClick={handleArchive}
                  disabled={isArchiving}
                >
                  {isArchiving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Archive
                </Button>
              </div>
            </>
          )}

          {!isLoading && !item && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Item not found</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
