"use client";

/**
 * "Send to Jack": hand an item to Jack as a delegated task.
 *
 * The companion to "Ask about this" (`useAskAbout`). Asking is a quick
 * conversation answered in the chat; sending is work Jack does with its tools,
 * memory and skills, tracked in Review with its status, approvals and versions.
 */

import { useCallback } from "react";
import { useJackDialogStore, type JackTarget } from "@/lib/stores/jack-store";

/**
 * Stream and entity types Jack can take, mapped to the source type the server
 * resolves. The server re-checks the id and settles ambiguous ones (a stream
 * "task" may be a capture) against the tables themselves.
 */
const JACK_SOURCE_TYPES: Record<string, string> = {
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

export function toJackSourceType(type: string | null | undefined): string | null {
  return type ? JACK_SOURCE_TYPES[type] ?? null : null;
}

export function useSendToJack() {
  const open = useJackDialogStore((s) => s.open);

  const sendToJack = useCallback(
    (target: { id: string; type: string; title?: string | null; content?: string | null; projectId?: string | null }) => {
      const sourceType = toJackSourceType(target.type);
      if (!sourceType) return;
      const title =
        target.title?.trim() ||
        target.content?.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ||
        "Task for Jack";
      const payload: JackTarget = { sourceType, sourceId: target.id, title, projectId: target.projectId ?? null };
      open(payload);
    },
    [open]
  );

  return { sendToJack };
}
