"use client";

import * as React from "react";
import { useCallback, useRef } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useAudioFeedback } from "./hooks/use-audio-feedback";
import { useSmartPunctuation } from "./hooks/use-smart-punctuation";
import type { Editor } from "@tiptap/react";

interface EditorVoiceButtonProps {
  editor: Editor;
  className?: string;
}

export function EditorVoiceButton({ editor, className }: EditorVoiceButtonProps) {
  const {
    isRecording,
    recordingContext,
    settings,
    startRecording,
    stopRecording,
    updateTranscript,
    setError,
  } = useVoiceStore();

  const { playFeedback } = useAudioFeedback();
  const { processVoiceTranscript } = useSmartPunctuation({
    enabled: settings.autoPunctuation,
    confidenceThreshold: settings.confidenceThreshold,
  });

  const recognitionRef = useRef<any>(null);
  const isEditorRecording = isRecording && recordingContext === 'note-editor';

  const handleStartRecording = useCallback(() => {
    if (typeof window === 'undefined' || !editor) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported');
      return;
    }

    // Get current cursor position
    const { from } = editor.state.selection;

    const recognition = new SpeechRecognition();
    recognition.continuous = settings.continuousMode;
    recognition.interimResults = settings.showInterim;
    recognition.lang = settings.language;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      startRecording('note-editor');
      playFeedback('start');
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const confidence = result[0].confidence;

        // Skip low confidence
        if (confidence !== undefined && confidence > 0 && confidence < settings.confidenceThreshold) {
          continue;
        }

        if (result.isFinal) {
          final = transcript;
        } else if (settings.showInterim) {
          interim += transcript;
        }
      }

      if (final) {
        // Apply auto-punctuation
        const processed = processVoiceTranscript(final, false);

        // Insert at cursor position
        const currentPos = editor.state.selection.from;
        editor.commands.insertContentAt(currentPos, processed + ' ');

        // Move cursor to end of inserted text
        editor.commands.focus();

        updateTranscript('', processed);
      } else if (interim) {
        updateTranscript(interim);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
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
    recognition.start();
  }, [
    editor,
    settings,
    startRecording,
    stopRecording,
    updateTranscript,
    setError,
    playFeedback,
    processVoiceTranscript,
  ]);

  const handleStopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    playFeedback('stop');
    stopRecording();
  }, [stopRecording, playFeedback]);

  const handleToggle = useCallback(() => {
    if (isEditorRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isEditorRecording, handleStartRecording, handleStopRecording]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onMouseDown={(e) => {
        e.preventDefault();
        handleToggle();
      }}
      title={isEditorRecording ? "Stop voice input" : "Start voice input"}
      className={cn(
        "h-10 w-10 p-0 md:h-8 md:w-8 shrink-0",
        isEditorRecording && "bg-destructive/10 text-destructive hover:bg-destructive/20",
        className
      )}
    >
      {isEditorRecording ? (
        <>
          <Square className="h-4 w-4" />
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-destructive rounded-full animate-pulse" />
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </Button>
  );
}
