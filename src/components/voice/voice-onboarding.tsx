"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Mic, X, ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useVoiceShortcutInfo } from "./hooks/use-voice-shortcuts";

interface VoiceOnboardingProps {
  onComplete?: () => void;
  autoShow?: boolean;
}

const TIPS = [
  {
    id: 'punctuation',
    title: 'Say "period" for punctuation',
    description: 'You can say punctuation marks like "period", "comma", "question mark" to add them to your transcript.',
  },
  {
    id: 'keyboard-shortcut',
    title: 'Quick keyboard shortcut',
    description: 'Press ⌘⇧V (or Ctrl+Shift+V) to start voice capture from anywhere.',
  },
  {
    id: 'edit-bubble',
    title: 'Edit before saving',
    description: 'Tap the transcript bubble to edit the text before it\'s saved.',
  },
  {
    id: 'add-to-today',
    title: 'Voice commands',
    description: 'Say "add to today" to add content to your daily note, or "create task to..." to create a task.',
  },
];

export function VoiceOnboarding({ onComplete, autoShow = true }: VoiceOnboardingProps) {
  const {
    onboardingComplete,
    tipsShown,
    captureCount,
    markOnboardingComplete,
    addTipShown,
  } = useVoiceStore();

  const { formatShortcut } = useVoiceShortcutInfo();

  const [showWelcome, setShowWelcome] = useState(false);
  const [currentTip, setCurrentTip] = useState<typeof TIPS[0] | null>(null);

  // Show welcome dialog on first visit
  useEffect(() => {
    if (!onboardingComplete && autoShow) {
      // Show after a short delay
      const timer = setTimeout(() => {
        setShowWelcome(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [onboardingComplete, autoShow]);

  // Show progressive tips after successful captures
  useEffect(() => {
    if (onboardingComplete && captureCount > 0) {
      // Show a tip after every 3 captures (but only if not shown before)
      if (captureCount % 3 === 0) {
        const unshownTips = TIPS.filter(tip => !tipsShown.includes(tip.id));
        if (unshownTips.length > 0) {
          const randomTip = unshownTips[Math.floor(Math.random() * unshownTips.length)];
          setCurrentTip(randomTip);

          // Auto-dismiss after 10 seconds
          const timer = setTimeout(() => {
            setCurrentTip(null);
          }, 10000);

          return () => clearTimeout(timer);
        }
      }
    }
  }, [captureCount, onboardingComplete, tipsShown]);

  const handleTryIt = () => {
    setShowWelcome(false);
    markOnboardingComplete();
    if (onComplete) {
      onComplete();
    }
  };

  const handleMaybeLater = () => {
    setShowWelcome(false);
    markOnboardingComplete();
  };

  const handleDismissTip = () => {
    if (currentTip) {
      addTipShown(currentTip.id);
    }
    setCurrentTip(null);
  };

  const handleShowMoreCommands = () => {
    if (currentTip) {
      addTipShown(currentTip.id);
    }
    setCurrentTip(null);
    // This could open the command palette
    // For now, just dismiss
  };

  // Welcome dialog
  if (showWelcome) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in">
        <Card className="w-full max-w-md mx-4 shadow-lg animate-in zoom-in-95">
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Mic className="h-5 w-5 text-primary" />
              </div>
              <CardTitle>Try Voice Capture</CardTitle>
            </div>
            <CardDescription className="text-base">
              Tap the mic button and say anything — it&apos;s the fastest way to capture your thoughts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Quick tips:</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Say commands like &quot;create task to...&quot; or &quot;new note about...&quot;</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Use punctuation commands: &quot;period&quot;, &quot;comma&quot;, &quot;question mark&quot;</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Press {formatShortcut('mod+shift+v')} for quick capture</span>
                </li>
              </ul>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleTryIt} className="flex-1">
                <Mic className="h-4 w-4 mr-2" />
                Try It Now
              </Button>
              <Button onClick={handleMaybeLater} variant="outline" className="flex-1">
                Maybe Later
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Progressive tip
  if (currentTip) {
    return (
      <div className="fixed bottom-32 right-4 lg:bottom-24 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in">
        <Card className="shadow-lg border-2">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">Voice Tip</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismissTip}
                className="h-6 w-6 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-sm">{currentTip.description}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleShowMoreCommands}
                className="flex-1 text-xs"
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                Show Commands
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismissTip}
                className="flex-1 text-xs"
              >
                Got It
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
