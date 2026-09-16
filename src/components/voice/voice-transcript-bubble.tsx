"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { Edit2, X, ArrowUp, FileText, Inbox, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useVoiceStore } from "@/lib/stores/voice-store";

interface VoiceTranscriptBubbleProps {
  className?: string;
  onEdit?: (text: string) => void;
  onDismiss?: () => void;
  onExpand?: () => void;
}

export function VoiceTranscriptBubble({
  className,
  onEdit,
  onDismiss,
  onExpand,
}: VoiceTranscriptBubbleProps) {
  const { isRecording, interimTranscript, finalTranscript, cancelRecording, saveMode, setSaveMode } = useVoiceStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const bubbleRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const displayText = finalTranscript || interimTranscript;
  const isFinal = !!finalTranscript;

  // Auto-focus textarea when editing
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  // Initialize edited text
  useEffect(() => {
    if (displayText && !isEditing) {
      setEditedText(displayText);
    }
  }, [displayText, isEditing]);

  // Touch gesture handling for swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
    };

    const deltaX = touchEnd.x - touchStartRef.current.x;
    const deltaY = touchEnd.y - touchStartRef.current.y;

    // Swipe down to dismiss
    if (deltaY > 50 && Math.abs(deltaX) < 30) {
      handleDismiss();
    }

    // Swipe up to expand
    if (deltaY < -50 && Math.abs(deltaX) < 30) {
      handleExpand();
    }

    touchStartRef.current = null;
  };

  const handleDismiss = () => {
    if (onDismiss) {
      onDismiss();
    } else {
      cancelRecording();
    }
  };

  const handleExpand = () => {
    if (onExpand) {
      onExpand();
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (onEdit && editedText) {
      onEdit(editedText);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedText(displayText);
    setIsEditing(false);
  };

  if (!isRecording && !displayText) {
    return null;
  }

  return (
    <div
      ref={bubbleRef}
      className={cn(
        "fixed z-50 max-w-[280px] lg:max-w-[320px] rounded-lg border shadow-lg",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        // Position above FAB
        "bottom-36 right-4 lg:bottom-28",
        "bg-background/95 backdrop-blur-sm",
        className
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Swipe indicator */}
      <div className="flex justify-center pt-2 pb-1">
        <div className="h-1 w-12 rounded-full bg-muted-foreground/20" />
      </div>

      <div className="p-3 space-y-2">
        {isEditing ? (
          // Edit mode
          <div className="space-y-2">
            <textarea
              ref={textareaRef}
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full min-h-[60px] p-2 text-sm rounded border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Edit transcript..."
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleSaveEdit}
                className="flex-1"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelEdit}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          // Display mode
          <>
            <div className="max-h-[120px] overflow-y-auto">
              <p
                className={cn(
                  "text-sm",
                  isFinal ? "font-medium text-foreground" : "italic text-muted-foreground"
                )}
              >
                {displayText}
                {!isFinal && <span className="animate-pulse">...</span>}
              </p>
            </div>

            {/* Save mode toggle */}
            {isFinal && (
              <div className="flex items-center gap-1 pt-1 border-t">
                <button
                  onClick={() => setSaveMode('note')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors",
                    saveMode === 'note'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Mic className="h-3 w-3" />
                  Voice Note
                </button>
                <button
                  onClick={() => setSaveMode('capture')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors",
                    saveMode === 'capture'
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Inbox className="h-3 w-3" />
                  Quick Capture
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1 pt-1 border-t">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleEdit}
                className="flex-1 h-8 text-xs"
              >
                <Edit2 className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExpand}
                className="flex-1 h-8 text-xs"
              >
                <ArrowUp className="h-3 w-3 mr-1" />
                Expand
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                className="h-8 w-8 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Help text */}
      {!isEditing && (
        <div className="px-3 pb-2 text-[10px] text-muted-foreground text-center">
          {isFinal
            ? saveMode === 'note'
              ? 'Saves as a voice note with TL;DR'
              : 'Saves to inbox as a quick capture'
            : 'Listening...'}
        </div>
      )}
    </div>
  );
}
