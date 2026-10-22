"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { X, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVoiceStore } from "@/lib/stores/voice-store";

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

/**
 * Progressive voice tips, shown after the user has started using voice.
 *
 * The first-visit welcome used to be a full-screen modal here. It is now the
 * dismissible `VoiceIntroCard` on the dashboard, which is what sets
 * `onboardingComplete`, so tips only begin once the user has met the feature.
 */
export function VoiceOnboarding() {
  const {
    onboardingComplete,
    tipsShown,
    captureCount,
    addTipShown,
  } = useVoiceStore();

  const [currentTip, setCurrentTip] = useState<typeof TIPS[0] | null>(null);

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

  // Progressive tip
  if (currentTip) {
    return (
      <div className="fixed bottom-[calc(var(--mobile-nav-height)+3.75rem)] right-4 lg:bottom-24 z-50 max-w-sm animate-in slide-in-from-bottom-2 fade-in">
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
