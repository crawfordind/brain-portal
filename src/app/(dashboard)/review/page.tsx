"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { ReviewView } from "@/components/work/review-view";
import { WorkViewSwitcher } from "@/components/work/work-view-switcher";
import { AgentReviewFocusPanel } from "@/components/agents/agent-review-focus-panel";
import { LazyDialog } from "@/components/ui/lazy-dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useReviewCount } from "@/hooks/use-review-count";

/**
 * Review — agent output waiting on a decision.
 *
 * A real route rather than a panel inside Work. Reviewing is the step that
 * turns delegated work into finished work; it used to sit three clicks deep
 * behind a conditional button, and was unreachable entirely whenever the
 * queue happened to be empty.
 *
 * `?task=<agentTaskId>` opens straight into that output's focus panel, which
 * is what notifications and the old `/agents?task=` links point at.
 */
function ReviewPageContent() {
  const searchParams = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const reviewCount = useReviewCount();

  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    const taskParam = searchParams.get("task") ?? searchParams.get("review");
    if (taskParam) setReviewTaskId(taskParam);
  }, [searchParams]);

  return (
    <div className="space-y-2 p-3 lg:space-y-3 lg:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-xl font-bold lg:text-2xl">Review</h1>
          <p className="hidden truncate text-xs text-muted-foreground lg:block">
            {reviewCount > 0
              ? `${reviewCount} agent output${reviewCount === 1 ? "" : "s"} awaiting your decision`
              : "Approve, revise, or reject what your agents produce"}
          </p>
        </div>
      </div>

      <WorkViewSwitcher current="review" isDesktop={!!isDesktop} reviewCount={reviewCount} />

      <div className="pt-1">
        <ReviewView
          onTaskClick={setReviewTaskId}
          onCreateTask={() => setIsCreateOpen(true)}
          reviewCount={reviewCount}
          showHeading={false}
        />
      </div>

      <LazyDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        loader={() =>
          import("@/components/tasks/task-create-dialog").then((m) => ({
            default: m.TaskCreateDialog,
          }))
        }
        projects={[]}
      />

      {reviewTaskId && (
        <AgentReviewFocusPanel
          taskId={reviewTaskId}
          open={!!reviewTaskId}
          onClose={() => setReviewTaskId(null)}
        />
      )}
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-3 p-3 lg:p-5">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-8 w-64 rounded-lg" />
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <ReviewPageContent />
    </Suspense>
  );
}
