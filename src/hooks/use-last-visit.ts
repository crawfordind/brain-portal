"use client";

/**
 * When the viewer last opened the stream — the anchor for the
 * "since you were last here" divider.
 *
 * `users` has no `last_seen_at` column and this feature does not justify a
 * migration, but the device-local answer is arguably the better one anyway:
 * the question a returning user asks is "what has changed since *I* last
 * looked", and they looked on this device.
 *
 * The value is read **once per page load and immediately overwritten** with the
 * current time. That ordering matters: if it were re-read while the page is
 * open, the divider would creep upward as the clock passed each row, and the
 * boundary the user came back to would dissolve under them. It holds still for
 * the whole session and moves on the next visit.
 */

import { useSyncExternalStore } from "react";

const LAST_VISIT_KEY = "bp.stream.lastVisit";

/**
 * `undefined` means "not read yet"; `null` means "read, and there was no
 * previous visit". The distinction is what keeps this to a single read.
 */
let snapshot: string | null | undefined = undefined;

function getSnapshot(): string | null {
  if (snapshot === undefined) {
    try {
      snapshot = window.localStorage.getItem(LAST_VISIT_KEY);
      window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    } catch {
      snapshot = null;
    }
  }
  return snapshot;
}

function getServerSnapshot(): string | null {
  // The server cannot know, and must not guess: a fabricated boundary would
  // render a divider that then jumped on hydration.
  return null;
}

/** Nothing mutates this after the first read, so there is nothing to notify. */
function subscribe(): () => void {
  return () => {};
}

/** The previous visit as a Date, or null on a first visit. */
export function useLastVisit(): Date | null {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!stored) return null;

  const parsed = new Date(stored);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
