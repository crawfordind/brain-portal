"use client";

import * as React from "react";
import { Mic, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useVoiceStore } from "@/lib/stores/voice-store";
import { useVoiceShortcutInfo } from "./hooks/use-voice-shortcuts";

interface VoiceSettingsPanelProps {
  className?: string;
}

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'it-IT', label: 'Italian (Italy)' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'pt-PT', label: 'Portuguese (Portugal)' },
  { value: 'ja-JP', label: 'Japanese (Japan)' },
  { value: 'ko-KR', label: 'Korean (Korea)' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'zh-TW', label: 'Chinese (Traditional)' },
];

export function VoiceSettingsPanel({ className }: VoiceSettingsPanelProps) {
  const { settings, updateSettings } = useVoiceStore();
  const { formatShortcut } = useVoiceShortcutInfo();

  const handleLanguageChange = (value: string) => {
    updateSettings({ language: value });
  };

  const handleConfidenceChange = (value: number[]) => {
    updateSettings({ confidenceThreshold: value[0] / 100 });
  };

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            <CardTitle>Voice Input Settings</CardTitle>
          </div>
          <CardDescription>
            Configure how voice input works for you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Language */}
          <div className="space-y-2">
            <Label htmlFor="language">Language</Label>
            <Select value={settings.language} onValueChange={handleLanguageChange}>
              <SelectTrigger id="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Continuous mode */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="continuous-mode">Continuous mode</Label>
              <p className="text-sm text-muted-foreground">
                Keep listening until you stop recording
              </p>
            </div>
            <Switch
              id="continuous-mode"
              checked={settings.continuousMode}
              onCheckedChange={(checked) => updateSettings({ continuousMode: checked })}
            />
          </div>

          {/* Auto-punctuation */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="auto-punctuation">Auto-punctuation</Label>
              <p className="text-sm text-muted-foreground">
                Automatically add punctuation based on speech patterns
              </p>
            </div>
            <Switch
              id="auto-punctuation"
              checked={settings.autoPunctuation}
              onCheckedChange={(checked) => updateSettings({ autoPunctuation: checked })}
            />
          </div>

          {/* Confidence threshold */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="confidence-threshold">
                Confidence threshold
              </Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(settings.confidenceThreshold * 100)}%
              </span>
            </div>
            <Slider
              id="confidence-threshold"
              min={50}
              max={95}
              step={5}
              value={[settings.confidenceThreshold * 100]}
              onValueChange={handleConfidenceChange}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values filter out less confident transcriptions
            </p>
          </div>

          {/* Voice commands */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="voice-commands">Voice commands</Label>
              <p className="text-sm text-muted-foreground">
                Enable natural language commands
              </p>
            </div>
            <Switch
              id="voice-commands"
              checked={settings.voiceCommands}
              onCheckedChange={(checked) => updateSettings({ voiceCommands: checked })}
            />
          </div>

          {/* Show interim results */}
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="show-interim">Show interim results</Label>
              <p className="text-sm text-muted-foreground">
                Display live transcription as you speak
              </p>
            </div>
            <Switch
              id="show-interim"
              checked={settings.showInterim}
              onCheckedChange={(checked) => updateSettings({ showInterim: checked })}
            />
          </div>

          <Separator />

          {/* Keyboard shortcut (read-only display) */}
          <div className="space-y-2">
            <Label>Keyboard shortcut</Label>
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted">
              <code className="text-sm font-mono">
                {formatShortcut(settings.keyboardShortcut)}
              </code>
              <Info className="h-4 w-4 text-muted-foreground ml-auto" />
            </div>
            <p className="text-xs text-muted-foreground">
              Global shortcut to start/stop voice capture
            </p>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Advanced</h3>

            {/* Wake word */}
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label htmlFor="wake-word">Wake word</Label>
                <p className="text-sm text-muted-foreground">
                  Say &quot;Hey Brain&quot; to activate (experimental)
                </p>
              </div>
              <Switch
                id="wake-word"
                checked={settings.wakeWord}
                onCheckedChange={(checked) => updateSettings({ wakeWord: checked })}
                disabled
              />
            </div>

            {/* Audio feedback */}
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label htmlFor="audio-feedback">Audio feedback</Label>
                <p className="text-sm text-muted-foreground">
                  Play sounds on start, stop, and errors
                </p>
              </div>
              <Switch
                id="audio-feedback"
                checked={settings.audioFeedback}
                onCheckedChange={(checked) => updateSettings({ audioFeedback: checked })}
              />
            </div>
          </div>

          {/* Privacy notice */}
          <div className="flex gap-2 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground mb-1">Privacy</p>
              <p className="text-xs">
                Voice recordings are processed in your browser and never saved.
                Only the transcribed text is stored.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
