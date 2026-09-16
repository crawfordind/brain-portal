"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkPage } from "@/components/work/work-page";

function WorkPageSkeleton() {
  return (
    <div className="p-3 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-32 rounded-lg" />
      <div className="space-y-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<WorkPageSkeleton />}>
      <WorkPage />
    </Suspense>
  );
}
