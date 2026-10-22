"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  enqueue,
  getServerSnapshot,
  getSnapshot,
  newEntryId,
  remove,
  subscribe,
  update,
  type OutboxEntry,
} from "@/lib/journal/outbox";

/** How often entries that failed for a transient reason are tried again. */
const RETRY_INTERVAL_MS = 30_000;

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saves journal entries through the outbox (`src/lib/journal/outbox.ts`).
 *
 * `submit` puts the entry on the device first and then sends it; the entry
 * leaves the device only once the server has confirmed it. Failed sends are
 * retried on reconnect, every 30 seconds, and on the next visit, with the same
 * id each time, so a retry can never create a second copy.
 */
export function useJournalOutbox() {
  const queryClient = useQueryClient();
  const outbox = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const inFlight = useRef(new Set<string>());

  const send = useCallback(
    async (entry: Pick<OutboxEntry, "id" | "date" | "text">, notify: boolean) => {
      if (inFlight.current.has(entry.id)) return;
      inFlight.current.add(entry.id);
      update(entry.id, { status: "saving", error: undefined });

      try {
        const res = await fetch("/api/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: entry.text,
            date: entry.date,
            clientId: entry.id,
            timeZone: deviceTimeZone(),
          }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          // Show the saved entry at once rather than after a refetch, so it
          // never blinks out between leaving the outbox and arriving here.
          if (data?.entry) {
            queryClient.setQueryData(
              ["journal", "daily", entry.date],
              (old: { entries?: Array<{ id: string }> } | undefined) => {
                const entries = old?.entries ?? [];
                if (entries.some((e) => e.id === data.entry.id)) return old;
                return { ...(old ?? {}), entries: [...entries, data.entry] };
              }
            );
          }
          remove(entry.id);
          queryClient.invalidateQueries({ queryKey: ["journal"] });
          return;
        }

        const data = await res.json().catch(() => null);
        const permanent = res.status === 400 || res.status === 413;
        const error =
          res.status === 401
            ? "You're signed out. Sign in again and it will save."
            : data?.error || `Not saved (error ${res.status}). Retrying automatically.`;
        update(entry.id, { status: "failed", error, permanent });
        if (notify) toast.error(error);
      } catch {
        const error = "No connection. It's kept on this device and will save when you're back online.";
        update(entry.id, { status: "failed", error, permanent: false });
        if (notify) toast.error(error);
      } finally {
        inFlight.current.delete(entry.id);
      }
    },
    [queryClient]
  );

  const submit = useCallback(
    (text: string, date: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const entry = { id: newEntryId(), date, text: trimmed };
      enqueue(entry);
      void send(entry, true);
    },
    [send]
  );

  const retry = useCallback(
    (entry: OutboxEntry) => {
      void send(entry, true);
    },
    [send]
  );

  useEffect(() => {
    const retryAll = () => {
      for (const entry of getSnapshot()) {
        if (entry.status === "failed" && !entry.permanent) void send(entry, false);
      }
    };
    retryAll();
    window.addEventListener("online", retryAll);
    const timer = window.setInterval(retryAll, RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", retryAll);
      window.clearInterval(timer);
    };
  }, [send]);

  return { outbox, submit, retry };
}
