"use client";

/**
 * `/whiteboards`: every board this account can open, newest activity first,
 * and a one-tap start for any project that has none yet. Boards live with
 * their project or note; this page is only the way back to them.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FileText, LayoutDashboard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/use-projects";
import { parseDbTimestamp } from "@/lib/stream/grouping";
import type { BoardSummary } from "@/lib/whiteboards/store";

function href(b: BoardSummary): string {
  if (b.scope === "note") return `/notes/${b.note_slug ?? b.note_id}/whiteboard`;
  return `/projects/${b.project_slug ?? b.project_id}/whiteboard`;
}

export default function WhiteboardsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["whiteboards"],
    queryFn: async (): Promise<{ boards: BoardSummary[]; notMigrated?: boolean }> => {
      const res = await fetch("/api/whiteboards");
      if (!res.ok) return { boards: [] };
      return res.json();
    },
  });
  const { data: projects } = useProjects();
  const boards = data?.boards ?? [];
  const withBoard = new Set(boards.filter((b) => b.scope === "project").map((b) => b.project_id));
  const startable = (projects ?? []).filter((p) => !withBoard.has(p.id)).slice(0, 12);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">Whiteboards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every project has a board, and so does every note. A project&apos;s notes sit as tabs in its board space.
        </p>
      </div>

      {data?.notMigrated && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Whiteboards aren&apos;t set up on this server yet. The operator needs to run <code>npm run db:migrate</code>.
        </p>
      )}

      <section aria-labelledby="recent-boards">
        <h2 id="recent-boards" className="mb-3 text-sm font-semibold text-muted-foreground">Recent boards</h2>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : boards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No boards yet. Start one from a project below, or from any note.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {boards.map((b) => {
              const at = parseDbTimestamp(b.updated_at);
              return (
                <li key={b.id}>
                  <Link
                    href={href(b)}
                    className="flex min-h-14 items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    {b.scope === "project" ? (
                      <LayoutDashboard className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {b.scope === "project" ? "Project board" : b.project_name ? `Note in ${b.project_name}` : "Note board"}
                        {" · "}
                        {b.item_count} item{b.item_count === 1 ? "" : "s"}
                        {at ? ` · ${formatDistanceToNow(at, { addSuffix: true })}` : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {startable.length > 0 && (
        <section aria-labelledby="start-board">
          <h2 id="start-board" className="mb-3 text-sm font-semibold text-muted-foreground">Start a project board</h2>
          <ul className="flex flex-wrap gap-2">
            {startable.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.slug}/whiteboard`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm hover:bg-muted md:min-h-9"
                >
                  <LayoutDashboard className="h-4 w-4" aria-hidden />
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
