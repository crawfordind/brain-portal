"use client";

/**
 * Immersive mode for the home screen: the app's top bar slides up out of the
 * way and the brain has the whole screen. On by default, remembered per
 * device (`localStorage`), like stream density: it is a property of the
 * screen, not of the account. Read by the layout (which hides the header) and
 * by the Mind view (which offers the toggle and moves its overlay up).
 */

import { useCallback, useSyncExternalStore } from "react";

export const IMMERSIVE_STORAGE_KEY = "bp.home.immersive";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Anything but an explicit "off" is on. */
export function parseImmersive(raw: string | null | undefined): boolean {
  return raw !== "off";
}

function getSnapshot(): boolean {
  try {
    return parseImmersive(window.localStorage.getItem(IMMERSIVE_STORAGE_KEY));
  } catch {
    return true;
  }
}

const getServerSnapshot = () => true;

export function useImmersive(): [boolean, (next: boolean) => void] {
  const immersive = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setImmersive = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(IMMERSIVE_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Storage unavailable: the choice holds until the next reload.
    }
    for (const listener of listeners) listener();
  }, []);

  return [immersive, setImmersive];
}
