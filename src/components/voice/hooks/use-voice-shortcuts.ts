"use client";

import { useEffect, useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useVoiceStore } from '@/lib/stores/voice-store';

export interface VoiceShortcutOptions {
  enabled?: boolean;
  enableGlobal?: boolean;
  enableContextual?: boolean;
}

export function useVoiceShortcuts(options: VoiceShortcutOptions = {}) {
  const {
    enabled = true,
    enableGlobal = true,
    enableContextual = true,
  } = options;

  const {
    isRecording,
    startRecording,
    stopRecording,
    cancelRecording,
    settings,
  } = useVoiceStore();

  // Global quick capture shortcut (Cmd/Ctrl + Shift + V)
  useHotkeys(
    settings.keyboardShortcut || 'mod+shift+v',
    (event) => {
      event.preventDefault();
      if (isRecording) {
        stopRecording();
      } else {
        startRecording('global');
      }
    },
    {
      enabled: enabled && enableGlobal,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
    },
    [isRecording, startRecording, stopRecording, settings.keyboardShortcut]
  );

  // Escape to cancel recording
  useHotkeys(
    'escape',
    (event) => {
      if (isRecording) {
        event.preventDefault();
        cancelRecording();
      }
    },
    {
      enabled: enabled && isRecording,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
    },
    [isRecording, cancelRecording]
  );

  // Cmd/Ctrl + Enter to stop and save
  useHotkeys(
    'mod+enter',
    (event) => {
      if (isRecording) {
        event.preventDefault();
        stopRecording();
      }
    },
    {
      enabled: enabled && enableContextual && isRecording,
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
    },
    [isRecording, stopRecording]
  );

  return {
    isRecording,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

// Separate hook for providing shortcut info/help
export function useVoiceShortcutInfo() {
  const { settings } = useVoiceStore();

  const shortcuts = [
    {
      key: settings.keyboardShortcut || 'mod+shift+v',
      description: 'Toggle voice recording (global quick capture)',
      context: 'global',
    },
    {
      key: 'escape',
      description: 'Cancel recording',
      context: 'recording',
    },
    {
      key: 'mod+enter',
      description: 'Stop recording and save',
      context: 'recording',
    },
  ];

  const formatShortcut = useCallback((key: string): string => {
    // Convert 'mod' to platform-specific key
    const isMac = typeof window !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
    return key
      .replace(/mod/gi, isMac ? '⌘' : 'Ctrl')
      .replace(/shift/gi, isMac ? '⇧' : 'Shift')
      .replace(/alt/gi, isMac ? '⌥' : 'Alt')
      .replace(/\+/g, isMac ? '' : '+');
  }, []);

  return {
    shortcuts,
    formatShortcut,
  };
}
