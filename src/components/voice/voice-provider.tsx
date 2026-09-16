"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { VoiceFAB } from "./voice-fab";
import { VoiceTranscriptBubble } from "./voice-transcript-bubble";
import { VoiceOnboarding } from "./voice-onboarding";
import { useVoiceStore } from "@/lib/stores/voice-store";

interface VoiceProviderProps {
  children?: React.ReactNode;
  showFAB?: boolean;
  showOnboarding?: boolean;
}

/**
 * VoiceProvider - Wraps the app to provide global voice capture features
 *
 * Usage:
 * ```tsx
 * <VoiceProvider>
 *   <YourApp />
 * </VoiceProvider>
 * ```
 */
export function VoiceProvider({
  children,
  showFAB = true,
  showOnboarding = true,
}: VoiceProviderProps) {
  const { isRecording, interimTranscript, finalTranscript, replaceFinalTranscript } = useVoiceStore();
  const [isMounted, setIsMounted] = useState(false);

  const hasTranscript = !!(interimTranscript || finalTranscript);

  const handleEditTranscript = (text: string) => {
    replaceFinalTranscript(text);
  };

  // Only render voice components on client-side to avoid hydration errors
  useEffect(() => {
    setIsMounted(true);

    // Manually rehydrate Zustand persist store after mount to prevent hydration mismatch
    if (typeof window !== 'undefined') {
      useVoiceStore.persist.rehydrate();
    }
  }, []);

  return (
    <>
      {children}

      {/* Only render voice components after mount to avoid hydration mismatch */}
      {isMounted && (
        <>
          {/* Global voice FAB */}
          {showFAB && <VoiceFAB />}

          {/* Transcript bubble (shows when recording) */}
          {showFAB && isRecording && hasTranscript && (
            <VoiceTranscriptBubble onEdit={handleEditTranscript} />
          )}

          {/* Onboarding (shows on first visit) */}
          {showOnboarding && <VoiceOnboarding />}
        </>
      )}
    </>
  );
}
