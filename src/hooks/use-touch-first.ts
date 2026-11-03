"use client";

import { useSyncExternalStore } from "react";

/**
 * True on a screen driven by a finger (phones, tablets): `(pointer: coarse)`.
 *
 * Swipe actions are the primary way to act on a row there, so rows can drop
 * the inline buttons a mouse user still gets. `false` on the server and on the
 * first client render, so the server-rendered markup is the desktop one and
 * nothing is hidden before JavaScript runs.
 */
const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

export function useTouchFirst(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED).matches,
    () => false
  );
}
