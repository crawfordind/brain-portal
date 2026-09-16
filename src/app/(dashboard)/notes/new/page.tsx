"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, Mic } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { VoiceInput } from "@/components/ui/voice-input";
import { SaveStatus } from "@/components/ui/save-status";
import { addToQueue } from "@/lib/offline/simple-queue";
import { useAutoSave } from "@/hooks/use-auto-save";

interface Project {
  id: string;
  name: string;
}

function NewNoteContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get("projectId") || "";

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [isSaving, setIsSaving] = useState(false);
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null);
  const [createdNoteSlug, setCreatedNoteSlug] = useState<string | null>(null);

  // Auto-save: create on first meaningful input, then update
  // Falls back to offline queue when server is unreachable
  const autoSave = useAutoSave({
    data: { title, content, projectId },
    onSave: async (data) => {
      if (!data.title.trim()) return; // Don't save without a title

      const noteData = {
        title: data.title.trim(),
        content: data.content,
        projectId: data.projectId || null,
      };

      if (!createdNoteId) {
        // First save - create note
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(noteData),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) throw new Error("Failed to create");

          const result = await response.json();
          setCreatedNoteId(result.note.id);
          setCreatedNoteSlug(result.note.slug);

          queryClient.invalidateQueries({ queryKey: ["notes"] });

          // Update URL without navigation to preserve user's typing
          window.history.replaceState(null, "", `/notes/${result.note.slug}`);
        } catch {
          // Offline or server error - queue for later sync
          addToQueue({
            type: "note",
            operation: "create",
            data: noteData,
          });
        }
      } else {
        // Subsequent saves - update note
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(`/api/notes/${createdNoteId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(noteData),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) throw new Error("Failed to update");

          queryClient.invalidateQueries({ queryKey: ["notes"] });
          queryClient.invalidateQueries({ queryKey: ["note", createdNoteSlug!] });
        } catch {
          addToQueue({
            type: "note",
            operation: "update",
            data: { id: createdNoteId, ...noteData },
          });
        }
      }
    },
    delay: 1000,
    enabled: title.trim() !== "", // Enable after title is typed
  });

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch("/api/projects");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return (data.projects ?? []) as Project[];
    },
  });

  const projects = (projectsData as Project[]) || [];

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }
    if (isSaving) return;

    autoSave.cancelPending();

    const noteData = {
      title: title.trim(),
      content,
      projectId: projectId || null,
    };

    setIsSaving(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const url = createdNoteId ? `/api/notes/${createdNoteId}` : "/api/notes";
      const method = createdNoteId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        const slug = createdNoteSlug || result.note?.slug;
        queryClient.invalidateQueries({ queryKey: ["notes"] });
        toast.success(createdNoteId ? "Note saved!" : "Note created!");
        router.push(slug ? `/notes/${slug}` : "/notes");
      } else {
        throw new Error("Server error");
      }
    } catch {
      addToQueue({
        type: "note",
        operation: createdNoteId ? "update" : "create",
        data: createdNoteId ? { id: createdNoteId, ...noteData } : noteData,
      });
      toast.success(createdNoteId ? "Note saved!" : "Note created (queued)!");
      router.push(createdNoteSlug ? `/notes/${createdNoteSlug}` : "/notes");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header - MOBILE: Stack on small screens */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          {/* TOUCH: Larger back button on mobile */}
          <Button variant="ghost" size="icon" asChild className="min-h-10 min-w-10 md:min-h-9 md:min-w-9 shrink-0">
            <Link href="/notes">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg md:text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0 h-auto min-w-0"
            placeholder="Note title..."
            autoFocus
          />
        </div>

        {/* Action buttons - MOBILE: Full width row, scrollable */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible scrollbar-hide">
          {/* Save status indicator */}
          <SaveStatus status={autoSave.status} lastSaved={autoSave.lastSaved} />
          {/* MOBILE: Hide project selector on very small screens, accessible via notes list */}
          <Select
            value={projectId || "none"}
            onValueChange={(v) => setProjectId(v === "none" ? "" : v)}
          >
            <SelectTrigger className="w-32 sm:w-40 min-h-11 md:min-h-9 shrink-0">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <VoiceInput
            onTranscript={(text) => {
              setContent((prev) => prev ? `${prev}\n\n${text}` : text);
              toast.success("Voice added to note");
            }}
            size="default"
          />

          {/* TOUCH: min-h-11 for comfortable tapping on mobile */}
          <Button
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
            className="min-h-11 md:min-h-9 shrink-0"
          >
            <Save className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{isSaving ? "Creating..." : "Create"}</span>
          </Button>
        </div>
      </div>

      {/* Editor */}
      <MarkdownEditor
        content={content}
        onChange={setContent}
        placeholder="Start writing..."
        projectId={projectId || null}
        noteId={createdNoteId}
      />
    </div>
  );
}

export default function NewNotePage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 flex-1" />
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    }>
      <NewNoteContent />
    </Suspense>
  );
}
