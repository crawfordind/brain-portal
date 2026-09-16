/**
 * Voice System Integration Tests
 *
 * These tests verify that all voice components are properly integrated
 * and can be imported/used without errors.
 */

import { describe, it, expect } from 'vitest';

describe('Voice System Integration', () => {
  it('should export all main components', async () => {
    const voiceModule = await import('../index');

    expect(voiceModule.VoiceFAB).toBeDefined();
    expect(voiceModule.VoiceTranscriptBubble).toBeDefined();
    expect(voiceModule.VoiceCommandPalette).toBeDefined();
    expect(voiceModule.VoiceOnboarding).toBeDefined();
    expect(voiceModule.VoiceSettingsPanel).toBeDefined();
    expect(voiceModule.EditorVoiceButton).toBeDefined();
    expect(voiceModule.VoiceProvider).toBeDefined();
  });

  it('should export all hooks', async () => {
    const voiceModule = await import('../index');

    expect(voiceModule.useVoiceCommands).toBeDefined();
    expect(voiceModule.useSmartPunctuation).toBeDefined();
    expect(voiceModule.useVoiceShortcuts).toBeDefined();
    expect(voiceModule.useVoiceShortcutInfo).toBeDefined();
    expect(voiceModule.useAudioFeedback).toBeDefined();
    expect(voiceModule.useVoiceStore).toBeDefined();
  });

  it('should have voice store with correct initial state', async () => {
    const { useVoiceStore } = await import('../index');
    const store = useVoiceStore.getState();

    expect(store.isRecording).toBe(false);
    expect(store.isPaused).toBe(false);
    expect(store.isProcessing).toBe(false);
    expect(store.interimTranscript).toBe('');
    expect(store.finalTranscript).toBe('');
    expect(store.recordingContext).toBe(null);
    expect(store.settings).toBeDefined();
    expect(store.settings.language).toBe('en-US');
    expect(store.settings.continuousMode).toBe(true);
    expect(store.settings.autoPunctuation).toBe(true);
    expect(store.settings.confidenceThreshold).toBe(0.7);
  });

  it('should have voice commands defined', async () => {
    const { useVoiceCommands } = await import('../hooks/use-voice-commands');

    // Import the hook in a non-React context (just to verify structure)
    // In a real test, we'd use renderHook from @testing-library/react
    expect(useVoiceCommands).toBeDefined();
    expect(typeof useVoiceCommands).toBe('function');
  });

  it('should have smart punctuation rules', async () => {
    const { useSmartPunctuation } = await import('../hooks/use-smart-punctuation');

    expect(useSmartPunctuation).toBeDefined();
    expect(typeof useSmartPunctuation).toBe('function');
  });
});
