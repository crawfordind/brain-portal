"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlugZap, Bot } from "lucide-react";
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
 * The Review workspace: everything delegated to Jack, and what it needs from you.
 *
 * Quick questions happen in the chat ("Ask about this"). What lands here is
 * work Jack does with its own tools: things sent with "Send to Jack", plus
 * heartbeat jobs, MCP delegation and skill runs. Each task shows Jack's live
 * state, pauses here when Jack needs an approval, and keeps every version.
 */
export function ReviewView({
  onTaskClick,
  onCreateTask,
  reviewCount,
  showHeading = true,
}: ReviewViewProps) {
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * A live round trip to Jack through the server (`/api/jack/status?check=true`).
   * This used to be "Process queue", which called the cron route from the
   * browser and was refused in production for want of the cron secret.
   */
  const handleCheckJack = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/jack/status?check=true");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check Jack");

      if (result.state !== "ready") {
        toast.warning("Jack is not connected", { description: result.message, duration: 10000 });
      } else if (result.check?.ok) {
        toast.success(`Jack is connected (profile "${result.profile}")`);
      } else if (result.check?.reachable === false) {
        toast.error("Jack cannot be reached", { description: result.check.error, duration: 10000 });
      } else if (result.check && !result.check.profileMatches) {
        toast.error("Connected to the wrong Hermes profile", {
          description: `Expected "${result.profile}", Jack's server reports "${result.check.reportedProfile ?? "unknown"}".`,
          duration: 10000,
        });
      } else {
        toast.error("Jack's server is missing features Brain Portal needs", {
          description: (result.check?.missingFeatures ?? []).join(", "),
          duration: 10000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["jack-status"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check Jack");
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
            <h2 className="text-sm font-semibold">Jack</h2>
            <p className="hidden sm:block text-xs text-muted-foreground truncate">
              {reviewCount > 0
                ? `${reviewCount} output${reviewCount === 1 ? "" : "s"} waiting on your decision`
                : "Nothing waiting. Work you send to Jack lands here."}
            </p>
          </div>
        ) : (
          <div />
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckJack}
          disabled={isProcessing}
          className="h-8 shrink-0 text-xs"
        >
          <PlugZap className="mr-1.5 h-3.5 w-3.5" />
          {isProcessing ? "Checking…" : "Test Jack connection"}
        </Button>
      </div>

      <AgentQueue onTaskClick={onTaskClick} onCreateTask={onCreateTask} />
    </div>
  );
}
