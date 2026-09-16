"use client";

/**
 * Brain Bar - The Universal Input for Brain Portal
 *
 * This is the primary interaction point. One input for everything:
 * - Type a thought → AI classifies it
 * - Type a task → creates it
 * - Paste a URL → auto-scrapes and files
 *
 * The Brain Bar shows real-time classification as you type.
 *
 * It is for *capturing*, not for dispatching work. It used to carry a picker
 * for all 17 agents, and the classifier's suggested agent was applied
 * automatically, so typing a thought could start background work nobody asked
 * for. Getting AI help on something you captured is now "Ask about this" on
 * the item itself.
 */

import { useRef, useCallback, useEffect } from "react";
import { useStreamStore } from "@/lib/stores/stream-store";
import { cn } from "@/lib/utils";
import {
  Brain,
  Sparkles,
  Send,
  Loader2,
  Zap,
  FileText,
  CheckSquare,
  HelpCircle,
  Link,
  Bell,
  Lightbulb,
  GitFork,
  ChevronUp,
  Bot,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VoiceInput } from "@/components/ui/voice-input";
import { toast } from "sonner";
import type { IntentClassification, StreamItemType } from "@/lib/stream/types";

const TYPE_ICONS: Record<StreamItemType, typeof Brain> = {
  thought: Lightbulb,
  task: CheckSquare,
  note: FileText,
  journal: BookOpen,
  question: HelpCircle,
  decision: GitFork,
  reference: Link,
  insight: Sparkles,
  agent_output: Bot,
  reminder: Bell,
  capture: Zap,
};

const TYPE_COLORS: Record<StreamItemType, string> = {
  thought: "text-amber-500",
  task: "text-blue-500",
  note: "text-emerald-500",
  journal: "text-teal-500",
  question: "text-purple-500",
  decision: "text-orange-500",
  reference: "text-cyan-500",
  insight: "text-pink-500",
  agent_output: "text-indigo-500",
  reminder: "text-red-500",
  capture: "text-gray-500",
};

const TYPE_LABELS: Record<StreamItemType, string> = {
  thought: "Thought",
  task: "Task",
  note: "Note",
  journal: "Journal",
  question: "Question",
  decision: "Decision",
  reference: "Reference",
  insight: "Insight",
  agent_output: "Agent Output",
  reminder: "Reminder",
  capture: "Capture",
};

interface BrainBarProps {
  onSubmit?: () => void;
  variant?: "default" | "compact" | "fullscreen";
}

