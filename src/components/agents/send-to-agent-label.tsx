"use client";

import { useAgentRuntime } from "@/hooks/use-agent-runtime";

/** "Send to <display name>", from `AGENT_DISPLAY_NAME` on the server. */
export function SendToAgentLabel() {
  const { displayName } = useAgentRuntime();
  return <>Send to {displayName}</>;
}
