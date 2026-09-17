"use client";

/**
 * The viewer's row density, remembered per device.
 *
 * Deliberately `localStorage` rather than `users.preferences`. Density is a
 * property of the *screen*, not of the person: the same user wants compact rows
 * on a 27" monitor and cozy ones on a phone, and syncing the choice across
 * devices would make each device fight the other. Every other preference in
 * this app that describes the account (models, notification settings) does live
 * server-side.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`, because reading
 * storage in an effect means a setState during mount — a cascading render the
 * lint rule correctly objects to — and because it gets cross-tab sync for free.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  DENSITY_STORAGE_KEY,
  SERVER_DEFAULT_DENSITY,
  defaultDensity,
  parseDensity,
  type StreamDensity,
} from "@/lib/stream/density";

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing the preference should move this one too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readDensity(): StreamDensity {
  const stored = parseDensity(window.localStorage.getItem(DENSITY_STORAGE_KEY));
  if (stored) return stored;

  // No stored choice: pick by input device. `pointer: coarse` is the honest
  // test for "this is a finger", where `cozy`'s preview line earns its height.
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  return defaultDensity(coarse);
}

/**
 * The snapshot must be referentially stable between renders or
 * `useSyncExternalStore` loops. Densities are strings, so caching the last read
 * and only replacing it when storage actually changes is enough.
 */
let snapshot: StreamDensity | null = null;

function getSnapshot(): StreamDensity {
  if (snapshot === null) snapshot = readDensity();
  return snapshot;
}

function getServerSnapshot(): StreamDensity {
  return SERVER_DEFAULT_DENSITY;
}

export function useStreamDensity(): [StreamDensity, (next: StreamDensity) => void] {
  const density = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const setDensity = useCallback((next: StreamDensity) => {
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Private browsing, or storage full. The choice still applies for this
      // session; it simply will not survive a reload.
    }
    snapshot = next;
    emit();
  }, []);

  return [density, setDensity];
}
