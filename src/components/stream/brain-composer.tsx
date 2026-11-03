"use client";

/**
 * The home screen's one input: a floating button beside the brain that pops
 * over with two ways in, **Speak** or **Type**.
 *
 * - *Type* opens the Brain Bar in the popover, focused, so a thought is two
 *   taps away and the brain stays on screen behind it.
 * - *Speak* starts the app's existing voice capture (`requestVoiceToggle`, the
 *   same recogniser, settings and save path as everywhere else). While it
 *   records, this button becomes the Stop button.
 *
 * It replaces three things the dashboard used to stack above the stream: the
 * full-width Brain Bar, the first-visit voice card and, on this page, the
 * floating mic.
 *
 * Two forms, one behaviour:
 *   - `orb`: the phone and tablet dock's centre button while you are on the
 *     stream (everywhere else that button is the way back to the stream);
 *   - `floating`: a round button at the bottom right, for desktop, which has
 *     a sidebar instead of a dock.
 */

import { useState, useSyncExternalStore } from "react";
import { Keyboard, Loader2, Mic, Plus, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { requestVoiceToggle } from "@/components/voice/events";
import { BrainBar } from "./brain-bar";

const noopSubscribe = () => () => {};
const getSpeechSupported = () =>
  "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
const getServerSpeechSupported = () => false;

/** The dock slot: same shape as the Stream orb it replaces. */
const orbButton =
  "group flex min-h-11 flex-col items-center justify-end gap-1 rounded-2xl pb-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface BrainComposerProps {
  /** Something was saved by typing. Defaults to asking the stream to refresh. */
  onCaptured?: () => void;
  variant?: "floating" | "orb";
  className?: string;
}

const refreshStream = () => window.dispatchEvent(new CustomEvent("stream-refresh"));

export function BrainComposer({
  onCaptured = refreshStream,
  variant = "floating",
  className,
}: BrainComposerProps) {
  const orb = variant === "orb";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "type">("choose");
  const isRecording = useVoiceStore((s) => s.isRecording);
  const isProcessing = useVoiceStore((s) => s.isProcessing);
  const markOnboardingComplete = useVoiceStore((s) => s.markOnboardingComplete);
  const speechSupported = useSyncExternalStore(
    noopSubscribe,
    getSpeechSupported,
    getServerSpeechSupported
  );

  const setOpenAndReset = (next: boolean) => {
    setOpen(next);
    if (!next) setMode("choose");
  };

  const buttonBase = cn(
    "flex h-14 min-w-14 items-center justify-center gap-2 rounded-full px-4 shadow-lg transition-transform active:scale-95",
    "outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
  );

  if (isRecording || isProcessing) {
    if (orb) {
      return (
        <button
          type="button"
          onClick={() => !isProcessing && requestVoiceToggle()}
          aria-label={isProcessing ? "Saving what you said" : "Stop and save what you said"}
          className={cn(orbButton, className)}
        >
          <span className="-mt-6 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg shadow-destructive/40 ring-[3px] ring-background">
            {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Square className="h-5 w-5 animate-pulse" />}
          </span>
          <span className="text-xs font-medium leading-none text-destructive">
            {isProcessing ? "Saving" : "Stop"}
          </span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => !isProcessing && requestVoiceToggle()}
        aria-label={isProcessing ? "Saving what you said" : "Stop and save what you said"}
        className={cn(
          buttonBase,
          "bg-destructive text-destructive-foreground shadow-destructive/30",
          isRecording && "animate-pulse",
          className
        )}
      >
        {isProcessing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Square className="h-5 w-5" />}
        <span className="text-base font-medium">{isProcessing ? "Saving" : "Stop"}</span>
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpenAndReset}>
      <PopoverTrigger asChild>
        {orb ? (
          <button
            type="button"
            aria-label="Capture a thought, by voice or by typing"
            className={cn(orbButton, className)}
          >
            <span
              data-active="true"
              className="nav-orb -mt-6 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full transition-transform group-active:scale-95"
            >
              <Plus className={cn("h-7 w-7 transition-transform", open && "rotate-45")} aria-hidden="true" />
            </span>
            <span className="text-xs font-medium leading-none text-primary">Capture</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label="Capture a thought, by voice or by typing"
            className={cn(
              buttonBase,
              "bg-primary text-primary-foreground shadow-primary/30 ring-4 ring-primary/15",
              className
            )}
          >
            <Plus className={cn("h-6 w-6 transition-transform", open && "rotate-45")} />
            <span className="sr-only text-base font-medium xl:not-sr-only">Capture</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align={orb ? "center" : "end"}
        sideOffset={orb ? 32 : 12}
        collisionPadding={12}
        className={cn(
          "rounded-2xl p-2 shadow-xl",
          mode === "type" ? "w-[min(calc(100vw-1.5rem),32rem)]" : "w-[min(calc(100vw-1.5rem),18rem)]"
        )}
      >
        {mode === "choose" ? (
          <div className="flex flex-col gap-1" role="menu" aria-label="How do you want to capture?">
            <button
              type="button"
              role="menuitem"
              disabled={!speechSupported}
              onClick={() => {
                setOpenAndReset(false);
                markOnboardingComplete();
                requestVoiceToggle();
              }}
              className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-muted focus-visible:bg-muted outline-none disabled:opacity-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mic className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium">Speak</span>
                <span className="block text-sm text-muted-foreground">
                  {speechSupported ? "Talk; it's saved when you stop" : "Not available in this browser"}
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => setMode("type")}
              className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left hover:bg-muted focus-visible:bg-muted outline-none"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Keyboard className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-medium">Type</span>
                <span className="block text-sm text-muted-foreground">A thought, a task, a link</span>
              </span>
            </button>
          </div>
        ) : (
          <BrainBar
            autoFocus
            onSubmit={() => {
              setOpenAndReset(false);
              onCaptured?.();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
