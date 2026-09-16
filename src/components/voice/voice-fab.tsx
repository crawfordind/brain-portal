"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Mic, Square, Loader2, CheckCircle2, Command } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useCommandStore } from "@/lib/stores/command-store";
import { useVoiceShortcuts } from "./hooks/use-voice-shortcuts";
import { useAudioFeedback } from "./hooks/use-audio-feedback";
import { useVoiceCommands } from "./hooks/use-voice-commands";
import { useSmartPunctuation } from "./hooks/use-smart-punctuation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VoiceFABProps {
  className?: string;
  onCapture?: (text: string) => Promise<void>;
}

export function VoiceFAB({ className, onCapture }: VoiceFABProps) {
  const {
    isRecording,
    isProcessing,
    interimTranscript,
    finalTranscript,
    captureCount,
    settings,
    error,
    saveMode,
    startRecording,
    stopRecording,
    cancelRecording,
    updateTranscript,
    setProcessing,
    setError,
    incrementCaptureCount,
  } = useVoiceStore();

  const { playFeedback } = useAudioFeedback();
  const { parseCommand, executeCommand } = useVoiceCommands();
  const { processVoiceTranscript } = useSmartPunctuation({
    enabled: settings.autoPunctuation,
    confidenceThreshold: settings.confidenceThreshold,
  });

  const router = useRouter();
  const [showSuccess, setShowSuccess] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isBrowserSupported, setIsBrowserSupported] = useState(true);
  const recognitionRef = React.useRef<any>(null);
  const longPressTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const recordingStartTimeRef = useRef<Date | null>(null);

  const { openPalette } = useCommandStore();

  // Track which result indices have been processed to prevent duplicates
  const processedResultsRef = React.useRef<Set<number>>(new Set());
  const lastTranscriptRef = React.useRef<string>('');
  const processedTextsRef = React.useRef<Set<string>>(new Set());
  const pendingCommandRef = React.useRef<any>(null);

  // Enable keyboard shortcuts
  useVoiceShortcuts({ enabled: true, enableGlobal: true });

  // Check browser support on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const supported = !!SpeechRecognition;
      setIsBrowserSupported(supported);

      if (!supported) {
        setError('Speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.');
      }
    }
  }, [setError]);

  // Detect scroll for shrinking the FAB
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Detect keyboard open on mobile
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        const isKeyboard = window.innerHeight < window.screen.height * 0.75;
        setIsKeyboardOpen(isKeyboard);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleStartRecording = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (!isBrowserSupported) {
      setError('Speech recognition not supported in this browser. Try Chrome, Edge, or Safari.');
      playFeedback('error');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition API not available');
      playFeedback('error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = settings.continuousMode;
    recognition.interimResults = settings.showInterim;
    recognition.lang = settings.language;
    recognition.maxAlternatives = 1;

    // Reset tracking for new session
    processedResultsRef.current = new Set();
    lastTranscriptRef.current = '';
    processedTextsRef.current = new Set();
    pendingCommandRef.current = null;

    recognition.onstart = () => {
      recordingStartTimeRef.current = new Date();
      startRecording('global');
      playFeedback('start');
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      const newFinalTranscripts: string[] = [];

      // Process all results, but only emit finals that haven't been processed
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        const confidence = result[0].confidence;

        if (result.isFinal) {
          if (processedResultsRef.current.has(i)) continue;

          if (confidence !== undefined && confidence > 0 && confidence < settings.confidenceThreshold) {
            continue;
          }

          if (transcript && transcript !== lastTranscriptRef.current) {
            processedResultsRef.current.add(i);
            lastTranscriptRef.current = transcript;

            if (settings.voiceCommands) {
              const commandMatch = parseCommand(transcript);
              if (commandMatch) {
                pendingCommandRef.current = commandMatch;
              }
            }

            newFinalTranscripts.push(transcript);
          }
        } else if (settings.showInterim) {
          // Only show interim for non-finalized results
          if (!processedResultsRef.current.has(i)) {
            interim += transcript + ' ';
          }
        }
      }

      if (interim.trim()) {
        updateTranscript(interim.trim());
      }

      if (newFinalTranscripts.length > 0) {
        newFinalTranscripts.forEach((transcript) => {
          const processed = processVoiceTranscript(transcript, false);

          if (processedTextsRef.current.has(processed)) return;

          processedTextsRef.current.add(processed);
          updateTranscript('', processed);
        });
      }
    };

    recognition.onerror = (event: any) => {
      playFeedback('error');

      switch (event.error) {
        case 'not-allowed':
          setError('Microphone access denied');
          break;
        case 'no-speech':
          setError('No speech detected');
          break;
        case 'network':
          setError('Network error');
          break;
        default:
          setError(`Error: ${event.error}`);
      }

      stopRecording();
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setError('Failed to start voice capture. Please check microphone permissions.');
      playFeedback('error');
    }
  }, [
    isBrowserSupported,
    settings,
    startRecording,
    stopRecording,
    updateTranscript,
    setError,
    playFeedback,
    parseCommand,
    executeCommand,
    processVoiceTranscript,
  ]);

  const handleStopRecording = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    playFeedback('stop');
    stopRecording();

    if (pendingCommandRef.current) {
      playFeedback('command');
      setProcessing(true);

      try {
        await executeCommand(pendingCommandRef.current);
        playFeedback('success');
      } catch {
        playFeedback('error');
      } finally {
        setProcessing(false);
        pendingCommandRef.current = null;
      }
      return;
    }

    // Save the voice input
    if (finalTranscript) {
      setProcessing(true);

      try {
        // Apply final punctuation
        const processed = processVoiceTranscript(finalTranscript, true);

        if (onCapture) {
          await onCapture(processed);
        } else if (saveMode === 'note') {
          // Save as a voice note — creates a real note the user can navigate to
          const durationSeconds = recordingStartTimeRef.current
            ? Math.round((Date.now() - recordingStartTimeRef.current.getTime()) / 1000)
            : 0;

          // Generate a title from the first sentence or first ~60 chars
          const firstSentence = processed.match(/^[^.!?]+[.!?]?/)?.[0] || processed;
          const title = firstSentence.length > 60
            ? firstSentence.substring(0, 57) + '...'
            : firstSentence;

          const response = await fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              content: processed,
              metadata: JSON.stringify({
                source: 'voice',
                transcript: processed,
                duration_seconds: durationSeconds,
                recorded_at: new Date().toISOString(),
              }),
            }),
          });

          if (!response.ok) throw new Error('Failed to save voice note');

          const data = await response.json();
          if (data.note?.slug) {
            // Navigate to the new voice note
            router.push(`/notes/${data.note.slug}`);
          }
        } else {
          // Unified smart capture: classify via AI, then route through stream API
          let classification = null;
          try {
            const classifyRes = await fetch('/api/stream/classify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: processed }),
            });
            if (classifyRes.ok) {
              classification = await classifyRes.json();
            }
          } catch {
            // Classification unavailable — fall back to raw capture
          }

          // Route through the unified stream API with classification
          const payload = {
            type: classification?.type || 'capture',
            title: classification?.title || processed.slice(0, 60),
            content: classification?.content || processed,
            rawInput: processed,
            priority: classification?.priority || 'medium',
            tags: classification?.tags || [],
            dueDate: classification?.dueDate || undefined,
            delegatedTo: classification?.suggestedAgent || undefined,
            projectSlug: classification?.projectSlug || undefined,
            classification,
            sourceType: 'voice',
          };

          const response = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) throw new Error('Failed to save capture');
        }

        incrementCaptureCount();
        playFeedback('success');
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
      } catch {
        setError('Failed to save voice input');
        playFeedback('error');
      } finally {
        setProcessing(false);
        recordingStartTimeRef.current = null;
      }
    }
  }, [
    finalTranscript,
    onCapture,
    saveMode,
    router,
    stopRecording,
    setProcessing,
    setError,
    incrementCaptureCount,
    playFeedback,
    processVoiceTranscript,
    executeCommand,
  ]);

  const handleToggle = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStartRecording, handleStopRecording]);

  // Long-press handlers for command palette
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't enable long-press while recording
    if (isRecording || isProcessing) return;

    setIsLongPressing(true);

    longPressTimerRef.current = setTimeout(() => {
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }

      // Play audio feedback
      playFeedback('start');

      // Open command palette
      openPalette();

      // Prevent the normal click from firing
      setIsLongPressing(false);
    }, 500);
  }, [isRecording, isProcessing, openPalette, playFeedback]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const hadTimer = longPressTimerRef.current !== null;

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Only prevent default if we actually had a long-press in progress
    // This allows normal clicks when recording (where touchStart returns early)
    if (hadTimer && !isLongPressing) {
      e.preventDefault();
      e.stopPropagation();
    }

    setIsLongPressing(false);
  }, [isLongPressing]);

  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPressing(false);
  }, []);

  // Mouse long-press for desktop testing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't enable long-press while recording
    if (isRecording || isProcessing) return;

    setIsLongPressing(true);

    longPressTimerRef.current = setTimeout(() => {
      playFeedback('start');

      // Open command palette
      openPalette();

      // Prevent the normal click from firing
      setIsLongPressing(false);
    }, 500);
  }, [isRecording, isProcessing, openPalette, playFeedback]);

  const handleMouseUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    setIsLongPressing(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPressing(false);
  }, []);

  // Auto-dismiss errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Smart positioning classes
  const positionClasses = cn(
    "fixed z-50 flex items-center justify-center rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-primary/50",
    // Mobile: above bottom nav (80px from bottom), top-right when keyboard open
    "bottom-20 right-4 lg:bottom-6",
    isKeyboardOpen && "!top-4 !bottom-auto",
    // Size: shrink on scroll
    isScrolled && !isRecording ? "w-12 h-12" : "w-16 h-16",
    // Hide on desktop (lg+) since search bar is always visible
    "lg:hidden",
    className
  );

  // State-based styling
  const stateClasses = cn(
    isRecording && "bg-destructive hover:bg-destructive/90 text-destructive-foreground scale-110",
    !isRecording && !showSuccess && "bg-primary hover:bg-primary/90 text-primary-foreground",
    showSuccess && "bg-green-500 hover:bg-green-600 text-white",
    isProcessing && "opacity-75 cursor-wait"
  );

  // When browser doesn't support voice, show command palette button only
  if (!isBrowserSupported) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={openPalette}
              className={cn(
                "fixed z-50 flex items-center justify-center rounded-full shadow-lg transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-primary/50",
                "bottom-20 right-4 lg:bottom-6 w-16 h-16",
                "bg-primary hover:bg-primary/90 text-primary-foreground",
                // Hide on desktop (lg+) since search bar is always visible
                "lg:hidden",
                className
              )}
              aria-label="Open command palette"
            >
              <Command className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            <p className="text-sm">Command Palette (⌘K)</p>
            <p className="text-xs text-muted-foreground mt-1">
              Voice not supported in this browser
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleToggle}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              disabled={isProcessing}
              className={cn(positionClasses, stateClasses)}
              aria-label={isRecording ? "Stop recording" : "Tap for voice, long-press for commands"}
            >
              {isProcessing ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : showSuccess ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : isRecording ? (
                <>
                  <Square className="h-6 w-6" />
                  <span className="absolute inset-0 rounded-full animate-ping bg-destructive/50" />
                </>
              ) : (
                <Mic className={cn("transition-all", isScrolled ? "h-5 w-5" : "h-6 w-6")} />
              )}

              {/* Daily capture count badge */}
              {!isRecording && !showSuccess && captureCount > 0 && !isScrolled && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background text-xs font-bold text-foreground border border-primary">
                  {captureCount}
                </span>
              )}

              {/* Breathing animation when idle */}
              {!isRecording && !showSuccess && !isProcessing && (
                <span className="absolute inset-0 rounded-full animate-pulse bg-primary/20" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[200px]">
            {isRecording ? (
              <p className="text-sm">Tap to stop recording</p>
            ) : (
              <>
                <p className="text-sm font-medium">Voice Capture</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tap to record • Long-press for commands (⌘K)
                </p>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Error message */}
      {error && (
        <div className="fixed bottom-36 right-4 lg:bottom-24 z-50 max-w-[280px] bg-destructive/10 border border-destructive/20 rounded-lg p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs text-destructive hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
