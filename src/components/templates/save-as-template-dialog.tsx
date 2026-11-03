"use client";

/**
 * Save the note you are looking at as a template: the whole note, or only its
 * headings so this week's figures are not copied into every future meeting.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { templateFetch } from "@/hooks/use-templates";
import { seriesLabel } from "@/lib/templates/series";
import { extractHeadings } from "@/lib/templates/content";
import type { NoteTemplate } from "@/lib/templates/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  noteTitle: string;
  /** The note's current text, to say how many headings would be kept. */
  content: string;
}

export function SaveAsTemplateDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <Form {...props} />}
    </Dialog>
  );
}

function Form({ onOpenChange, noteId, noteTitle, content }: Props) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const headings = extractHeadings(content);
  const [name, setName] = useState(seriesLabel(noteTitle) || noteTitle);
  const [mode, setMode] = useState<"structure" | "whole">(headings.length ? "structure" : "whole");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { template } = await templateFetch<{ template: NoteTemplate }>("/api/templates", {
        method: "POST",
        body: JSON.stringify({ fromNoteId: noteId, structureOnly: mode === "structure", name }),
      });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success(`Saved “${template.name}” as a template`, {
        action: { label: "Open", onClick: () => router.push("/templates") },
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent size="compact">
      <DialogHeader>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          New notes can start from it. Unsaved edits on this page are not included yet, so wait for “Saved”.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="sat-name">Template name</Label>
        <Input id="sat-name" value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 text-base md:min-h-9 md:text-sm" />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Keep</legend>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
          <input type="radio" name="sat-mode" className="mt-1" checked={mode === "structure"} disabled={!headings.length} onChange={() => setMode("structure")} />
          <span className="text-sm">
            <span className="font-medium">Headings only</span>
            <span className="block text-muted-foreground">
              {headings.length
                ? `${headings.length} heading${headings.length === 1 ? "" : "s"}: ${headings.slice(0, 4).join(", ")}${headings.length > 4 ? "…" : ""}`
                : "This note has no headings."}
            </span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
          <input type="radio" name="sat-mode" className="mt-1" checked={mode === "whole"} onChange={() => setMode("whole")} />
          <span className="text-sm">
            <span className="font-medium">The whole note</span>
            <span className="block text-muted-foreground">Text and all. Edit out the one-off parts afterwards.</span>
          </span>
        </label>
      </fieldset>
      <DialogFooter className="gap-2 sm:items-center">
        <Link href="/templates" className="mr-auto text-sm text-muted-foreground underline-offset-4 hover:underline">
          All templates
        </Link>
        <Button onClick={save} disabled={saving || !name.trim()} className="min-h-11 md:min-h-9">
          {saving ? "Saving…" : "Save template"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
