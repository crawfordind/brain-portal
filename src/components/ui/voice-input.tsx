"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Square, Loader2 } from "lucide-react";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  disabled?: boolean;
  className?: string;
  continuous?: boolean;
  language?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "floating";
  /** Minimum confidence threshold (0-1) for accepting results. Default: 0.7 */
  confidenceThreshold?: number;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((ev: Event) => void) | null;
  onend: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onspeechend: ((ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export function VoiceInput({
  onTranscript,
  onInterimTranscript,
  disabled = false,
  className,
  continuous = true,
  language = "en-US",
  size = "default",
  variant = "default",
  confidenceThreshold = 0.7,
}: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Track which result indices have been processed to prevent duplicates
  const processedResultsRef = useRef<Set<number>>(new Set());
  // Track the last final transcript to prevent exact duplicates
  const lastTranscriptRef = useRef<string>("");

  // Check for browser support
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      setError("Speech recognition not supported in this browser");
    }
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setError(null);
    setInterimText("");
    // Reset tracking on new session
    processedResultsRef.current = new Set();
    lastTranscriptRef.current = "";

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      const newFinalTranscripts: string[] = [];

      // Process all results, but only emit finals that haven't been processed
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        const confidence = result[0].confidence;

        if (result.isFinal) {
          // Skip if we've already processed this result index
          if (processedResultsRef.current.has(i)) {
            continue;
          }

          // Skip low confidence results (if confidence is available)
          // Note: confidence can be 0 in some browsers, so we check if it's defined and > 0
          if (confidence !== undefined && confidence > 0 && confidence < confidenceThreshold) {
            continue;
          }

          // Skip exact duplicates of the last transcript
          if (transcript && transcript !== lastTranscriptRef.current) {
            processedResultsRef.current.add(i);
            lastTranscriptRef.current = transcript;
            newFinalTranscripts.push(transcript);
          }
        } else {
          // Only show interim for non-finalized results
          if (!processedResultsRef.current.has(i)) {
            interimTranscript += transcript + " ";
          }
        }
      }

      // Update interim display
      const trimmedInterim = interimTranscript.trim();
      if (trimmedInterim) {
        setInterimText(trimmedInterim);
        onInterimTranscript?.(trimmedInterim);
      }

      // Emit all new final transcripts (usually just one)
      if (newFinalTranscripts.length > 0) {
        setInterimText("");
        // Join multiple transcripts with space if there are multiple
        const combined = newFinalTranscripts.join(" ").trim();
        if (combined) {
          onTranscript(combined);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
      recognitionRef.current = null;

      switch (event.error) {
        case "not-allowed":
          setError("Microphone access denied. Please allow microphone access.");
          break;
        case "no-speech":
          setError("No speech detected. Please try again.");
          break;
        case "network":
          setError("Network error. Please check your connection.");
          break;
        case "aborted":
          // User stopped, not an error
          break;
        default:
          setError(`Error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [continuous, language, onTranscript, onInterimTranscript, confidenceThreshold]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText("");
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  if (!isSupported) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size === "lg" ? "icon-lg" : size === "sm" ? "icon-sm" : "icon"}
        disabled
        className={cn("opacity-50 cursor-not-allowed", className)}
        title="Voice input not supported in this browser"
      >
        <MicOff className="h-4 w-4" />
      </Button>
    );
  }

  // MOBILE: Floating variant for quick voice capture
  if (variant === "floating") {
    return (
      <div className={cn("relative", className)}>
        <button
          type="button"
          onClick={toggleListening}
          disabled={disabled}
          className={cn(
            // BOTTOM-NAV: Position above bottom nav on mobile (24), normal on desktop (6)
            "fixed bottom-24 right-4 lg:bottom-6 z-50 flex items-center justify-center",
            "w-16 h-16 rounded-full shadow-lg",
            "transition-all duration-200 ease-in-out",
            "focus:outline-none focus:ring-4 focus:ring-primary/50",
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white scale-110"
              : "bg-primary hover:bg-primary/90 text-primary-foreground",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          title={isListening ? "Stop recording" : "Start voice capture"}
        >
          {isListening ? (
            <>
              <Square className="h-6 w-6" />
              <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-50" />
            </>
          ) : (
            <Mic className="h-6 w-6" />
          )}
        </button>

        {/* Interim transcript bubble */}
        {isListening && interimText && (
          // BOTTOM-NAV: Position above floating button
          <div className="fixed bottom-44 right-4 lg:bottom-28 z-50 max-w-[280px] bg-background border rounded-lg p-3 shadow-lg animate-in fade-in slide-in-from-bottom-2">
            <p className="text-sm text-muted-foreground italic">{interimText}...</p>
          </div>
        )}

        {error && (
          // BOTTOM-NAV: Position above floating button
          <div className="fixed bottom-44 right-4 lg:bottom-28 z-50 max-w-[280px] bg-destructive/10 border border-destructive/20 rounded-lg p-3 shadow-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // Default inline variant
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <Button
        type="button"
        variant={isListening ? "destructive" : "outline"}
        size={size === "lg" ? "icon-lg" : size === "sm" ? "icon-sm" : "icon"}
        onClick={toggleListening}
        disabled={disabled}
        className={cn(
          "relative",
          isListening && "animate-pulse"
        )}
        title={isListening ? "Stop recording" : "Start voice input"}
      >
        {isListening ? (
          <Square className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {isListening && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
        )}
      </Button>

      {isListening && interimText && (
        <span className="text-sm text-muted-foreground italic max-w-[200px] truncate">
          {interimText}...
        </span>
      )}

      {error && !isListening && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}

export function useVoiceInput(options?: {
  onTranscript?: (text: string) => void;
  continuous?: boolean;
  language?: string;
  confidenceThreshold?: number;
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Track processed results to prevent duplicates
  const processedResultsRef = useRef<Set<number>>(new Set());
  const lastTranscriptRef = useRef<string>("");

  const isSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const confidenceThreshold = options?.confidenceThreshold ?? 0.7;

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Speech recognition not supported");
      return;
    }

    // Reset tracking on new session
    processedResultsRef.current = new Set();
    lastTranscriptRef.current = "";

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = options?.continuous ?? true;
    recognition.interimResults = true;
    recognition.lang = options?.language ?? "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const newFinalTranscripts: string[] = [];

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        const confidence = result[0].confidence;

        if (result.isFinal) {
          // Skip already processed results
          if (processedResultsRef.current.has(i)) {
            continue;
          }

          // Skip low confidence results
          if (confidence !== undefined && confidence > 0 && confidence < confidenceThreshold) {
            continue;
          }

          // Skip exact duplicates
          if (text && text !== lastTranscriptRef.current) {
            processedResultsRef.current.add(i);
            lastTranscriptRef.current = text;
            newFinalTranscripts.push(text);
          }
        }
      }

      if (newFinalTranscripts.length > 0) {
        const combined = newFinalTranscripts.join(" ").trim();
        if (combined) {
          setTranscript((prev) => (prev ? `${prev} ${combined}` : combined));
          options?.onTranscript?.(combined);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(event.error);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, options, confidenceThreshold]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    processedResultsRef.current = new Set();
    lastTranscriptRef.current = "";
  }, []);

  return {
    isListening,
    transcript,
    error,
    isSupported: !!isSupported,
    startListening,
    stopListening,
    clearTranscript,
  };
}
