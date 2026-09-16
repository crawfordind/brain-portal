"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * Number of agent outputs sitting in `awaiting_review`.
 *
 * Shared by every surface that advertises the Review queue (sidebar, mobile
 * "More" sheet, the Work command bar) so they can never disagree about how
 * much is waiting — a badge that says 3 in one place and 0 in another is worse
 * than no badge at all.
 */
export function useReviewCount() {
  const { data } = useQuery({
    queryKey: ["agent-tasks-count", "awaiting_review"],
    queryFn: async () => {
      const res = await fetch("/api/agent-tasks?status=awaiting_review&countOnly=true");
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  return data?.count ?? 0;
}
