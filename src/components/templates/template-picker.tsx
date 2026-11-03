"use client";

/**
 * Choose a template for a new note. The project's own templates come first,
 * then the most used. Picking one hands it to the caller; nothing is written.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileStack, FolderOpen, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useTemplates } from "@/hooks/use-templates";
import type { NoteTemplate } from "@/lib/templates/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  onPick: (template: NoteTemplate) => void;
}

export function TemplatePicker({ open, onOpenChange, projectId, onPick }: Props) {
  const { data, isLoading } = useTemplates(projectId);
  const [search, setSearch] = useState("");
  const templates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = data?.templates ?? [];
    return q ? all.filter((t) => `${t.name} ${t.description} ${t.project_name ?? ""}`.toLowerCase().includes(q)) : all;
  }, [data, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact" className="max-h-[100dvh] overflow-y-auto sm:max-h-[85dvh]">
        <DialogHeader>
          <DialogTitle>Start from a template</DialogTitle>
          <DialogDescription>Fills in the title and body. You can change anything after.</DialogDescription>
        </DialogHeader>

        {(data?.templates.length ?? 0) > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="min-h-11 pl-9 text-base md:min-h-9 md:text-sm" />
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : data?.notMigrated ? (
          <p className="text-sm text-muted-foreground">
            Templates aren&apos;t set up on this server yet. The operator needs to run <code>npm run db:migrate</code>.
          </p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {search ? "No template matches." : "No templates yet."}{" "}
            <Link href={projectId ? `/templates?projectId=${projectId}` : "/templates"} className="font-medium text-primary underline-offset-4 hover:underline">
              Make one
            </Link>
            , or let AI suggest one from notes you already wrote.
          </p>
        ) : (
          <ul className="space-y-1" role="list">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="flex min-h-11 w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.name}</span>
                    {t.description && <span className="block truncate text-sm text-muted-foreground">{t.description}</span>}
                    {t.project_name && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderOpen className="h-3 w-3" aria-hidden />
                        {t.project_name}
                        {projectId && t.project_id === projectId ? " · this project" : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Link href={projectId ? `/templates?projectId=${projectId}` : "/templates"} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Manage templates
        </Link>
      </DialogContent>
    </Dialog>
  );
}
