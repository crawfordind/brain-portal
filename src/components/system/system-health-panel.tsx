"use client";

/**
 * System Health Panel — the "why isn't this working?" sheet.
 *
 * Every issue answers three questions in order: what broke, what it means for
 * you, and what to tell the person who runs this deployment. The last one is the
 * point — most of these failures (missing API key, no credit, cron not firing)
 * are only fixable by an administrator, so the panel's job is to hand the user
 * something precise enough to forward.
 */

import { useCallback, useMemo, useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
  Cpu,
  RefreshCw,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatRelativeTime } from "@/lib/utils/date";
import {
  formatAdminReport,
  type IssueKind,
  type SystemHealth,
  type SystemIssue,
} from "@/lib/system-health/types";
import { dismissIssue, readDismissed, type DismissalMap } from "./dismissals";

const kindConfig: Record<IssueKind, { icon: typeof Bot; label: string }> = {
  agent_task: { icon: Bot, label: "AI delegation" },
  queue_job: { icon: Cpu, label: "Background processing" },
  heartbeat: { icon: Sparkles, label: "Automations" },
  skill: { icon: Sparkles, label: "Skills" },
  configuration: { icon: Server, label: "Server setup" },
};

interface SystemHealthPanelProps {
  isOpen: boolean;
  onClose: () => void;
  health: SystemHealth | undefined;
  visibleIssues: SystemIssue[];
  onDismissedChange: (map: DismissalMap) => void;
}

export function SystemHealthPanel({
  isOpen,
  onClose,
  health,
  visibleIssues,
  onDismissedChange,
}: SystemHealthPanelProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const retryMutation = useMutation({
    mutationFn: async (agentTaskId?: string) => {
      const res = await fetch("/api/system-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_agent_tasks", agentTaskId }),
      });
      if (!res.ok) throw new Error("Retry failed");
      return res.json() as Promise<{ requeued: number }>;
    },
    onSuccess: (result) => {
      toast.success(
        result.requeued > 0
          ? `Re-queued ${result.requeued} task${result.requeued === 1 ? "" : "s"}`
          : "Nothing left to retry"
      );
      queryClient.invalidateQueries({ queryKey: ["system-health"] });
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
    },
    onError: () => toast.error("Could not re-queue that work"),
  });

  // The report always covers everything the server reported, including issues
  // the user has dismissed locally — an admin needs the whole picture.
  const report = useMemo(
    () => (health ? formatAdminReport(health) : ""),
    [health]
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      toast.success("Report copied — paste it to your administrator");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy. Select the details manually instead.");
    }
  }, [report]);

  const handleDismiss = useCallback(
    (issue: SystemIssue) => {
      onDismissedChange(dismissIssue(issue, readDismissed()));
    },
    [onDismissedChange]
  );

  const hasRetryableAgentWork = visibleIssues.some(
    (issue) => issue.kind === "agent_task" && issue.diagnosis.userRetryable
  );

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              System status
              {health && health.errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-red-500/10 text-red-500 border-red-500/20"
                >
                  {health.errorCount} blocking
                </Badge>
              )}
            </SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleCopy}
              disabled={!report}
            >
              {copied ? (
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
              ) : (
                <Clipboard className="h-3.5 w-3.5 mr-1" />
              )}
              Copy report
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-60px)]">
          {visibleIssues.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-500/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                Everything is running
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                No background failures right now
              </p>
            </div>
          ) : (
            <div className="py-1">
              <div className="px-4 py-3 text-xs text-muted-foreground leading-relaxed border-b">
                Work that runs in the background — AI agents, search indexing,
                automations — has hit problems. Most of these are fixed on the
                server, not in the app. Use{" "}
                <span className="font-medium text-foreground">Copy report</span>{" "}
                to send the details to whoever administers this deployment.
              </div>

              {hasRetryableAgentWork && (
                <div className="px-4 py-3 border-b">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => retryMutation.mutate(undefined)}
                    disabled={retryMutation.isPending}
                  >
                    <RefreshCw
                      className={cn(
                        "h-3.5 w-3.5 mr-1.5",
                        retryMutation.isPending && "animate-spin"
                      )}
                    />
                    Retry failed AI work
                  </Button>
                </div>
              )}

              {visibleIssues.map((issue) => (
                <IssueRow
                  key={issue.signature}
                  issue={issue}
                  onDismiss={() => handleDismiss(issue)}
                  onRetry={
                    issue.retryTargetId
                      ? () => retryMutation.mutate(issue.retryTargetId)
                      : undefined
                  }
                  isRetrying={retryMutation.isPending}
                />
              ))}

              {health && (
                <p className="px-4 py-3 text-[10px] text-muted-foreground/60">
                  Last checked {formatRelativeTime(health.checkedAt)}
                </p>
              )}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Issue row ───────────────────────────────────────

function IssueRow({
  issue,
  onDismiss,
  onRetry,
  isRetrying,
}: {
  issue: SystemIssue;
  onDismiss: () => void;
  onRetry?: () => void;
  isRetrying: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const isError = issue.diagnosis.severity === "error";
  const config = kindConfig[issue.kind] || kindConfig.configuration;
  const Icon = config.icon;

  return (
    <div className="group flex gap-3 px-4 py-3 border-b last:border-b-0">
      <div
        className={cn(
          "flex-shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center",
          isError ? "bg-red-500/10" : "bg-amber-500/10"
        )}
      >
        <Icon className={cn("h-4 w-4", isError ? "text-red-500" : "text-amber-500")} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">
            {issue.diagnosis.title}
          </p>
          <button
            onClick={onDismiss}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex-shrink-0"
            title="Hide until this happens again"
            aria-label="Hide this issue"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {issue.diagnosis.explanation}
        </p>

        <p className="text-xs text-foreground/70 mt-1.5 line-clamp-2">
          {issue.subject}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-[10px] text-muted-foreground/60">
            {formatRelativeTime(issue.occurredAt)}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] px-1 py-0 h-4",
              isError
                ? "bg-red-500/10 text-red-500 border-red-500/20"
                : "bg-amber-500/10 text-amber-500 border-amber-500/20"
            )}
          >
            {isError ? "blocking" : "degraded"}
          </Badge>
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 border-muted-foreground/20"
          >
            {config.label}
          </Badge>
          {issue.count > 1 && (
            <Badge
              variant="outline"
              className="text-[9px] px-1 py-0 h-4 border-muted-foreground/20"
            >
              ×{issue.count}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={showDetails}
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                showDetails && "rotate-180"
              )}
            />
            Details for your admin
          </button>
          {onRetry && issue.diagnosis.userRetryable && (
            <button
              onClick={onRetry}
              disabled={isRetrying}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
              Retry
            </button>
          )}
        </div>

        {showDetails && (
          <div className="mt-2 rounded-md bg-muted/50 p-2.5 space-y-1.5">
            <div className="flex items-start gap-1.5">
              <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {issue.diagnosis.adminHint}
              </p>
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              code: {issue.diagnosis.code}
            </p>
            {issue.rawError && (
              <pre className="text-[10px] font-mono text-muted-foreground/70 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                {issue.rawError}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
