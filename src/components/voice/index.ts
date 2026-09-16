// Main components
export { VoiceFAB } from './voice-fab';
export { VoiceTranscriptBubble } from './voice-transcript-bubble';
export { VoiceCommandPalette } from './voice-command-palette';
export { VoiceOnboarding } from './voice-onboarding';
export { VoiceSettingsPanel } from './voice-settings-panel';
export { EditorVoiceButton } from './editor-voice-button';
export { VoiceProvider } from './voice-provider';

// Hooks
export { useVoiceCommands } from './hooks/use-voice-commands';
export { useSmartPunctuation } from './hooks/use-smart-punctuation';
export { useVoiceShortcuts, useVoiceShortcutInfo } from './hooks/use-voice-shortcuts';
export { useAudioFeedback } from './hooks/use-audio-feedback';

// Store
export { useVoiceStore } from '@/lib/stores/voice-store';

// Types
export type { VoiceCommand, CommandCategory } from './hooks/use-voice-commands';
export type { VoiceSettings, RecordingContext, VoiceState } from '@/lib/stores/voice-store';
