"use client";

/**
 * System Health Indicator — the red exclamation in the header.
 *
 * Deliberately invisible when everything is fine: the header only grows an icon
 * when background work is actually broken. It sits next to the notification bell
 * because it answers the same question ("what needs my attention?") for the half
 * of the app the user can't otherwise see.
 *
 * The count reflects unresolved problems right now, not a read/unread state —
 * fix the cause and the icon disappears on the next poll.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { SystemHealth } from "@/lib/system-health/types";
import { SystemHealthPanel } from "./system-health-panel";
import {
  DISMISSED_STORAGE_KEY,
  readDismissed,
  isDismissed,
  type DismissalMap,
} from "./dismissals";

/** How often the header re-checks. Cheap query, but not worth hammering. */
const POLL_INTERVAL = 60 * 1000;

export function SystemHealthIndicator() {
  const [isOpen, setIsOpen] = useState(false);
  // Initialized lazily rather than in an effect: `readDismissed` is a no-op on
  // the server, and the first render can't depend on it anyway — the query has
  // no data yet, so the component renders null on both sides regardless.
  const [dismissed, setDismissed] = useState<DismissalMap>(readDismissed);

  // Keep in step when another tab dismisses something.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === DISMISSED_STORAGE_KEY) setDismissed(readDismissed());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { data } = useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/system-health");
      if (!res.ok) throw new Error("Failed to fetch system health");
      return res.json() as Promise<SystemHealth>;
    },
    refetchInterval: POLL_INTERVAL,
    staleTime: 30000,
    // A health check that itself fails shouldn't spam retries.
    retry: 1,
  });

  const visibleIssues = useMemo(
    () => (data?.issues || []).filter((issue) => !isDismissed(issue, dismissed)),
    [data, dismissed]
  );

  // Nothing to say — render nothing at all.
  if (visibleIssues.length === 0) return null;

  const hasErrors = visibleIssues.some((i) => i.diagnosis.severity === "error");

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
          "hover:bg-muted",
          hasErrors ? "text-red-500" : "text-amber-500"
        )}
        title={data?.summary || "Background work needs attention"}
        aria-label={`${visibleIssues.length} background system issue${
          visibleIssues.length === 1 ? "" : "s"
        }`}
      >
        <AlertTriangle className="h-[18px] w-[18px]" />
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1",
            "text-[10px] font-bold text-white rounded-full leading-none",
            hasErrors ? "bg-red-500" : "bg-amber-500"
          )}
        >
          {visibleIssues.length > 9 ? "9+" : visibleIssues.length}
        </span>
        {hasErrors && (
          <span className="absolute inset-0 rounded-lg animate-ping bg-red-500/10 pointer-events-none" />
        )}
      </button>

      <SystemHealthPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        health={data}
        visibleIssues={visibleIssues}
        onDismissedChange={setDismissed}
      />
    </>
  );
}
