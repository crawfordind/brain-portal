"use client";

import { useCallback, useRef, useEffect } from 'react';
import { useVoiceStore } from '@/lib/stores/voice-store';

export type FeedbackType = 'start' | 'stop' | 'command' | 'error' | 'success';
export type HapticPattern = 'light' | 'medium' | 'heavy' | 'error' | 'success';

// Simple audio feedback using Web Audio API
class AudioFeedback {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.gainNode.gain.value = 0.3; // 30% volume
      } catch (e) {
        console.warn('Web Audio API not supported:', e);
      }
    }
  }

  playTone(frequency: number, duration: number, type: OscillatorType = 'sine') {
    if (!this.audioContext || !this.gainNode) return;

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.gainNode);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      // Envelope
      const now = this.audioContext.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

      oscillator.start(now);
      oscillator.stop(now + duration);
    } catch (e) {
      console.warn('Error playing tone:', e);
    }
  }

  playStart() {
    // Rising tone: C5 to E5
    this.playTone(523.25, 0.1);
    setTimeout(() => this.playTone(659.25, 0.1), 50);
  }

  playStop() {
    // Falling tone: E5 to C5
    this.playTone(659.25, 0.1);
    setTimeout(() => this.playTone(523.25, 0.1), 50);
  }

  playCommand() {
    // Quick ascending arpeggio
    this.playTone(523.25, 0.08); // C5
    setTimeout(() => this.playTone(659.25, 0.08), 60); // E5
    setTimeout(() => this.playTone(783.99, 0.08), 120); // G5
  }

  playError() {
    // Descending dissonant tone
    this.playTone(200, 0.15, 'sawtooth');
    setTimeout(() => this.playTone(150, 0.2, 'sawtooth'), 80);
  }

  playSuccess() {
    // Cheerful ascending tone
    this.playTone(523.25, 0.1); // C5
    setTimeout(() => this.playTone(659.25, 0.1), 80); // E5
    setTimeout(() => this.playTone(783.99, 0.15), 140); // G5
  }
}

// Haptic feedback for mobile devices
class HapticFeedback {
  vibrate(pattern: number | number[]) {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        console.warn('Vibration not supported:', e);
      }
    }
  }

  light() {
    this.vibrate(10);
  }

  medium() {
    this.vibrate(20);
  }

  heavy() {
    this.vibrate(40);
  }

  error() {
    this.vibrate([50, 50, 50]);
  }

  success() {
    this.vibrate([20, 30, 40]);
  }

  pattern(durations: number[]) {
    this.vibrate(durations);
  }
}

export function useAudioFeedback() {
  const { settings } = useVoiceStore();
  const audioRef = useRef<AudioFeedback | null>(null);
  const hapticRef = useRef<HapticFeedback | null>(null);

  // Initialize audio and haptic on mount
  useEffect(() => {
    if (settings.audioFeedback) {
      audioRef.current = new AudioFeedback();
      hapticRef.current = new HapticFeedback();
    }

    return () => {
      audioRef.current = null;
      hapticRef.current = null;
    };
  }, [settings.audioFeedback]);

  const playAudio = useCallback(
    (type: FeedbackType) => {
      if (!settings.audioFeedback || !audioRef.current) return;

      switch (type) {
        case 'start':
          audioRef.current.playStart();
          break;
        case 'stop':
          audioRef.current.playStop();
          break;
        case 'command':
          audioRef.current.playCommand();
          break;
        case 'error':
          audioRef.current.playError();
          break;
        case 'success':
          audioRef.current.playSuccess();
          break;
      }
    },
    [settings.audioFeedback]
  );

  const playHaptic = useCallback((pattern: HapticPattern) => {
    if (!hapticRef.current) return;

    switch (pattern) {
      case 'light':
        hapticRef.current.light();
        break;
      case 'medium':
        hapticRef.current.medium();
        break;
      case 'heavy':
        hapticRef.current.heavy();
        break;
      case 'error':
        hapticRef.current.error();
        break;
      case 'success':
        hapticRef.current.success();
        break;
    }
  }, []);

  const playFeedback = useCallback(
    (type: FeedbackType, includeHaptic: boolean = true) => {
      playAudio(type);

      if (includeHaptic) {
        // Map audio type to haptic pattern
        const hapticMap: Record<FeedbackType, HapticPattern> = {
          start: 'light',
          stop: 'medium',
          command: 'medium',
          error: 'error',
          success: 'success',
        };

        playHaptic(hapticMap[type]);
      }
    },
    [playAudio, playHaptic]
  );

  return {
    playAudio,
    playHaptic,
    playFeedback,
  };
}
