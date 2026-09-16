"use client";

/**
 * Stream Item Card — one item in the feed, at one of three densities.
 *
 * `comfortable` is the card this component used to be, unchanged. `cozy` keeps
 * a single preview line. `compact` is one line: icon, title, the one or two
 * pieces of metadata that change a decision, a short time, and the actions.
 *
 * Two rules govern what the shorter rows drop:
 *
 * - **Nothing shrinks below legibility.** Rows get shorter by *removing*
 *   elements, never by reducing type below 12px or squeezing a touch target.
 *   Action buttons stay 44px on a coarse pointer at every density; at compact
 *   they overflow the row's 40px box through negative margin, so the target is
 *   full-size while the row stays short.
 * - **Actions are always visible.** They used to be
 *   `md:opacity-0 md:group-hover:opacity-100`, which made every capability of
 *   the app a hover-only secret on the one device that can hover.
 */

import { cn } from "@/lib/utils";
import { toChatItemType } from "@/hooks/use-ask-about";
import { parseDbTimestamp, shortTimeLabel } from "@/lib/stream/grouping";
import type { StreamDensity } from "@/lib/stream/density";
import {
  Brain,
  Sparkles,
  CheckSquare,
  FileText,
  HelpCircle,
  Link,
  Bell,
  BellOff,
  Lightbulb,
  GitFork,
  Bot,
  Zap,
  Clock,
  MoreHorizontal,
  ExternalLink,
  Check,
  Archive,
  BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AGENT_ROLES } from "@/lib/agents/constants";
import { formatDistanceToNow } from "date-fns";
import type { StreamItemType, AgentType } from "@/lib/stream/types";

const TYPE_CONFIG: Record<
  StreamItemType,
  { icon: typeof Brain; color: string; bg: string; label: string }
> = {
  thought: {
    icon: Lightbulb,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    label: "Thought",
  },
  task: {
    icon: CheckSquare,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    label: "Task",
  },
  note: {
    icon: FileText,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    label: "Note",
  },
  journal: {
    icon: BookOpen,
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    label: "Journal",
  },
  question: {
    icon: HelpCircle,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    label: "Question",
  },
  decision: {
    icon: GitFork,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    label: "Decision",
  },
  reference: {
    icon: Link,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    label: "Reference",
  },
  insight: {
    icon: Sparkles,
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-50 dark:bg-pink-950/30",
    label: "Insight",
  },
  agent_output: {
    icon: Bot,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    label: "Agent Output",
  },
  reminder: {
    icon: Bell,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    label: "Reminder",
  },
  capture: {
    icon: Zap,
    color: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-50 dark:bg-gray-950/30",
    label: "Capture",
  },
};

const PRIORITY_STYLES = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-blue-500",
  low: "border-l-gray-300 dark:border-l-gray-700",
};

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "Active", variant: "outline" },
  processing: { label: "Processing", variant: "default" },
  waiting: { label: "Needs Review", variant: "destructive" },
  completed: { label: "Done", variant: "secondary" },
  archived: { label: "Archived", variant: "secondary" },
};

