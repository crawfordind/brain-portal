"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Sparkles, RefreshCw, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { RecommendationCard } from "./recommendation-card";

interface TaskRecommendation {
  id: string;
  source_type: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: string;
  reasoning: string | null;
  status: string;
  created_at: string;
}

interface RecommendationsListProps {
  className?: string;
}

export function RecommendationsList({ className }: RecommendationsListProps) {
  const queryClient = useQueryClient();

  // Collapsible state - persisted to localStorage
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('recommendations-expanded');
      return stored === 'true';
    }
    return false; // Default: collapsed
  });

  // Persist state changes to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('recommendations-expanded', String(isExpanded));
    }
  }, [isExpanded]);

  const { data, isLoading } = useQuery({
    queryKey: ["recommendations"],
    queryFn: async () => {
      const response = await fetch("/api/tasks/recommendations?status=pending&limit=10");
      if (!response.ok) {
        throw new Error("Failed to fetch recommendations");
      }
      return response.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tasks/recommendations/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "recent",
          daysBack: 7,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to scan for tasks");
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data.recommendationCount > 0) {
        toast.success(`Found ${data.recommendationCount} task recommendations!`);
      } else {
        toast.info("No new tasks found in recent notes");
      }
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: () => {
      toast.error("Failed to scan for tasks");
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/tasks/recommendations", {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to clear recommendations");
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data.dismissedCount > 0) {
        toast.success(`Cleared ${data.dismissedCount} task recommendation${data.dismissedCount === 1 ? '' : 's'}`);
      } else {
        toast.info("No recommendations to clear");
      }
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
    onError: () => {
      toast.error("Failed to clear recommendations");
    },
  });

  const recommendations = data?.recommendations || [];
  const hasRecommendations = recommendations.length > 0;

  if (isLoading) {
    return (
      <div className={className}>
        {/* Show collapsed header skeleton while loading */}
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={className}>
      {/* Header wrapped in CollapsibleTrigger */}
      <CollapsibleTrigger asChild>
        <div
          className="flex items-center justify-between p-3 lg:p-4 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer mb-4 gap-2"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`Suggested Tasks, ${recommendations.length} items, ${isExpanded ? 'expanded' : 'collapsed'}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded(!isExpanded);
            }
          }}
        >
          {/* Left side: Icon + Title + Badge */}
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 lg:h-5 lg:w-5 text-purple-500 shrink-0" />
            <h2 className="text-base lg:text-lg font-semibold truncate">Suggested Tasks</h2>
            {hasRecommendations && (
              <Badge variant="default" className="shrink-0">{recommendations.length}</Badge>
            )}
          </div>

          {/* Right side: Action buttons + Chevron */}
          <div className="flex items-center gap-1 lg:gap-2 shrink-0">
            {/* Clear All - only shown when expanded */}
            {isExpanded && hasRecommendations && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllMutation.mutate();
                }}
                disabled={clearAllMutation.isPending}
                className="hidden sm:flex"
              >
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}

            {/* Scan button - always visible, icon-only on very small screens */}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                scanMutation.mutate();
              }}
              disabled={scanMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 ${scanMutation.isPending ? "animate-spin" : ""}`} />
              <span className="ml-2 hidden sm:inline">Scan</span>
            </Button>

            {/* Chevron indicator */}
            <ChevronDown
              className={`h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      {/* Content wrapped in CollapsibleContent */}
      <CollapsibleContent>
        {/* Empty state */}
        {!hasRecommendations && !scanMutation.isPending && (
          <div className="text-center py-12 border-2 border-dashed rounded-lg">
            <Sparkles className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">
              No task recommendations yet
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Click &quot;Scan for Tasks&quot; to analyze your recent notes
            </p>
          </div>
        )}

        {/* Cards */}
        {hasRecommendations && (
          <div className="space-y-3">
            {recommendations.map((rec: TaskRecommendation) => (
              <RecommendationCard key={rec.id} recommendation={rec} />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
