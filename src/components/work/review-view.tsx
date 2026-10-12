"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlugZap, Bot } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AgentQueue } from "@/components/agents/agent-queue";
import { useAgentRuntime } from "@/hooks/use-agent-runtime";

interface ReviewViewProps {
  onTaskClick: (agentTaskId: string) => void;
  onCreateTask: () => void;
  reviewCount: number;
  /** The /review page renders its own page title, so it hides this one. */
  showHeading?: boolean;
}

/**
 * The Review workspace: everything delegated to the configured agent, and
 * what it needs from you.
 *
 * Quick questions happen in the chat ("Ask about this"). What lands here is
 * background work: things sent with "Send to …", plus heartbeat jobs, MCP
 * delegation and skill runs. Each task shows its state, pauses here when a
 * runtime that supports approvals needs one, and keeps every version.
 */
export function ReviewView({
  onTaskClick,
  onCreateTask,
  reviewCount,
  showHeading = true,
}: ReviewViewProps) {
  const queryClient = useQueryClient();
  const runtime = useAgentRuntime();
  const name = runtime.displayName;
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * A live round trip to the agent through the server
   * (`/api/agent-runtime/status?check=true`). Offered only by runtimes that
   * have something to check; an OpenRouter key is checked in Settings.
   */
  const handleCheckConnection = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/agent-runtime/status?check=true");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Could not check ${name}`);

      if (result.state !== "ready") {
        toast.warning(`${name} is not connected`, { description: result.message, duration: 10000 });
      } else if (result.check?.ok) {
        toast.success(`${name} is connected`);
      } else if (result.check?.reachable === false) {
        toast.error(`${name} cannot be reached`, { description: result.check.error, duration: 10000 });
      } else if (result.check && !result.check.profileMatches) {
        toast.error("Connected to the wrong Hermes profile", {
          description: `Expected "${result.check.expectedProfile}", the server reports "${result.check.reportedProfile ?? "unknown"}".`,
          duration: 10000,
        });
      } else {
        toast.error("The agent server is missing features Brain Portal needs", {
          description: (result.check?.missingFeatures ?? []).join(", "),
          duration: 10000,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["agent-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["agent-runtime-status"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not check ${name}`);
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
            <h2 className="text-sm font-semibold">{name}</h2>
            <p className="hidden sm:block text-xs text-muted-foreground truncate">
              {reviewCount > 0
                ? `${reviewCount} output${reviewCount === 1 ? "" : "s"} waiting on your decision`
                : `Nothing waiting. Work you send to ${name} lands here.`}
            </p>
          </div>
        ) : (
          <div />
        )}

        {runtime.capabilities.connectionTest && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckConnection}
            disabled={isProcessing}
            className="h-8 shrink-0 text-xs"
          >
            <PlugZap className="mr-1.5 h-3.5 w-3.5" />
            {isProcessing ? "Checking…" : `Test ${name} connection`}
          </Button>
        )}
      </div>

      <AgentQueue onTaskClick={onTaskClick} onCreateTask={onCreateTask} />
    </div>
  );
}
