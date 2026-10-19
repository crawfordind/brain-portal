"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ShareDialog } from "./share-dialog";

interface ShareNoteButtonProps {
  noteId: string;
  /** The note page's query key uses the slug; pass it so that page refreshes too. */
  slug?: string;
  title?: string;
  /** "icon" for list rows; "labelled" shows the word on wider screens. */
  variant?: "icon" | "labelled";
  className?: string;
}

/**
 * A visible way to share a note, wherever the note appears. Sharing used to
 * live only at the bottom of the note page's overflow menu, below the whole
 * project list, which on a phone meant it was effectively not there.
 *
 * Render it as a sibling of a row's link, never inside one: the dialog is
 * portalled, but React events still bubble through portals, so a click in
 * the dialog would reach the link and navigate away.
 */
export function ShareNoteButton({ noteId, slug, title, variant = "icon", className }: ShareNoteButtonProps) {
  const [open, setOpen] = useState(false);
  const label = title ? `Share “${title}”` : "Share note";

  return (
    <>
      <Button
        type="button"
        variant={variant === "icon" ? "ghost" : "outline"}
        size={variant === "icon" ? "icon" : "default"}
        className={cn(
          variant === "icon" ? "h-11 w-11 shrink-0" : "min-h-11 min-w-11 md:min-h-9 px-3",
          className
        )}
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        <Share2 className={cn("h-4 w-4", variant === "labelled" && "sm:mr-2")} />
        {variant === "labelled" && <span className="hidden sm:inline">Share</span>}
      </Button>
      <ShareDialog noteId={noteId} slug={slug} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}