interface StreamItemCardProps {
  item: {
    id: string;
    type: StreamItemType;
    status: string;
    title: string;
    content: string;
    priority: string;
    projectId?: string | null;
    projectName?: string | null;
    projectColor?: string | null;
    tags: string[];
    dueDate?: string | null;
    delegatedTo?: string | null;
    agentTaskId?: string | null;
    agentStatus?: string | null;
    sourceType: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string | null;
  };
  density?: StreamDensity;
  /** Changed since the viewer's last visit — gets a quiet marker, not a badge. */
  isNew?: boolean;
  onSelect?: (id: string) => void;
  onComplete?: (id: string) => void;
  onAskAbout?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

export function StreamItemCard({
  item,
  density = "comfortable",
  isNew = false,
  onSelect,
  onComplete,
  onAskAbout,
  onArchive,
  onDismiss,
}: StreamItemCardProps) {
  const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.capture;
  const Icon = config.icon;
  const priorityStyle = PRIORITY_STYLES[item.priority as keyof typeof PRIORITY_STYLES] || PRIORITY_STYLES.low;
  const statusBadge = STATUS_BADGE[item.status] || STATUS_BADGE.active;

  const updatedAt = parseDbTimestamp(item.updatedAt);
  const timeAgo = updatedAt ? formatDistanceToNow(updatedAt, { addSuffix: true }) : "";
  const timeShort = updatedAt ? shortTimeLabel(updatedAt, new Date()) : "";

  const isTask = item.type === "task";
  const isReminder = item.type === "reminder";
  const isDelegated = !!item.delegatedTo;
  // Agent output is already an answer; everything else can be the subject of a
  // conversation as long as the chat knows how to load it.
  const canAskAbout = item.type !== "agent_output" && toChatItemType(item.type) !== null;
  // Archiving agent output would mean rejecting it, which is a review decision
  // with its own endpoint and side effects. `/api/stream/[id]` deliberately
  // does not touch `agent_tasks`, so offering the action here would only
  // produce a 404.
  const canArchive = !!onArchive && item.type !== "agent_output";
  const isAgentWorking = item.agentStatus === "processing" || item.agentStatus === "queued";
  const needsReview = item.agentStatus === "awaiting_review";
  const isCompleted = item.status === "completed";
  const isRow = density !== "comfortable";

  const openItem = () => onSelect?.(item.id);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openItem();
    }
  };

  /**
   * 44px on touch at every density. At compact the row is 40px, so the button
   * overflows it symmetrically rather than stretching it.
   */
  const actionButtonClass = cn(
    "shrink-0",
    isRow ? "h-11 w-11 -my-2 sm:h-8 sm:w-8 sm:my-0" : "h-9 w-9 sm:h-8 sm:w-8"
  );
  const actionIconClass = isRow ? "h-4 w-4 sm:h-3.5 sm:w-3.5" : "h-4 w-4 sm:h-3.5 sm:w-3.5";

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {isTask && !isCompleted && (
        <Button
          size="icon"
          variant="ghost"
          className={actionButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            onComplete?.(item.id);
          }}
          aria-label={`Complete task: ${item.title}`}
        >
          <Check className={actionIconClass} />
        </Button>
      )}

      {isReminder && item.status !== "archived" && onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className={actionButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(item.id);
          }}
          aria-label={`Dismiss reminder: ${item.title}`}
        >
          <BellOff className={actionIconClass} />
        </Button>
      )}

      {canAskAbout && (
        <Button
          size="icon"
          variant="ghost"
          className={actionButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            onAskAbout?.(item.id);
          }}
          aria-label={`Ask about: ${item.title}`}
        >
          <Sparkles className={actionIconClass} />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn(actionButtonClass, "text-muted-foreground")}
            onClick={(e) => e.stopPropagation()}
            aria-label={`More actions for: ${item.title}`}
          >
            <MoreHorizontal className={actionIconClass} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.type === "note" && (
            <DropdownMenuItem onClick={openItem}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Open note
            </DropdownMenuItem>
          )}
          {needsReview && (
            <DropdownMenuItem onClick={openItem}>
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              Review output
            </DropdownMenuItem>
          )}
          {canAskAbout && (
            <DropdownMenuItem onClick={() => onAskAbout?.(item.id)}>
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              Ask about this
            </DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem onClick={() => onArchive?.(item.id)}>
              <Archive className="h-3.5 w-3.5 mr-2" />
              Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  // ─── compact / cozy ────────────────────────────────────────────────────────
  if (isRow) {
    return (
      <div
        className={cn(
          "group relative flex items-center gap-2.5 rounded-md border-l-2 pl-2 pr-1",
          "transition-colors hover:bg-muted/50 focus-within:bg-muted/50",
          density === "compact" ? "py-1" : "py-1.5",
          priorityStyle,
          isCompleted && "opacity-60",
          needsReview && "bg-amber-50/60 dark:bg-amber-950/20"
        )}
      >
        {/* The "new since your last visit" marker. A 4px dot rather than a
            badge — it has to be findable while scrolling and invisible while
            reading. */}
        {isNew && (
          <span
            className="absolute -left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary"
            aria-label="New since your last visit"
          />
        )}

        <Icon className={cn("h-4 w-4 shrink-0", config.color)} aria-hidden />

        <div
          role="button"
          tabIndex={0}
          onClick={openItem}
          onKeyDown={handleKeyDown}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 outline-none"
        >
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm leading-tight",
                isCompleted && "line-through text-muted-foreground"
              )}
            >
              {item.title}
            </p>
            {density === "cozy" && item.content !== item.title && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {item.content.slice(0, 150)}
              </p>
            )}
          </div>

          {/* Only metadata that changes a decision survives at this size. */}
          <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
            {needsReview && (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                review
              </span>
            )}
            {isDelegated && (
              <span className="inline-flex items-center gap-1">
                <Bot className="h-3 w-3" />
                {isAgentWorking && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                )}
              </span>
            )}
            {item.dueDate && (
              <span className={cn(isReminder && "text-foreground")}>
                {isReminder ? item.dueDate : `Due ${item.dueDate}`}
              </span>
            )}
            {item.projectName && (
              <span
                className="max-w-[9rem] truncate"
                style={{ color: item.projectColor || undefined }}
              >
                {item.projectName}
              </span>
            )}
          </div>

          <time className="shrink-0 tabular-nums text-xs text-muted-foreground">
            {timeShort}
          </time>
        </div>

        {actions}
      </div>
    );
  }

  // ─── comfortable ───────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-l-4 bg-background transition-all duration-200",
        priorityStyle,
        "hover:shadow-md hover:border-l-primary/60",
        "focus-within:ring-2 focus-within:ring-primary/40",
        isCompleted && "opacity-60",
        needsReview && "ring-2 ring-amber-400/50"
      )}
    >
      {isNew && (
        <span
          className="absolute -left-2 top-4 h-1.5 w-1.5 rounded-full bg-primary"
          aria-label="New since your last visit"
        />
      )}

      {/* Main content area */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-start gap-3 p-2.5 sm:p-3 cursor-pointer outline-none"
        onClick={openItem}
        onKeyDown={handleKeyDown}
      >
        {/* Type icon */}
        <div
          className={cn(
            "flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-lg",
            config.bg
          )}
        >
          <Icon className={cn("h-4 w-4", config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <h3
              className={cn(
                "text-sm font-medium leading-tight",
                isCompleted && "line-through text-muted-foreground"
              )}
            >
              {item.title}
            </h3>
          </div>

          {/* Content preview — single line on mobile, two on desktop */}
          {item.content !== item.title && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 sm:line-clamp-2">
              {item.content.slice(0, 150)}
            </p>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={cn("text-[11px] font-semibold", config.color)}>
              {config.label}
            </span>

            <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo}
            </span>

            {item.projectName && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1"
                style={{
                  borderColor: item.projectColor || undefined,
                  color: item.projectColor || undefined,
                }}
              >
                {item.projectName}
              </Badge>
            )}

            {isDelegated && (
              <Badge
                variant="secondary"
                className="text-[10px] h-4 px-1 gap-0.5"
              >
                <Bot className="h-2.5 w-2.5" />
                {AGENT_ROLES[item.delegatedTo as AgentType] || item.delegatedTo}
                {isAgentWorking && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                )}
              </Badge>
            )}

            {item.status !== "active" && (
              <Badge variant={statusBadge.variant} className="text-[10px] h-4 px-1">
                {statusBadge.label}
              </Badge>
            )}

            {item.dueDate && (
              <span className="text-[10px] text-muted-foreground">
                {isReminder ? (
                  <><Bell className="inline h-2.5 w-2.5 mr-0.5" />{item.dueDate}</>
                ) : (
                  <>Due {item.dueDate}</>
                )}
              </span>
            )}

            {item.tags?.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1">
                #{tag}
              </Badge>
            ))}
            {item.tags?.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{item.tags.length - 2}
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        {actions}
      </div>

      {/* Compact review indicator */}
      {needsReview && (
        <div className="px-3 pb-2 -mt-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            <Sparkles className="h-2.5 w-2.5" />
            Awaiting review
          </span>
        </div>
      )}
    </div>
  );
}
