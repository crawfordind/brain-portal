"use client";

/**
 * "Ask about this" — the single entry point for getting AI help on one item.
 *
 * This replaces the delegate dialogs. Those opened a form (agent roster,
 * auto-router readout, prefilled instruction blob, priority, output format),
 * posted to a queue, and returned nothing until a cron worker had run and the
 * user went looking in the review screen. This pins the chat to the item and
 * opens it, so the answer streams back immediately and the follow-up is just
 * the next message.
 */

import { useCallback } from "react";
import { useChatStore } from "@/lib/stores/chat-store";
import { CHAT_ITEM_TYPES, type ChatItemType } from "@/lib/chat/item-types";

/**
 * Stream item types that are not themselves chat item types.
 *
 * The stream labels captures by what they look like — a link is a
 * `reference`, an open question is a `question` — but they are all rows in
 * `captures`, so they resolve as captures.
 */
const STREAM_TYPE_ALIASES: Record<string, ChatItemType> = {
  question: "capture",
  decision: "capture",
  reference: "capture",
  agent_output: "note",
};

/**
 * Map any stream / entity type onto a type the chat can resolve.
 * Returns null for anything unrecognised, so callers can hide the action
 * rather than open a chat that has nothing to talk about.
 */
export function toChatItemType(type: string | null | undefined): ChatItemType | null {
  if (!type) return null;
  if ((CHAT_ITEM_TYPES as readonly string[]).includes(type)) return type as ChatItemType;
  return STREAM_TYPE_ALIASES[type] ?? null;
}

export interface AskAboutTarget {
  id: string;
  type: string;
  /** Falls back to the content's first line when there is no title. */
  title?: string | null;
  content?: string | null;
}

export function useAskAbout() {
  const askAboutItem = useChatStore((s) => s.askAboutItem);

  const askAbout = useCallback(
    (target: AskAboutTarget) => {
      const type = toChatItemType(target.type);
      if (!type) return;

      askAboutItem({
        type,
        id: target.id,
        title: displayTitle(target),
      });
    },
    [askAboutItem]
  );

  return { askAbout, canAskAbout: (type: string | null | undefined) => toChatItemType(type) !== null };
}

function displayTitle(target: AskAboutTarget): string {
  const explicit = target.title?.trim();
  if (explicit) return truncate(explicit);

  const firstLine =
    (target.content || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) || "";

  return truncate(firstLine) || "Untitled";
}

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
