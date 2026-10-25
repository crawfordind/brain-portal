"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WhiteboardWorkspace } from "@/components/whiteboard/whiteboard-workspace";

/**
 * `/notes/<slug>/whiteboard`: the note's own board. A note in a project opens
 * inside the project's whiteboard space, on its own tab, so its neighbours'
 * boards are one tap away.
 */
export default function NoteWhiteboardPage() {
  const params = useParams();
  const slug = params.slug as string;

  const { data, isLoading, error } = useQuery({
    queryKey: ["note", slug],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Note not found" : "Couldn't load the note");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-[70dvh] w-full" />;
  const note = data?.note as { id: string; slug: string; title: string; project_id: string | null } | undefined;
  if (error || !note) {
    return (
      <div className="py-12 text-center">
        <p className="mb-4 text-muted-foreground">{(error as Error)?.message ?? "Note not found"}</p>
        <Button asChild>
          <Link href="/notes">Back to Notes</Link>
        </Button>
      </div>
    );
  }

  // Only a project the viewer can open gets the tabs; a note shared on its
  // own (account share) stands alone even if it sits in someone's project.
  const projectId = data?.access?.via === "share" ? null : note.project_id;

  return (
    <Suspense fallback={<Skeleton className="h-[70dvh] w-full" />}>
      {projectId ? (
        <WhiteboardWorkspace projectId={projectId} noteId={note.id} />
      ) : (
        <WhiteboardWorkspace standalone={{ title: note.title || "Untitled", backHref: `/notes/${note.slug}`, noteId: note.id }} />
      )}
    </Suspense>
  );
}
