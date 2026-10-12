"use client";

/**
 * "Send to agent": hand an item to the configured runtime as a delegated task.
 *
 * The companion to "Ask about this" (`useAskAbout`). Asking is a quick
 * conversation answered in the chat; sending is background work, tracked in
 * Review with its status, any approvals and every version.
 */

import { useCallback } from "react";
import { useAgentDialogStore, type AgentTarget } from "@/lib/stores/agent-dialog-store";

/**
 * Stream and entity types that can be delegated, mapped to the source type the server
 * resolves. The server re-checks the id and settles ambiguous ones (a stream
 * "task" may be a capture) against the tables themselves.
 */
const AGENT_SOURCE_TYPES: Record<string, string> = {
  task: "task",
  note: "note",
  journal: "note",
  capture: "capture",
  thought: "capture",
  idea: "capture",
  question: "capture",
  decision: "capture",
  reference: "capture",
  reminder: "reminder",
  insight: "insight",
  project: "project",
  contact: "contact",
};

export function toAgentSourceType(type: string | null | undefined): string | null {
  return type ? AGENT_SOURCE_TYPES[type] ?? null : null;
}

export function useSendToAgent() {
  const open = useAgentDialogStore((s) => s.open);

  const sendToAgent = useCallback(
    (target: { id: string; type: string; title?: string | null; content?: string | null; projectId?: string | null }) => {
      const sourceType = toAgentSourceType(target.type);
      if (!sourceType) return;
      const title =
        target.title?.trim() ||
        target.content?.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ||
        "Delegated task";
      const payload: AgentTarget = { sourceType, sourceId: target.id, title, projectId: target.projectId ?? null };
      open(payload);
    },
    [open]
  );

  return { sendToAgent };
}
