"use client";

/**
 * Tasks the AI found in things you already wrote.
 *
 * This band used to render unconditionally — a permanent 56px header
 * advertising "Suggested Tasks 0", collapsed by default, on desktop list view
 * only. So the feature was simultaneously always in the way and impossible to
 * find: you paid for it with space on every visit and only saw its contents if
 * you happened to click the bar and then click Scan.
 *
 * Now it renders only when it has something to say, and when it does it is
 * already open. Same rule the stream dashboard's bands follow.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TaskRecommendation {
  id: string;
  source_type: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: string;
  reasoning: string | null;
  status: string;
  created_at: string;
  note_title?: string;
  note_slug?: string;
  project_name?: string;
}

interface RecommendationsListProps {
  className?: string;
}

/**
 * Trigger a scan of recent notes. Exported so the surface that owns the page
 * chrome can offer it when there is nothing to show and this band is hidden.
 */
export function useScanForTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tasks/recommendations/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "recent", daysBack: 7 }),
      });
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.recommendationCount > 0) {
        toast.success(
          `Found ${data.recommendationCount} task${data.recommendationCount === 1 ? "" : "s"} in your notes`
        );
      } else {
        toast.info("Nothing new in your recent notes");
      }
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: () => toast.error("Couldn't scan your notes"),
  });
}

export function RecommendationsList({ className }: RecommendationsListProps) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/recommendations?status=pending&limit=10");
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const scan = useScanForTasks();

  const respond = useMutation({
    mutationFn: async ({ id, feedback }: { id: string; feedback: "accepted" | "rejected" }) => {
      const res = await fetch(`/api/tasks/recommendations/${id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onMutate: ({ id }) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (_d, { feedback }) => {
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      if (feedback === "accepted") {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        toast.success("Added to your tasks");
      }
    },
    onError: () => toast.error("Didn't stick — try again"),
  });

  const dismissAll = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tasks/recommendations", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recommendations"] }),
    onError: () => toast.error("Couldn't clear suggestions"),
  });

  const recommendations: TaskRecommendation[] = data?.recommendations ?? [];

  // Nothing to say, so nothing on screen. A header reading "Suggested Tasks"
  // above an empty list is chrome pretending to be content.
  if (isLoading) return <Skeleton className={cn("h-9 w-full rounded-lg", className)} />;
  if (recommendations.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-lg border border-purple-200/60 bg-purple-50/40 dark:border-purple-900/50 dark:bg-purple-950/20",
        className
      )}
      aria-label="Tasks found in your notes"
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        <h2 className="text-xs font-medium text-purple-900 dark:text-purple-200">
          Found in your notes
        </h2>
        <span className="text-xs text-muted-foreground">
          {recommendations.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            <RefreshCw className={cn("h-3 w-3", scan.isPending && "animate-spin")} />
            <span className="ml-1 hidden sm:inline">Look again</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-xs text-muted-foreground"
            onClick={() => dismissAll.mutate()}
            disabled={dismissAll.isPending}
          >
            Clear
          </Button>
        </div>
      </header>

      <ul className="divide-y divide-purple-200/50 dark:divide-purple-900/40">
        {recommendations.map((rec) => (
          <li
            key={rec.id}
            className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-purple-100/40 dark:hover:bg-purple-900/20"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{rec.recommended_task}</p>
              {(rec.note_title || rec.project_name) && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {rec.note_slug && rec.note_title ? (
                    <Link
                      href={`/notes/${rec.note_slug}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {rec.note_title}
                    </Link>
                  ) : (
                    rec.note_title
                  )}
                  {rec.project_name && ` · ${rec.project_name}`}
                </p>
              )}
            </div>

            {/* Two actions, both one tap: keep it, or don't. Actions stay
                visible rather than appearing on hover — the one device that
                hovers is not the one that most needs the affordance. */}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-green-700 hover:bg-green-100 hover:text-green-800 dark:text-green-400 dark:hover:bg-green-900/40"
                onClick={() => respond.mutate({ id: rec.id, feedback: "accepted" })}
                disabled={busyId === rec.id}
                aria-label={`Add "${rec.recommended_task}" to tasks`}
              >
                {busyId === rec.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Add</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => respond.mutate({ id: rec.id, feedback: "rejected" })}
                disabled={busyId === rec.id}
                aria-label={`Dismiss "${rec.recommended_task}"`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
