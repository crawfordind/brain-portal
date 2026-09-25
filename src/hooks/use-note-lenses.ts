"use client";

import { useDeferredValue, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { senseNote } from "@/lib/lenses/sense";
import { chooseLenses, mergeSignals } from "@/lib/lenses/choose";
import { contentFingerprint } from "@/lib/lenses/fingerprint";
import type { DeepRead, Lens } from "@/lib/lenses/types";

const pad2 = (n: number) => String(n).padStart(2, "0");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Enough words that a model read could find something rules did not. */
const MIN_WORDS_FOR_DEEP_READ = 30;

/**
 * The lenses for a note body, following it as it is typed.
 *
 * Rule-based lenses are computed in the browser from the live body (deferred,
 * so typing never waits on sensing). A "read deeper" result is fetched once
 * from the cache for this note and merged in; `isStale` says when the body has
 * moved on since that read was taken.
 */
export function useNoteLenses(args: {
  noteId: string | undefined;
  content: string;
  /** What relative dates in the note are relative to (usually its creation). */
  referenceDate?: Date;
  canReadDeeper: boolean;
}) {
  const { noteId, content, referenceDate, canReadDeeper } = args;
  const queryClient = useQueryClient();
  const deferred = useDeferredValue(content);
  const refTime = referenceDate?.getTime();

  const local = useMemo(
    () => senseNote(deferred, { referenceDate: refTime ? new Date(refTime) : undefined }),
    [deferred, refTime]
  );
  const fingerprint = useMemo(() => contentFingerprint(deferred), [deferred]);

  const queryKey = ["note-lenses", noteId];
  const { data: deepRead } = useQuery({
    queryKey,
    queryFn: async (): Promise<DeepRead | null> => {
      const res = await fetch(`/api/notes/${noteId}/lenses?fingerprint=${encodeURIComponent(fingerprint)}`);
      if (!res.ok) return null;
      return ((await res.json()) as { deepRead: DeepRead | null }).deepRead;
    },
    // Asked once per visit: the cache lookup is keyed by the body at open time,
    // and a fresh read is always an explicit tap, never a side effect of typing.
    enabled: !!noteId && canReadDeeper && deferred.length > 0,
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<DeepRead> => {
      const res = await fetch(`/api/notes/${noteId}/lenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, today: localToday() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't read this note");
      return json.deepRead as DeepRead;
    },
    onSuccess: (read) => queryClient.setQueryData(queryKey, read),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't read this note"),
  });

  const today = localToday();
  const lenses: Lens[] = useMemo(
    () => chooseLenses(mergeSignals(local, deepRead?.signals), { today }),
    [local, deepRead, today]
  );

  const words = useMemo(
    () => deferred.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length,
    [deferred]
  );

  return {
    lenses,
    deepRead: deepRead ?? null,
    isStale: !!deepRead && deepRead.fingerprint !== fingerprint,
    canReadDeeper: canReadDeeper && words >= MIN_WORDS_FOR_DEEP_READ,
    readDeeper: () => mutation.mutate(),
    isReading: mutation.isPending,
  };
}
