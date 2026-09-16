"use client";

/**
 * Share triage form.
 *
 * Optimized for the one-handed, half-second interaction a share sheet implies:
 * the payload is already parsed and pre-filled, "Capture" is preselected, and
 * Save is reachable without scrolling on a phone. Everything else — choosing a
 * note or task instead, adding a thought, picking a project — is optional.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ExternalLink,
  FileText,
  Inbox,
  Link2,
  ListTodo,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ParsedShare } from "@/lib/share/parse";
import { hostOf } from "@/lib/share/parse";

type Target = "capture" | "note" | "task";

const TARGETS: { value: Target; label: string; hint: string; icon: typeof Inbox }[] = [
  { value: "capture", label: "Capture", hint: "Straight to your inbox", icon: Inbox },
  { value: "note", label: "Note", hint: "A note you'll come back to", icon: FileText },
  { value: "task", label: "Task", hint: "Something to do", icon: ListTodo },
];

interface SaveResult {
  saved: Target;
  id: string;
  url: string;
}

export function ShareCaptureForm({ parsed }: { parsed: ParsedShare }) {
  const router = useRouter();
  const [target, setTarget] = useState<Target>("capture");
  const [title, setTitle] = useState(parsed.title);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => parsed.content, [parsed.content]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          title,
          text: parsed.body,
          url: parsed.url,
          comment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't save that");
        return;
      }
      setResult(data as SaveResult);
    } catch {
      setError("Couldn't reach Brain Portal. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [target, title, comment, parsed.body, parsed.url]);

  // Cmd/Ctrl+Enter saves, matching the rest of the app's editors.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (!saving && !result) handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, saving, result]);

  if (result) {
    return (
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <CheckCircle2 className="h-10 w-10 mx-auto text-green-500 mb-3" />
        <h1 className="text-lg font-semibold">Saved to Brain Portal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {title || "Your share"} is now a {result.saved}.
        </p>
        <div className="flex flex-col gap-2 mt-5">
          <Button onClick={() => router.push(result.url)} className="w-full">
            Open it
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setResult(null);
              setComment("");
            }}
          >
            Save it somewhere else too
          </Button>
        </div>
      </div>
    );
  }

  if (parsed.isEmpty) {
    return (
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <Brain className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
        <h1 className="text-lg font-semibold">Nothing to save</h1>
        <p className="text-sm text-muted-foreground mt-1">
          That share didn&apos;t carry a link or any text. Try sharing again, or
          capture it by hand.
        </p>
        <Button className="w-full mt-5" onClick={() => router.push("/")}>
          Go to Brain Portal
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border bg-card shadow-sm">
      <header className="flex items-center gap-2 px-5 py-4 border-b">
        <Brain className="h-5 w-5 text-primary" />
        <h1 className="text-base font-semibold">Save to Brain Portal</h1>
      </header>

      <div className="p-5 space-y-4">
        {/* What was shared */}
        <div className="rounded-lg border bg-muted/40 p-3">
          {parsed.url ? (
            <a
              href={parsed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 text-sm group"
            >
              <Link2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium truncate group-hover:underline">
                  {hostOf(parsed.url)}
                </span>
                <span className="block text-xs text-muted-foreground break-all">
                  {parsed.url}
                </span>
              </span>
              <ExternalLink className="h-3 w-3 mt-1 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </a>
          ) : (
            <p className="text-sm whitespace-pre-wrap line-clamp-6">{preview}</p>
          )}
        </div>

        {/* Destination */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Save as</Label>
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map(({ value, label, hint, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTarget(value)}
                title={hint}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-lg border py-3 transition-colors",
                  // 56px minimum touch target, matching the rest of the mobile UI
                  "min-h-[56px]",
                  target === value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
                aria-pressed={target === value}
              >
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="share-title" className="text-xs text-muted-foreground">
            Title
          </Label>
          <Input
            id="share-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={parsed.url ? hostOf(parsed.url) : "Untitled"}
            className="h-11"
          />
        </div>

        {/* Optional thought */}
        <div className="space-y-1.5">
          <Label htmlFor="share-comment" className="text-xs text-muted-foreground">
            Why you saved this <span className="opacity-60">(optional)</span>
          </Label>
          <Textarea
            id="share-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="A line of context now saves you rereading it later…"
            rows={3}
            className="resize-none"
          />
        </div>

        {error && (
          <p className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-2 px-5 py-4 border-t">
        <Button
          variant="ghost"
          className="flex-1 h-11"
          onClick={() => router.push("/")}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button className="flex-1 h-11" onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Saving
            </>
          ) : (
            "Save"
          )}
        </Button>
      </footer>
    </div>
  );
}
