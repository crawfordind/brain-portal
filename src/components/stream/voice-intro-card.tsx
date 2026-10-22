"use client";

/**
 * "Try voice capture" — the dashboard's introduction to the mic.
 *
 * This used to be a full-screen modal that appeared a second after a first
 * sign-in, covering the page the user had just arrived at, and its "Try It
 * Now" button only closed the modal. It is now a card under the Brain Bar:
 * it asks for nothing, its "Try it" actually starts recording (the FAB is
 * hidden on desktop, so the card is the visible control there), and it goes
 * away for good once dismissed or once that first try is over.
 *
 * The voice store persists to `localStorage` and rehydrates after mount, so the
 * card waits for hydration; otherwise every returning user would see it flash.
 */

import { useState, useSyncExternalStore } from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useVoiceShortcutInfo } from "@/components/voice/hooks/use-voice-shortcuts";
import { requestVoiceToggle } from "@/components/voice/events";

const subscribeHydration = (onChange: () => void) =>
  useVoiceStore.persist.onFinishHydration(onChange);
const getHydrated = () => useVoiceStore.persist.hasHydrated();
const getServerHydrated = () => false;

const noopSubscribe = () => () => {};
const getSpeechSupported = () =>
  "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
const getServerSpeechSupported = () => false;

export function VoiceIntroCard() {
  const hydrated = useSyncExternalStore(subscribeHydration, getHydrated, getServerHydrated);
  const supported = useSyncExternalStore(noopSubscribe, getSpeechSupported, getServerSpeechSupported);
  const onboardingComplete = useVoiceStore((s) => s.onboardingComplete);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const markOnboardingComplete = useVoiceStore((s) => s.markOnboardingComplete);
  const { formatShortcut } = useVoiceShortcutInfo();

  // Set when "Try it" starts a recording, so the card (and its Stop button)
  // stays up until that recording ends, then goes with the rest of onboarding.
  const [trying, setTrying] = useState(false);

  if (!hydrated || !supported) return null;
  if (onboardingComplete && !(trying && isRecording)) return null;

  const handleToggle = () => {
    if (!isRecording) {
      setTrying(true);
      markOnboardingComplete();
    }
    requestVoiceToggle();
  };

  return (
    <section
      aria-labelledby="voice-intro-title"
      className="relative rounded-xl border bg-card px-3.5 py-3"
    >
      <button
        type="button"
        onClick={markOnboardingComplete}
        aria-label="Dismiss voice capture introduction"
        className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-9">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Mic className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 id="voice-intro-title" className="text-sm font-medium">
            Try voice capture
          </h2>
          <p className="text-xs text-muted-foreground">
            Tap the mic and say anything. It&apos;s the fastest way to capture a thought.
            Say &quot;create task to…&quot; or &quot;new note about…&quot;, use
            &quot;period&quot; and &quot;comma&quot; for punctuation, or press{" "}
            <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">
              {formatShortcut("mod+shift+v")}
            </kbd>{" "}
            from anywhere.
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2 pl-12">
        <Button
          size="sm"
          className="h-11 sm:h-9"
          variant={isRecording ? "destructive" : "default"}
          onClick={handleToggle}
        >
          {isRecording ? (
            <>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              Stop and save
            </>
          ) : (
            <>
              <Mic className="mr-1.5 h-3.5 w-3.5" />
              Try it
            </>
          )}
        </Button>
        {!isRecording && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={markOnboardingComplete}
          >
            Not now
          </Button>
        )}
      </div>
    </section>
  );
}
