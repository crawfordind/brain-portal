"use client";

import { useEffect, useRef } from "react";
import { usePathname, useParams } from "next/navigation";
import { useChatStore, ChatContextType } from "@/lib/stores/chat-store";
import { CONTEXT_LABELS } from "@/lib/chat/prompts";

/**
 * Keeps the chat's context in step with the route.
 *
 * The applied route is tracked in a ref rather than compared against the
 * store's current context, because the chat can be deliberately pinned to a
 * single item ("Ask about this") while the route is unchanged. Comparing
 * against the live context would treat that pin as drift and undo it on the
 * next render — and `useParams()` does not guarantee a stable object identity,
 * so this effect can re-run without the route having changed at all.
 */
export function useChatContext() {
  const pathname = usePathname();
  const params = useParams();
  const setContext = useChatStore((s) => s.setContext);
  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    let type: ChatContextType = "general";
    let id: string | null = null;

    if (pathname === "/") {
      type = "executive";
    } else if (pathname === "/projects") {
      type = "project";
      // No specific project — context resolver will return all-projects summary
    } else if (pathname.startsWith("/projects/") && params?.slug) {
      type = "project";
      id = params.slug as string;
    } else if (pathname.startsWith("/notes/") && params?.slug) {
      type = "note";
      id = params.slug as string;
    } else if (pathname === "/tasks" || pathname.startsWith("/tasks")) {
      type = "task";
    }

    const key = `${type}:${id ?? ""}`;
    if (lastApplied.current === key) return;
    lastApplied.current = key;

    setContext(type, id, CONTEXT_LABELS[type] || "General");
  }, [pathname, params, setContext]);
}
