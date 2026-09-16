"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal, Bot } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AgentQueue } from "@/components/agents/agent-queue";

interface ReviewViewProps {
  onTaskClick: (agentTaskId: string) => void;
  onCreateTask: () => void;
  reviewCount: number;
  /** The /review page renders its own page title, so it hides this one. */
  showHeading?: boolean;
}

/**
 * The Review workspace — background agent output waiting on a decision.
 *
 * Interactive AI help now happens in the chat ("Ask about this"), where the
 * answer streams back and the follow-up is the next message. What still lands
 * here is work nobody was sitting in front of: heartbeat jobs, MCP delegation
 * and skill runs. That is a much smaller queue, so the stats dashboard that
 * used to sit beside it — activity chart, per-agent breakdown, four stat
 * cards — measured a system the user no longer drives by hand and is gone.
 */
export function ReviewView({
  onTaskClick,
  onCreateTask,
  reviewCount,
  showHeading = true,
}: ReviewViewProps) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessQueue = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/cron/process-agent-queue", { method: "POST" });
      const result = await response.json();

      if (!result.success) throw new Error(result.error || "Failed to process queue");

      const messages = [];
      if (result.stuck_reset > 0) messages.push(`${result.stuck_reset} stuck task(s) reset`);
      if (result.processed > 0) messages.push(`${result.processed} task(s) processed`);
      if (result.failed > 0) messages.push(`${result.failed} failed`);
      toast.success(messages.length > 0 ? messages.join(", ") : "Queue processed");

      if (result.errors?.length > 0) {
        result.errors.forEach((err: string) => toast.error(err, { duration: 8000 }));
      }

      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["agent-tasks-count"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (error) {
      toast.error(
        `Failed to process queue: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        {showHeading ? (
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" />
            <h2 className="text-sm font-semibold">Agent review</h2>
            <p className="hidden sm:block text-xs text-muted-foreground truncate">
              {reviewCount > 0
                ? `${reviewCount} output${reviewCount === 1 ? "" : "s"} waiting on your decision`
                : "Nothing waiting — background agent work lands here when it's done"}
            </p>
          </div>
        ) : (
          <div />
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleProcessQueue}
          disabled={isProcessing}
          className="h-8 shrink-0 text-xs"
        >
          <Terminal className="mr-1.5 h-3.5 w-3.5" />
          {isProcessing ? "Processing…" : "Process queue"}
        </Button>
      </div>

      <AgentQueue onTaskClick={onTaskClick} onCreateTask={onCreateTask} />
    </div>
  );
}
