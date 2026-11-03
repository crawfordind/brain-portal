"use client";

/**
 * `/templates`: the account's note templates, and three ways to get one
 * without typing it out:
 *
 *   - Recurring notes: the rules find notes written repeatedly under one
 *     title (`series.ts`) and say why; the person drafts a template from
 *     them with AI, or from their shared headings with no AI at all.
 *   - Pick notes: choose a handful of notes in a project yourself.
 *   - Describe it: "weekly operations meeting" → a drafted template.
 *
 * Every draft opens in the editor first. Nothing is saved until Save.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FilePlus2,
  FileStack,
  FolderOpen,
  ListChecks,
  Loader2,
  Pencil,
  Repeat,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { TemplateEditorDialog, type TemplateEditorValue } from "@/components/templates/template-editor-dialog";
import { useProjects } from "@/hooks/use-projects";
import {
  requestDraft,
  templateFetch,
  useTemplates,
  useTemplateSuggestions,
  type DraftRequest,
  type DraftWithProject,
} from "@/hooks/use-templates";
import type { NoteTemplate, SeriesSuggestion } from "@/lib/templates/types";

const CADENCE: Record<SeriesSuggestion["cadence"], string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  irregular: "Recurring",
};

const EMPTY: TemplateEditorValue = { name: "", description: "", title_pattern: "", content: "", project_id: null };

function draftToValue(d: DraftWithProject): TemplateEditorValue {
  return {
    name: d.name,
    description: d.description,
    title_pattern: d.title_pattern,
    content: d.content,
    project_id: d.project_id,
    source: d.source,
    source_note_ids: d.source_note_ids,
    rationale: d.rationale,
  };
}

function TemplatesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: projects } = useProjects();

  const projectId = searchParams.get("projectId") || null;
  const setProjectId = (id: string | null) => {
    router.replace(id ? `/templates?projectId=${id}` : "/templates", { scroll: false });
  };
  const project = (projects ?? []).find((p) => p.id === projectId) ?? null;

  const { data, isLoading } = useTemplates(projectId);
  const suggestions = useTemplateSuggestions(projectId, !data?.notMigrated);

  const [editor, setEditor] = useState<{ value: TemplateEditorValue; id: string | null } | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [describeOpen, setDescribeOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  const draft = async (request: DraftRequest, busyKey: string) => {
    setDrafting(busyKey);
    try {
      const { draft } = await requestDraft(request);
      setEditor({ value: draftToValue(draft), id: null });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't draft a template");
      return false;
    } finally {
      setDrafting(null);
    }
  };

  const remove = async (t: NoteTemplate) => {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      description: "Notes already made from it are not affected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await templateFetch(`/api/templates/${t.id}`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the template");
    }
  };

  const templates = data?.templates ?? [];
  // A series a template already covers has done its job; say so, don't re-offer it.
  const allSeries = suggestions.data?.suggestions ?? [];
  const series = allSeries.filter((s) => !s.has_template);
  const covered = allSeries.length - series.length;

  return (
    // Bottom room on phones so the last row can scroll clear of the floating mic.
    <div className="space-y-8 pb-20 lg:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start recurring notes, like a weekly operations meeting, from the same structure every time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDescribeOpen(true)} className="min-h-11 md:min-h-9" disabled={data?.notMigrated}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            Draft with AI
          </Button>
          <Button onClick={() => setEditor({ value: { ...EMPTY, project_id: projectId }, id: null })} className="min-h-11 md:min-h-9" disabled={data?.notMigrated}>
            <FilePlus2 className="mr-2 h-4 w-4" aria-hidden />
            New template
          </Button>
        </div>
      </div>

      {data?.notMigrated && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Templates aren&apos;t set up on this server yet. The operator needs to run <code>npm run db:migrate</code>.
        </p>
      )}

      <section aria-labelledby="tpl-mine">
        <h2 id="tpl-mine" className="mb-3 text-sm font-semibold text-muted-foreground">Your templates</h2>
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Make one, save any note as a template from its menu, or start from a suggestion below.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" role="list">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <FileStack className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    {t.description && <p className="line-clamp-2 text-sm text-muted-foreground">{t.description}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {t.project_name && (
                        <span className="inline-flex items-center gap-1">
                          <FolderOpen className="h-3 w-3" aria-hidden />
                          {t.project_name}
                        </span>
                      )}
                      <span>{t.use_count === 1 ? "Used once" : t.use_count ? `Used ${t.use_count} times` : "Not used yet"}</span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" className="min-h-11 flex-1 md:min-h-9">
                    <Link href={`/notes/new?template=${t.id}${t.project_id ? `&projectId=${t.project_id}` : ""}`}>New note</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 min-w-11 md:min-h-9"
                    aria-label={`Edit ${t.name}`}
                    onClick={() =>
                      setEditor({
                        id: t.id,
                        value: {
                          name: t.name,
                          description: t.description,
                          title_pattern: t.title_pattern,
                          content: t.content,
                          project_id: t.project_id,
                        },
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="outline" className="min-h-11 min-w-11 md:min-h-9" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!data?.notMigrated && (
        <section aria-labelledby="tpl-suggest" className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="tpl-suggest" className="text-sm font-semibold text-muted-foreground">Suggested from your notes</h2>
              <p className="text-sm text-muted-foreground">Notes you write again and again, found by their titles and headings.</p>
            </div>
            <div className="flex gap-2">
              <Select value={projectId ?? "all"} onValueChange={(v) => setProjectId(v === "all" ? null : v)}>
                <SelectTrigger className="min-h-11 w-48 md:min-h-9" aria-label="Look in">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All my notes</SelectItem>
                  {(projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {projectId && (
                <Button variant="outline" onClick={() => setPickOpen(true)} className="min-h-11 md:min-h-9">
                  <ListChecks className="mr-2 h-4 w-4" aria-hidden />
                  Pick notes
                </Button>
              )}
            </div>
          </div>

          {suggestions.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : suggestions.isError ? (
            <p className="text-sm text-muted-foreground">{(suggestions.error as Error).message}</p>
          ) : series.length === 0 && covered > 0 ? (
            <p className="text-sm text-muted-foreground">
              Every recurring kind of note{project ? ` in ${project.name}` : ""} already has a template.
              {projectId ? " You can still pick notes yourself." : ""}
            </p>
          ) : series.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recurring yet{project ? ` in ${project.name}` : ""}
              {suggestions.data ? ` (${suggestions.data.scanned} notes looked at)` : ""}. A series shows up once three notes share a
              title like “Operations meeting” with different dates.
              {projectId ? " You can also pick notes yourself." : " Choose a project to pick notes yourself."}
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {series.map((s) => {
                return (
                  <li key={`${s.project_id}:${s.key}`} className="rounded-lg border p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden />
                          {s.label}
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                            {CADENCE[s.cadence]} · {s.count} notes
                          </span>
                        </p>
                        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                          {s.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                        <Button
                          size="sm"
                          className="min-h-11 flex-1 sm:flex-none md:min-h-9"
                          disabled={!!drafting}
                          onClick={() => draft({ mode: "notes", seriesKey: s.key, projectId: projectId ?? s.project_id }, `ai:${s.key}`)}
                        >
                          {drafting === `ai:${s.key}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
                          Draft with AI
                        </Button>
                        {s.shared_headings.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-11 flex-1 sm:flex-none md:min-h-9"
                            disabled={!!drafting}
                            onClick={() => draft({ mode: "headings", seriesKey: s.key, projectId }, `h:${s.key}`)}
                          >
                            {drafting === `h:${s.key}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                            Use shared headings
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {series.length > 0 && covered > 0 && (
            <p className="text-sm text-muted-foreground">
              {covered === 1 ? "One more series already has" : `${covered} more series already have`} a template.
            </p>
          )}
        </section>
      )}

      <DescribeDialog
        open={describeOpen}
        onOpenChange={setDescribeOpen}
        projectId={projectId}
        busy={drafting === "describe"}
        onSubmit={async (description, pid) => {
          if (await draft({ mode: "describe", description, projectId: pid }, "describe")) setDescribeOpen(false);
        }}
      />

      {projectId && (
        <PickNotesDialog
          open={pickOpen}
          onOpenChange={setPickOpen}
          projectId={projectId}
          busy={drafting === "pick"}
          onSubmit={async (noteIds, instructions) => {
            if (await draft({ mode: "notes", noteIds, projectId, instructions }, "pick")) setPickOpen(false);
          }}
        />
      )}

      <TemplateEditorDialog
        open={!!editor}
        onOpenChange={(open) => !open && setEditor(null)}
        templateId={editor?.id ?? null}
        initial={editor?.value ?? EMPTY}
      />
    </div>
  );
}

function DescribeDialog({
  open,
  onOpenChange,
  projectId,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  busy: boolean;
  onSubmit: (description: string, projectId: string | null) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>Draft a template with AI</DialogTitle>
          <DialogDescription>Say what the notes are for. You&apos;ll review the draft before it is saved.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 3) onSubmit(text.trim(), projectId);
          }}
          className="space-y-3"
        >
          <Label htmlFor="tpl-describe" className="sr-only">What is the template for?</Label>
          <Textarea
            id="tpl-describe"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="text-base md:text-sm"
            placeholder="Weekly operations meeting: production numbers, staffing, safety, blockers and action items with owners"
          />
          <DialogFooter>
            <Button type="submit" disabled={busy || text.trim().length < 3} className="min-h-11 md:min-h-9">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
              {busy ? "Drafting…" : "Draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PickNotesDialog({
  open,
  onOpenChange,
  projectId,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  busy: boolean;
  onSubmit: (noteIds: string[], instructions: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["notes", "template-pick", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/notes?projectId=${encodeURIComponent(projectId)}&limit=60`);
      if (!res.ok) throw new Error("Couldn't load the project's notes");
      const json = await res.json();
      return (json.notes ?? []) as Array<{ id: string; title: string; updated_at: string }>;
    },
    enabled: open,
  });
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 8 ? s : [...s, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact" className="max-h-[100dvh] overflow-y-auto sm:max-h-[85dvh]">
        <DialogHeader>
          <DialogTitle>Draft from notes you choose</DialogTitle>
          <DialogDescription>Pick up to 8 notes of the same kind. AI drafts the template they share.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">This project has no notes yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto" role="list">
            {(data ?? []).map((n) => (
              <li key={n.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
                  <Checkbox checked={selected.includes(n.id)} onCheckedChange={() => toggle(n.id)} />
                  <span className="truncate text-sm">{n.title}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="tpl-instr">Anything to add? (optional)</Label>
          <Textarea id="tpl-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="text-base md:text-sm" placeholder="Add a safety section at the top" />
        </div>
        <DialogFooter>
          <Button onClick={() => onSubmit(selected, instructions)} disabled={busy || selected.length === 0} className="min-h-11 md:min-h-9">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
            {busy ? "Drafting…" : `Draft from ${selected.length || ""} note${selected.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <TemplatesContent />
    </Suspense>
  );
}
