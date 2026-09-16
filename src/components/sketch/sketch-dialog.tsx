"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, ScanText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SketchPad } from "./sketch-pad";
import type { SketchPadHandle } from "./types";
import type { HandwritingRecognition } from "@/lib/ai/handwriting";
import type { Attachment } from "@/lib/db/schema";

export interface SketchResult {
  attachment: Attachment | null;
  recognition: HandwritingRecognition | null;
  /** Whether the caller should also insert the transcription as editable text. */
  insertTranscription: boolean;
}

interface SketchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId?: string | null;
  projectId?: string | null;
  /** Called after the sketch is saved. Receives the stored attachment + OCR. */
  onComplete?: (result: SketchResult) => void;
  title?: string;
}

interface RecognizeResponse {
  recognition: HandwritingRecognition | null;
  attachment: Attachment | null;
}

export function SketchDialog({
  open,
  onOpenChange,
  noteId,
  projectId,
  onComplete,
  title = "Sketch & handwriting",
}: SketchDialogProps) {
  const padRef = useRef<SketchPadHandle>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recognition, setRecognition] = useState<HandwritingRecognition | null>(null);
  const [insertTranscription, setInsertTranscription] = useState(true);

  const post = async (persist: boolean): Promise<RecognizeResponse | null> => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      toast.error("Draw something first");
      return null;
    }
    const image = pad.exportPNG();
    if (!image) {
      toast.error("Couldn't capture the drawing");
      return null;
    }

    const res = await fetch("/api/ink/recognize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        recognize: true,
        persist,
        strokes: persist ? pad.getStrokes() : undefined,
        noteId: noteId ?? undefined,
        projectId: projectId ?? undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  };

  const handleRecognize = async () => {
    setRecognizing(true);
    try {
      const data = await post(false);
      if (data) {
        setRecognition(data.recognition);
        if (!data.recognition?.hasText) {
          toast.info("No handwriting detected — saved as a drawing");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recognition failed");
    } finally {
      setRecognizing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await post(true);
      if (data) {
        setRecognition(data.recognition);
        onComplete?.({
          attachment: data.attachment,
          recognition: data.recognition,
          insertTranscription:
            insertTranscription && !!data.recognition?.text,
        });
        toast.success("Sketch saved");
        reset();
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setRecognition(null);
    setInsertTranscription(true);
  };

  const busy = recognizing || saving;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Draw or handwrite below. Brain Portal can transcribe your handwriting
            and save the sketch alongside the recognized text.
          </DialogDescription>
        </DialogHeader>

        <SketchPad ref={padRef} />

        {recognition && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <ScanText className="h-4 w-4" />
              {recognition.hasText ? "Recognized text" : "Drawing description"}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {Math.round(recognition.confidence * 100)}% confidence
              </span>
            </div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
              {recognition.text || recognition.description || "—"}
            </p>
            {recognition.hasText && (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <Checkbox
                  checked={insertTranscription}
                  onCheckedChange={(c) => setInsertTranscription(c === true)}
                />
                Also insert the transcribed text below the image
              </label>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleRecognize}
            disabled={busy}
          >
            {recognizing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Recognize handwriting
          </Button>
          <Button type="button" onClick={handleSave} disabled={busy}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save &amp; insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
