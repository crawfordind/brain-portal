"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WhiteboardWorkspace } from "@/components/whiteboard/whiteboard-workspace";

/** `/projects/<slug>/whiteboard`: the project's board, with a tab per note. */
export default function ProjectWhiteboardPage() {
  const params = useParams();
  const slug = params.slug as string;

  // Same key as the project page, so arriving from it costs no request.
  const { data, isLoading, error } = useQuery({
    queryKey: ["project", slug],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Project not found" : "Couldn't load the project");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-[70dvh] w-full" />;
  if (error || !data?.project) {
    return (
      <div className="py-12 text-center">
        <p className="mb-4 text-muted-foreground">{(error as Error)?.message ?? "Project not found"}</p>
        <Button asChild>
          <Link href="/projects">Back to Projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <Suspense fallback={<Skeleton className="h-[70dvh] w-full" />}>
      <WhiteboardWorkspace projectId={data.project.id} />
    </Suspense>
  );
}
