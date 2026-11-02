"use client";

/**
 * Map or list: how the dashboard shows the stream, remembered per device.
 *
 * The Mind map is the default. The list is kept, one tap away, for anyone who
 * prefers reading rows, for screens without WebGL, and for the times the user
 * wants everything in time order. `localStorage` for the same reason as row
 * density: it is a property of the screen, not of the account.
 */

import { useCallback, useSyncExternalStore } from "react";

export type StreamView = "map" | "list";

export const STREAM_VIEW_STORAGE_KEY = "bp.stream.view";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function parseStreamView(raw: string | null | undefined): StreamView {
  return raw === "list" ? "list" : "map";
}

function getSnapshot(): StreamView {
  try {
    return parseStreamView(window.localStorage.getItem(STREAM_VIEW_STORAGE_KEY));
  } catch {
    return "map";
  }
}

function getServerSnapshot(): StreamView {
  return "map";
}

export function useStreamView(): [StreamView, (next: StreamView) => void] {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setView = useCallback((next: StreamView) => {
    try {
      window.localStorage.setItem(STREAM_VIEW_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice holds until the next reload.
    }
    for (const listener of listeners) listener();
  }, []);

  return [view, setView];
}

/** `prefers-reduced-motion`, live. */
const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => typeof window.matchMedia === "function" && window.matchMedia(motionQuery).matches,
    () => false
  );
}
