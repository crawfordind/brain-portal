"use client";

/**
 * Whether the note editor asks the browser to spell-check, remembered per
 * device.
 *
 * `localStorage`, like stream density: spell checking depends on the device's
 * own dictionary and keyboard (a phone already autocorrects), so it is a
 * property of the screen rather than of the account. Read through
 * `useSyncExternalStore` so no effect has to copy it into state.
 */

import { useCallback, useSyncExternalStore } from "react";

export const SPELLCHECK_STORAGE_KEY = "bp.editor.spellcheck";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  try {
    // On unless the user turned it off: that is the browser's own default.
    return window.localStorage.getItem(SPELLCHECK_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const getServerSnapshot = () => true;

export function useEditorSpellcheck(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setEnabled = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Storage unavailable: nothing to remember it in, and nothing changes.
    }
    for (const listener of listeners) listener();
  }, []);

  return [enabled, setEnabled];
}
