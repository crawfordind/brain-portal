"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicRuntimeStatus } from "@/lib/agents/runtime/config";

/** What the UI assumes until the server answers: a generic name, no extras. */
const FALLBACK: PublicRuntimeStatus = {
  state: "disabled",
  runtime: null,
  displayName: "Agent",
  message: "",
  capabilities: { approvals: false, stop: false, liveStatus: false, connectionTest: false },
};

/**
 * Which runtime runs delegated tasks, its display name (`AGENT_DISPLAY_NAME`)
 * and what it can do. Every "Send to …" label, the review panel's approval
 * and stop controls, and the model picker read this, so an instance never
 * shows a control its runtime cannot honour or a name it was not given.
 *
 * Words and booleans only: the server never sends a URL or a key here.
 */
export function useAgentRuntime(): PublicRuntimeStatus & { loaded: boolean } {
  const { data } = useQuery({
    queryKey: ["agent-runtime-status"],
    queryFn: async () => {
      const res = await fetch("/api/agent-runtime/status");
      if (!res.ok) return null;
      return res.json() as Promise<PublicRuntimeStatus>;
    },
    staleTime: 5 * 60_000,
  });
  return { ...(data ?? FALLBACK), loaded: !!data };
}
