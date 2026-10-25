"use client";

/**
 * A project's whiteboard space: the project's own board, and one tab per
 * note in the project, each with a board of its own. A note outside any
 * project gets its board alone.
 *
 * The open tab is the URL (`?board=note:<id>`), so a link, the back button
 * and a reload all land on the same board.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileText, LayoutDashboard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { encodeBoardTarget, parseBoardTarget, type BoardScope } from "@/lib/whiteboards/types";
import type { WorkspaceTab } from "@/lib/whiteboards/store";
import { WhiteboardBoard } from "./whiteboard-board";

interface WorkspaceData {
  project: { id: string; name: string; slug: string };
  role: "owner" | "editor" | "viewer";
  tabs: WorkspaceTab[];
}

export interface WhiteboardWorkspaceProps {
  /** The project whose space this is; omit for a note outside any project. */
  projectId?: string | null;
  /** A note to open first (its id), when arriving from the note. */
  noteId?: string | null;
  /** Shown when there is no project: the note's title and where "back" goes. */
  standalone?: { title: string; backHref: string; noteId: string };
}

export function WhiteboardWorkspace({ projectId, noteId, standalone }: WhiteboardWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [fullscreen, setFullscreen] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["whiteboard-workspace", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<WorkspaceData> => {
      const res = await fetch(`/api/whiteboards/workspace?projectId=${encodeURIComponent(projectId!)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't load the whiteboard space");
      return json;
    },
  });

  // Which board is open: the URL, else the note we came from, else the project's.
  const active = useMemo((): { scope: BoardScope; id: string } | null => {
    const fromUrl = parseBoardTarget(searchParams.get("board"));
    if (fromUrl) return fromUrl;
    if (noteId) return { scope: "note", id: noteId };
    if (projectId) return { scope: "project", id: projectId };
    if (standalone) return { scope: "note", id: standalone.noteId };
    return null;
  }, [searchParams, noteId, projectId, standalone]);

  const openTab = useCallback(
    (scope: BoardScope, id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("board", encodeBoardTarget(scope, id));
      router.replace(`?${params}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Keep the open tab in view in a long strip.
  useEffect(() => {
    const el = tabsRef.current?.querySelector("[aria-selected=true]") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, data]);

  // Escape leaves full screen when nothing on the board wants it.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog], [role=menu]")) {
        const el = document.activeElement as HTMLElement | null;
        if (el?.tagName !== "TEXTAREA") setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const onOpenNoteBoard = useCallback(
    (id: string) => {
      const inProject = data?.tabs.some((t) => t.scope === "note" && t.target_id === id);
      if (inProject) {
        openTab("note", id);
        return;
      }
      router.push(`/notes/${id}/whiteboard`);
    },
    [data, openTab, router]
  );

  const newNoteBoard = async () => {
    if (!data) return;
    const title = window.prompt("Name the new note", "Untitled board")?.trim();
    if (!title) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, projectId: data.project.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.note?.id) {
      toast.error(json.error || "Couldn't create the note");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["whiteboard-workspace", projectId] });
    queryClient.invalidateQueries({ queryKey: ["notes"] });
    openTab("note", json.note.id);
  };

  const tabs = data?.tabs ?? [];
  const isActive = (t: WorkspaceTab) =>
    !!active && t.scope === active.scope && (t.target_id === active.id || (t.scope === "note" && t.slug === active.id));
  const activeTab = tabs.find(isActive);

  const backHref = standalone?.backHref ?? (data ? `/projects/${data.project.slug}` : "/projects");
  const heading = standalone?.title ?? data?.project.name ?? "";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-background",
        fullscreen
          ? "fixed inset-0 z-50"
          : "-mx-4 -mt-4 h-[calc(100dvh-3.5rem-var(--mobile-nav-height)-2.5rem)] rounded-none border-y md:-mx-6 md:-mt-5 md:h-[calc(100dvh-3.5rem-var(--mobile-nav-height)-2.75rem)] lg:-mx-8 lg:h-[calc(100dvh-3.5rem-2.75rem)] lg:rounded-xl lg:border"
      )}
    >
      {/* Header: back, name, and the tab strip */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-1.5">
        <Button variant="ghost" size="icon" asChild className="min-h-11 min-w-11 shrink-0 md:min-h-9 md:min-w-9">
          <Link href={backHref} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="hidden min-w-0 max-w-[14rem] shrink-0 md:block">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="text-xs text-muted-foreground">Whiteboard</p>
        </div>

        {projectId ? (
          <div ref={tabsRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Boards">
            {isLoading && <Skeleton className="h-9 w-64" />}
            {error && <span className="px-2 text-sm text-destructive">{(error as Error).message}</span>}
            {tabs.map((t) => {
              const on = isActive(t);
              return (
                <button
                  key={`${t.scope}:${t.target_id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => openTab(t.scope, t.target_id)}
                  title={t.scope === "project" ? "The project's own board" : t.board_id ? `${t.title}: ${t.item_count} items` : `${t.title}: no board yet`}
                  className={cn(
                    "inline-flex min-h-11 max-w-[14rem] shrink-0 items-center gap-1.5 rounded-md px-3 text-sm md:min-h-9",
                    on ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.scope === "project" ? (
                    <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <FileText className={cn("h-4 w-4 shrink-0", !t.board_id && "opacity-50")} aria-hidden />
                  )}
                  <span className="truncate">{t.scope === "project" ? "Project board" : t.title}</span>
                  {t.item_count > 0 && (
                    <span className="rounded bg-muted px-1 text-[11px] tabular-nums text-muted-foreground">{t.item_count}</span>
                  )}
                </button>
              );
            })}
            {data && data.role !== "viewer" && (
              <button
                type="button"
                onClick={newNoteBoard}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:min-h-9"
                title="New note with its own board"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Note board</span>
              </button>
            )}
          </div>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm font-semibold md:hidden">{heading}</p>
        )}

        {activeTab?.scope === "note" && (
          <Button variant="outline" size="sm" asChild className="hidden min-h-9 shrink-0 lg:inline-flex">
            <Link href={`/notes/${activeTab.slug ?? activeTab.target_id}`}>Open note</Link>
          </Button>
        )}
        {standalone && (
          <Button variant="outline" size="sm" asChild className="hidden min-h-9 shrink-0 sm:inline-flex">
            <Link href={standalone.backHref}>Open note</Link>
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {active ? (
          <WhiteboardBoard
            // A new board per tab: its own history, selection and camera.
            key={`${active.scope}:${active.id}`}
            scope={active.scope}
            targetId={active.id}
            onOpenNoteBoard={projectId ? onOpenNoteBoard : undefined}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((f) => !f)}
          />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
      </div>
    </div>
  );
}
