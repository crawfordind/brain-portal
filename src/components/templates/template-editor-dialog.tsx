"use client";

/**
 * Create or edit a template, or review a draft before saving it. A draft is
 * never saved until the person presses Save, here.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { useProjects } from "@/hooks/use-projects";
import { templateFetch } from "@/hooks/use-templates";
import { TEMPLATE_VARIABLES } from "@/lib/templates/types";
import type { NoteTemplate, TemplateSource } from "@/lib/templates/types";

export interface TemplateEditorValue {
  name: string;
  description: string;
  title_pattern: string;
  content: string;
  project_id: string | null;
  source?: TemplateSource;
  source_note_ids?: string[];
  /** Shown above the form when the value is a draft. */
  rationale?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing template when set; otherwise creating. */
  templateId?: string | null;
  initial: TemplateEditorValue;
  onSaved?: (template: NoteTemplate) => void;
}

export function TemplateEditorDialog(props: Props) {
  // Remount the form whenever a different value is opened, so state starts fresh.
  const key = `${props.templateId ?? "new"}:${props.open ? props.initial.name + props.initial.content.length : "closed"}`;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <EditorForm key={key} {...props} />}
    </Dialog>
  );
}

function EditorForm({ onOpenChange, templateId, initial, onSaved }: Props) {
  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [titlePattern, setTitlePattern] = useState(initial.title_pattern);
  const [content, setContent] = useState(initial.content);
  const [projectId, setProjectId] = useState<string | null>(initial.project_id);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the template a name");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        description,
        title_pattern: titlePattern,
        content,
        project_id: projectId,
        ...(templateId ? {} : { source: initial.source ?? "manual", source_note_ids: initial.source_note_ids ?? [] }),
      };
      const { template } = await templateFetch<{ template: NoteTemplate }>(
        templateId ? `/api/templates/${templateId}` : "/api/templates",
        { method: templateId ? "PATCH" : "POST", body: JSON.stringify(body) }
      );
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success(templateId ? "Template saved" : `Template “${template.name}” created`);
      onSaved?.(template);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-h-[90dvh] sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{templateId ? "Edit template" : initial.rationale ? "Review the draft" : "New template"}</DialogTitle>
        <DialogDescription>
          Every new note started from this template gets this title and body, with the variables filled in.
        </DialogDescription>
      </DialogHeader>

      {initial.rationale && (
        <p className="flex gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>{initial.rationale} Nothing is saved until you press Save.</span>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-name">Name</Label>
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly operations meeting" className="min-h-11 text-base md:min-h-9 md:text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-project">Project</Label>
          <Select value={projectId ?? "none"} onValueChange={(v) => setProjectId(v === "none" ? null : v)}>
            <SelectTrigger id="tpl-project" className="min-h-11 md:min-h-9">
              <SelectValue placeholder="Any project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any project</SelectItem>
              {(projects ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tpl-title">Title for new notes</Label>
          <Input id="tpl-title" value={titlePattern} onChange={(e) => setTitlePattern(e.target.value)} placeholder="Operations meeting {{date}}" className="min-h-11 text-base md:min-h-9 md:text-sm" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tpl-desc">Description (optional)</Label>
          <Input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Agenda, metrics, decisions and action items" className="min-h-11 text-base md:min-h-9 md:text-sm" />
        </div>
      </div>

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Variables you can use</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {TEMPLATE_VARIABLES.map((v) => (
            <li key={v.token}>
              <code className="rounded bg-muted px-1">{v.token}</code>{" "}
              <span className="text-muted-foreground">{v.meaning}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="rounded-md border">
        <MarkdownEditor content={content} onChange={setContent} placeholder="Headings, prompts and checklists every note should start with…" />
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="min-h-11 md:min-h-9">
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !name.trim()} className="min-h-11 md:min-h-9">
          {saving ? "Saving…" : "Save template"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
