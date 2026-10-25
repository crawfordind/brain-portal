"use client";

/**
 * Pick notes and tasks to place on the board as live cards.
 *
 * Defaults to the board's project, since a project board is where its notes
 * and tasks get laid out; "Everything" widens it to the whole account.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, FileText, ListTodo, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CardRef, CardRefType } from "@/lib/whiteboards/types";

interface PickerRow {
  type: CardRefType;
  id: string;
  title: string;
  slug: string | null;
  status: string | null;
  due_date: string | null;
}

export function CardPicker({
  open,
  onOpenChange,
  projectId,
  onPick,
  excluded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onPick: (refs: CardRef[]) => void;
  /** `type:id` already on the board, shown as such. */
  excluded: Set<string>;
}) {
  const [type, setType] = useState<CardRefType>("note");
  const [scope, setScope] = useState<"project" | "all">(projectId ? "project" : "all");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Map<string, PickerRow>>(new Map());
  const inProject = scope === "project" && !!projectId;

  const { data, isLoading } = useQuery({
    queryKey: ["whiteboard-picker", type, inProject ? projectId : "all", search],
    enabled: open,
    queryFn: async (): Promise<PickerRow[]> => {
      const params = new URLSearchParams({ limit: "100" });
      if (inProject && projectId) params.set("projectId", projectId);
      if (type === "note") {
        if (search.trim()) params.set("search", search.trim());
        const res = await fetch(`/api/notes?${params}`);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.notes ?? []).map((n: { id: string; title: string; slug: string }) => ({
          type: "note" as const,
          id: n.id,
          title: n.title || "Untitled",
          slug: n.slug,
          status: null,
          due_date: null,
        }));
      }
      const res = await fetch(`/api/tasks?${params}`);
      if (!res.ok) return [];
      const json = await res.json();
      const q = search.trim().toLowerCase();
      return (json.tasks ?? [])
        .map((t: { id: string; title: string | null; content: string; status: string; due_date: string | null }) => ({
          type: "task" as const,
          id: t.id,
          title: t.title || t.content || "Untitled task",
          slug: null,
          status: t.status,
          due_date: t.due_date,
        }))
        .filter((t: PickerRow) => !q || t.title.toLowerCase().includes(q));
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  const toggle = (row: PickerRow) => {
    setPicked((prev) => {
      const next = new Map(prev);
      const key = `${row.type}:${row.id}`;
      if (next.has(key)) next.delete(key);
      else next.set(key, row);
      return next;
    });
  };

  const addAll = () => {
    onPick([...picked.values()].map((r) => ({ ...r, has_board: false })));
    setPicked(new Map());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add notes and tasks</DialogTitle>
          <DialogDescription>
            Cards stay linked: a renamed note or a finished task shows up on the board.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="What to add">
            {(["note", "task"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={type === t}
                onClick={() => setType(t)}
                className={cn(
                  "inline-flex min-h-11 md:min-h-9 items-center gap-1.5 rounded px-3 text-sm",
                  type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "note" ? <FileText className="h-4 w-4" /> : <ListTodo className="h-4 w-4" />}
                {t === "note" ? "Notes" : "Tasks"}
              </button>
            ))}
          </div>
          {projectId && (
            <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Where from">
              {(["project", "all"] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={cn(
                    "min-h-11 md:min-h-9 rounded px-3 text-sm",
                    scope === s ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s === "project" ? "This project" : "Everything"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={type === "note" ? "Search notes…" : "Filter tasks…"}
            className="pl-9 min-h-11 md:min-h-9"
            aria-label="Search"
          />
        </div>

        <ul className="max-h-[45dvh] space-y-1 overflow-y-auto" aria-label="Results">
          {isLoading && <li className="p-3 text-sm text-muted-foreground">Loading…</li>}
          {!isLoading && rows.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              Nothing here{inProject ? " in this project yet. Try Everything." : "."}
            </li>
          )}
          {rows.map((row) => {
            const key = `${row.type}:${row.id}`;
            const on = picked.has(key);
            const already = excluded.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  aria-pressed={on}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted",
                    on && "bg-primary/10"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                    )}
                    aria-hidden
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.type === "task" && row.status && (
                    <span className="shrink-0 text-xs text-muted-foreground">{row.status.replace("_", " ")}</span>
                  )}
                  {already && <span className="shrink-0 text-xs text-muted-foreground">on board</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-9">
            Cancel
          </Button>
          <Button onClick={addAll} disabled={!picked.size} className="min-h-11 md:min-h-9">
            Add {picked.size || ""} card{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
