"use client";

import { useQuery } from "@tanstack/react-query";

/**
 * How many CRM items are waiting on a human decision — unresolved captures,
 * flagged duplicates, and follow-ups whose date has arrived.
 *
 * Shared by the sidebar and the mobile "More" sheet for the same reason
 * `useReviewCount` is: two surfaces advertising the same queue with different
 * numbers is worse than neither of them showing a badge.
 */
export function useCrmAttentionCount(): number {
  const { data } = useQuery({
    queryKey: ["crm-pulse", "attention"],
    queryFn: async () => {
      const res = await fetch("/api/crm/pulse");
      if (!res.ok) return { needsReview: 0, followUpsDue: 0 };
      return res.json() as Promise<{ needsReview: number; followUpsDue: number }>;
    },
    refetchInterval: 300000,
    staleTime: 120000,
  });

  return (data?.needsReview ?? 0) + (data?.followUpsDue ?? 0);
}