export function BrainBar({ onSubmit, variant = "default" }: BrainBarProps) {
  const {
    brainBarInput,
    setBrainBarInput,
    brainBarExpanded,
    setBrainBarExpanded,
    isClassifying,
    setIsClassifying,
    classification,
    setClassification,
    isSubmitting,
    setIsSubmitting,
    resetBrainBar,
  } = useStreamStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const classifyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, [brainBarInput]);

  // Classify with debounce
  const classifyInput = useCallback(
    async (input: string) => {
      if (input.trim().length < 3) {
        setClassification(null);
        return;
      }

      setIsClassifying(true);
      try {
        const res = await fetch("/api/stream/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: input.trim() }),
        });
        if (res.ok) {
          const data: IntentClassification = await res.json();
          setClassification(data);
        }
      } catch (error) {
        console.error("[BrainBar] Classification error:", error);
      } finally {
        setIsClassifying(false);
      }
    },
    [setClassification, setIsClassifying]
  );

  const handleInputChange = (value: string) => {
    setBrainBarInput(value);

    // Debounce classification
    if (classifyTimeoutRef.current) {
      clearTimeout(classifyTimeoutRef.current);
    }
    classifyTimeoutRef.current = setTimeout(() => {
      classifyInput(value);
    }, 600);
  };

  const handleSubmit = async () => {
    if (!brainBarInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = {
        type: classification?.type || "capture",
        title: classification?.title || brainBarInput.trim().slice(0, 60),
        content: classification?.content || brainBarInput.trim(),
        rawInput: brainBarInput.trim(),
        priority: classification?.priority || "medium",
        tags: classification?.tags || [],
        dueDate: classification?.dueDate,
        projectSlug: classification?.projectSlug,
        classification,
        sourceType: "manual",
      };

      const res = await fetch("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const typeLabel = TYPE_LABELS[classification?.type || "capture"];
        toast.success(`${typeLabel} captured`);
        resetBrainBar();
        onSubmit?.();
      } else {
        toast.error("Failed to save. Please try again.");
      }
    } catch {
      toast.error("Network error. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      resetBrainBar();
    }
  };

  const ClassificationIcon = classification ? TYPE_ICONS[classification.type] : Brain;
  const classificationColor = classification ? TYPE_COLORS[classification.type] : "text-muted-foreground";

  return (
    <div
      className={cn(
        "relative w-full",
        variant === "fullscreen" && "max-w-2xl mx-auto"
      )}
    >
      {/* Main Input Area */}
      <div
        className={cn(
          "relative rounded-2xl border bg-background shadow-sm transition-all duration-200",
          brainBarExpanded && "shadow-lg ring-2 ring-primary/20",
          "hover:shadow-md focus-within:shadow-lg focus-within:ring-2 focus-within:ring-primary/20"
        )}
      >
        {/* Classification indicator */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <div className={cn("transition-colors", classificationColor)}>
            {isClassifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClassificationIcon className="h-4 w-4" />
            )}
          </div>
          {classification && brainBarInput.trim().length > 2 ? (
            <span className={cn("text-xs font-medium", classificationColor)}>
              {TYPE_LABELS[classification.type]}
              {classification.confidence < 0.7 && " (unsure)"}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              What&apos;s on your mind?
            </span>
          )}

        </div>

        {/* Text input */}
        <div className="relative px-4 pb-2">
          <textarea
            ref={textareaRef}
            value={brainBarInput}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setBrainBarExpanded(true)}
            placeholder="Think, plan, capture, delegate... just start typing"
            className={cn(
              "w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60",
              "min-h-[36px] max-h-[200px]",
              variant === "fullscreen" && "text-base min-h-[48px]"
            )}
            rows={1}
          />
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1 px-3 pb-2">
          {/* Quick type buttons */}
          <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
            <VoiceInput
              onTranscript={(text) => {
                handleInputChange(brainBarInput ? `${brainBarInput} ${text}` : text);
              }}
              size="sm"
            />
          </div>

          {/* Submit button */}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!brainBarInput.trim() || isSubmitting}
            className={cn(
              "rounded-full h-8 px-3 transition-all",
              brainBarInput.trim() && "bg-primary"
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded: Classification details + suggested actions */}
      {brainBarExpanded && classification && brainBarInput.trim().length > 2 && (
        <div className="mt-2 rounded-xl border bg-background/95 backdrop-blur p-3 shadow-lg animate-in slide-in-from-top-2 duration-200">
          {/* Classification reasoning */}
          <p className="text-xs text-muted-foreground mb-2">
            {classification.reasoning}
          </p>

          {/*
            `classification.suggestedActions` used to render here as a row of
            buttons whose click handler was an empty block — visible controls
            that did nothing, which is worse than no controls at all. The
            classifier still returns them; they will come back as real
            post-capture actions ("Set a date", "File under…", "Ask about it")
            once those are wired to endpoints. Until then nothing is drawn.
            See docs/plans/2026-09-14-stream-dashboard-v2-design.md, R19.
          */}

          {/* Tags */}
          {classification.tags.length > 0 && (
            <div className="flex gap-1 mt-2">
              {classification.tags.map((tag, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  #{tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Collapse button */}
          <button
            onClick={() => setBrainBarExpanded(false)}
            className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronUp className="h-3 w-3" />
            Less
          </button>
        </div>
      )}

    </div>
  );
}
