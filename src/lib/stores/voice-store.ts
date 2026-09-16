import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoiceSettings {
  language: string;
  continuousMode: boolean;
  autoPunctuation: boolean;
  confidenceThreshold: number;
  voiceCommands: boolean;
  keyboardShortcut: string;
  showInterim: boolean;
  wakeWord: boolean;
  audioFeedback: boolean;
}

export type RecordingContext = 'global' | 'note-editor' | 'form' | null;
export type VoiceSaveMode = 'note' | 'capture';

export interface VoiceState {
  // Recording state
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;

  // Content
  interimTranscript: string;
  finalTranscript: string;

  // Context
  recordingContext: RecordingContext;
  targetNoteId?: string;
  targetFieldId?: string;

  // Save mode - determines if voice input saves as a note or capture
  saveMode: VoiceSaveMode;

  // Settings
  settings: VoiceSettings;

  // Onboarding
  onboardingComplete: boolean;
  tipsShown: string[];
  captureCount: number;

  // Error state
  error: string | null;

  // Actions
  startRecording: (context?: RecordingContext, targetId?: string) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
  updateTranscript: (interim: string, final?: string) => void;
  replaceFinalTranscript: (text: string) => void;
  setProcessing: (processing: boolean) => void;
  setError: (error: string | null) => void;
  clearTranscript: () => void;
  setSaveMode: (mode: VoiceSaveMode) => void;
  updateSettings: (settings: Partial<VoiceSettings>) => void;
  markOnboardingComplete: () => void;
  addTipShown: (tipId: string) => void;
  incrementCaptureCount: () => void;
  reset: () => void;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  language: 'en-US',
  continuousMode: true,
  autoPunctuation: true,
  confidenceThreshold: 0.7,
  voiceCommands: true,
  keyboardShortcut: 'mod+shift+v',
  showInterim: true,
  wakeWord: false,
  audioFeedback: true,
};

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      // Initial state
      isRecording: false,
      isPaused: false,
      isProcessing: false,
      interimTranscript: '',
      finalTranscript: '',
      recordingContext: null,
      targetNoteId: undefined,
      targetFieldId: undefined,
      saveMode: 'note' as VoiceSaveMode,
      settings: DEFAULT_SETTINGS,
      onboardingComplete: false,
      tipsShown: [],
      captureCount: 0,
      error: null,

      // Actions
      startRecording: (context = 'global', targetId) => {
        set({
          isRecording: true,
          isPaused: false,
          recordingContext: context,
          targetNoteId: context === 'note-editor' ? targetId : undefined,
          targetFieldId: context === 'form' ? targetId : undefined,
          interimTranscript: '',
          finalTranscript: '',
          error: null,
        });
      },

      stopRecording: () => {
        set({
          isRecording: false,
          isPaused: false,
          recordingContext: null,
          targetNoteId: undefined,
          targetFieldId: undefined,
        });
      },

      pauseRecording: () => {
        set({ isPaused: true });
      },

      resumeRecording: () => {
        set({ isPaused: false });
      },

      cancelRecording: () => {
        set({
          isRecording: false,
          isPaused: false,
          isProcessing: false,
          recordingContext: null,
          targetNoteId: undefined,
          targetFieldId: undefined,
          interimTranscript: '',
          finalTranscript: '',
          error: null,
        });
      },

      updateTranscript: (interim, final) => {
        const updates: Partial<VoiceState> = { interimTranscript: interim };

        if (final !== undefined) {
          const currentFinal = get().finalTranscript;

          // Check if the new final already contains the current final (cumulative transcript)
          // If so, replace instead of append to avoid duplicates
          if (currentFinal && final.toLowerCase().startsWith(currentFinal.toLowerCase())) {
            updates.finalTranscript = final;
          } else {
            updates.finalTranscript = currentFinal ? `${currentFinal} ${final}` : final;
          }
          updates.interimTranscript = '';
        }

        set(updates);
      },

      replaceFinalTranscript: (text) => {
        set({ finalTranscript: text });
      },

      setProcessing: (processing) => {
        set({ isProcessing: processing });
      },

      setError: (error) => {
        set({ error });
      },

      clearTranscript: () => {
        set({
          interimTranscript: '',
          finalTranscript: '',
        });
      },

      setSaveMode: (mode) => {
        set({ saveMode: mode });
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      markOnboardingComplete: () => {
        set({ onboardingComplete: true });
      },

      addTipShown: (tipId) => {
        set((state) => ({
          tipsShown: [...state.tipsShown, tipId],
        }));
      },

      incrementCaptureCount: () => {
        set((state) => ({
          captureCount: state.captureCount + 1,
        }));
      },

      reset: () => {
        set({
          isRecording: false,
          isPaused: false,
          isProcessing: false,
          interimTranscript: '',
          finalTranscript: '',
          recordingContext: null,
          targetNoteId: undefined,
          targetFieldId: undefined,
          error: null,
        });
      },
    }),
    {
      name: 'voice-storage',
      partialize: (state) => ({
        settings: state.settings,
        onboardingComplete: state.onboardingComplete,
        tipsShown: state.tipsShown,
        captureCount: state.captureCount,
      }),
      // Skip persistence during SSR to prevent hydration mismatches
      skipHydration: true,
    }
  )
);
