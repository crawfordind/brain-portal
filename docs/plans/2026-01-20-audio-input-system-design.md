# Audio Input System Redesign - Design Document

**Date:** 2026-01-20
**Status:** Design Complete, Ready for Implementation
**Goal:** Transform voice into the most intuitive and accessible way to capture information

## Executive Summary

This design transforms the audio input system from a basic feature into a first-class input method. The redesigned system makes voice capture so intuitive and accessible that users prefer it over typing for quick captures and note-taking.

**Key Improvements:**
- Global floating action button (FAB) accessible from anywhere
- 15+ natural language voice commands
- Smart auto-punctuation engine
- Context-aware voice integration in editors and forms
- Comprehensive onboarding and progressive tips
- Keyboard shortcuts for power users

**Expected Impact:**
- 60%+ of captures created via voice within 3 months
- <2 seconds from voice trigger to recording start
- <5% user-reported transcription errors
- 80%+ feature discovery within first week

## Current System Analysis

### Strengths ✅

**Solid technical foundation:**
- Robust speech recognition with duplicate prevention
- Confidence threshold filtering (0.7 default)
- Interim transcript preview
- Two variants (inline & floating)
- Proper error handling and cleanup

**Multiple integration points:**
- Floating button on captures page
- Centered in quick capture dialog
- Inline in note editor toolbar
- Working across different contexts

### Issues ❌

**Discoverability problems:**
- Floating button position competes with bottom nav
- No onboarding or hints for first-time users
- Mic button looks like any other toolbar button
- No visual feedback showing voice is a primary feature

**Inconsistent UX:**
- Different placements across contexts (floating vs inline vs centered)
- No unified interaction pattern
- Missing keyboard shortcuts for power users
- No "always available" quick access

**Missing features:**
- No voice command support ("new note", "new capture", "save")
- No punctuation commands ("period", "comma", "new line")
- No way to edit/correct misrecognized text
- No transcript history or replay
- No language switching in UI

**Context awareness:**
- Doesn't adapt to what you're doing (capturing vs note-taking)
- No smart categorization (is this a task? an idea? a note?)
- Missing integration with existing content (can't say "add to current note")

## Design Philosophy

### Core Strategy

**Vision:** Make voice input so intuitive and accessible that users prefer it over typing for quick captures and note-taking.

**Five Principles:**

1. **Always Within Reach** - Voice should be accessible from anywhere in the app with a single tap/press
2. **Context-Aware** - System adapts to what the user is doing (capturing vs writing vs editing)
3. **Forgiving & Smart** - Handles corrections, punctuation commands, and auto-categorizes content
4. **Progressive Enhancement** - Works great for beginners, powerful for experts with commands
5. **Visual Feedback** - Clear indication of listening state, interim results, and processing

### Three-Tier Approach

**Tier 1: Global Quick Capture** (Always available)
- Persistent floating action button (FAB) with smart positioning
- Keyboard shortcut (Cmd/Ctrl + Shift + V)
- Creates captures/notes from anywhere
- Shows context-aware hints

**Tier 2: Contextual Voice Input** (When in creation/editing mode)
- Inline voice button in editors
- Voice-to-text in forms
- Auto-punctuation and formatting
- Smart categorization suggestions

**Tier 3: Voice Commands** (Power user features)
- Natural language commands ("new note about...", "create task to...")
- Navigation commands ("go to today's daily note")
- Quick actions ("save", "discard", "share")
- Punctuation commands ("period", "new line", "bullet point")

## UX & Interface Design

### 1. Global Floating Action Button (FAB)

**Smart Positioning:**

**Mobile:**
- Default: Bottom-right, 80px from bottom (above bottom nav)
- When keyboard open: Moves to top-right corner to stay accessible
- On scroll: Shrinks to icon-only (56px → 48px) to reduce obstruction
- When recording: Expands and pulses, overlays interim transcript bubble

**Desktop:**
- Bottom-right corner, 24px from edges
- Smaller (48px) since less screen constraint
- Hover shows tooltip: "Quick Capture (⌘⇧V)"

**Visual States:**

**Idle:**
- Primary color background with mic icon
- Subtle shadow for elevation
- Small badge showing daily capture count (e.g., "3")
- Gentle breathing animation (scale 1.0 → 1.05)

**Listening:**
- Transforms to red/destructive background
- Square icon replaces mic (stop recording)
- Pulsing animation ring
- Interim transcript appears above in speech bubble

**Processing:**
- Spinner icon
- "Processing..." text in bubble
- Semi-transparent to show it's working

**Success:**
- Brief green checkmark animation
- Fades back to idle
- Badge count increments

**Error:**
- Brief shake animation
- Error message in red bubble
- Auto-dismisses after 3 seconds

### 2. Interim Transcript Bubble

**Positioning:**
- Appears 16px above FAB
- Max width: 280px (mobile), 320px (desktop)
- Auto-scrolls as text grows
- Fades out when finalized

**Content Display:**
- Italic gray text for interim results
- Bold black text when finalized
- Word confidence indicated by opacity (low confidence = lighter)
- Punctuation commands shown in brackets: [period] [new line]
- Auto-capitalization preview

**Interaction:**
- Tap bubble to edit before finalizing
- Swipe down to dismiss/cancel
- Swipe up to open full editor

### 3. Voice Command Palette

**Trigger:**
- Say "Hey Brain Portal" or "Command" while recording
- Or tap command button in interim bubble
- Keyboard: Cmd/Ctrl + K when FAB is active

**Visual:**
```
┌─────────────────────────────────┐
│ 🎤 Voice Command                │
├─────────────────────────────────┤
│ > create task to...             │
│   new note about...             │
│   add to today's daily note...  │
│   go to notes                   │
│   save and close                │
└─────────────────────────────────┘
```

**Supported Commands:**

**Creation:**
- "new note [about X]" → Opens note editor with title/content
- "create task [to X]" → Opens task dialog pre-filled
- "quick capture [X]" → Saves to captures
- "add to current note" → Appends to open note
- "add to today" → Appends to daily note

**Navigation:**
- "go to [page]" → Navigate (notes, captures, tasks, daily, today)
- "show [entity]" → Search and navigate

**Actions:**
- "save" / "save and close"
- "cancel" / "discard"
- "tag as [tag]"
- "assign to [project]"

**Punctuation:**
- "period" / "full stop" → .
- "comma" → ,
- "question mark" → ?
- "exclamation mark" / "exclamation point" → !
- "new line" / "line break" → \n
- "new paragraph" → \n\n
- "dash" → -
- "bullet point" → •

### 4. Contextual Voice Input (In Editors)

**Note Editor Integration:**
```
Toolbar: [B] [I] [•] [#]  ...  [🎤] [💾]
```

**Behavior:**
- Click mic → Start recording at cursor position
- Auto-punctuate using AI heuristics
- Smart formatting (bullet lists, headings)
- Continuous mode: Keeps listening until stopped
- Insert mode: Single phrase then stops

**Form Field Voice:**
```
┌────────────────────────────────┐
│ Task description...        [🎤]│
└────────────────────────────────┘

Click mic → overlay:
┌────────────────────────────────┐
│         🔴 LISTENING           │
│    "Finish the documentation"  │
│         [Tap to stop]          │
└────────────────────────────────┘
```

### 5. Onboarding & Discovery

**First Visit:**
```
┌─────────────────────────────────────┐
│  🎤  Try Voice Capture              │
│                                     │
│  Tap the mic button and say         │
│  anything - it's the fastest        │
│  way to capture your thoughts       │
│                                     │
│  [Try It Now]  [Maybe Later]        │
└─────────────────────────────────────┘
```

**After First Successful Capture:**
```
┌─────────────────────────────────────┐
│  ✨ Great! Voice Tip:               │
│                                     │
│  Say "create task to..." to         │
│  instantly create a task            │
│                                     │
│  [Show More Commands]  [Got It]     │
└─────────────────────────────────────┘
```

**Progressive Tips (shown randomly):**
- "Try saying 'period' for punctuation"
- "Press ⌘⇧V for quick voice capture"
- "Tap the bubble to edit before saving"
- "Say 'add to today' to add to daily note"

### 6. Settings & Preferences

**Voice Settings Panel:**
```
Voice Input
├─ Language: English (US) [dropdown]
├─ Continuous mode: [toggle] ON
├─ Auto-punctuation: [toggle] ON
├─ Confidence threshold: [slider] 70%
├─ Voice commands: [toggle] ON
├─ Keyboard shortcut: [input] ⌘⇧V
└─ Show interim results: [toggle] ON

Advanced
├─ Enable wake word ("Hey Brain Portal"): [toggle] OFF
├─ Audio feedback (beep on start/stop): [toggle] ON
└─ Save voice recordings: [toggle] OFF (privacy)
```

### 7. Mobile-Specific Optimizations

**Bottom Sheet Alternative:**
```
Swipe up from bottom or tap FAB:
┌─────────────────────────────────────┐
│              ═══                    │  ← Drag handle
├─────────────────────────────────────┤
│         🎤 Quick Capture            │
│  ┌───────────────────────────────┐ │
│  │ 🔴 Recording...               │ │
│  │ "Need to finish the modal    │ │
│  │  system documentation"        │ │
│  └───────────────────────────────┘ │
│  [⏹ Stop]  [🎤 Commands]  [❌]     │
└─────────────────────────────────────┘
```

**Gesture Support:**
- Long-press FAB → Start recording immediately
- Release to stop and save
- Slide up while holding → Open editor
- Slide left while holding → Cancel

**Haptic Feedback:**
- Light tap on record start
- Medium tap on record stop
- Error vibration pattern on failure
- Success pattern on save

## Technical Architecture

### Component Structure

**New Components:**
```
src/components/voice/
├── voice-fab.tsx                    # Global floating action button
├── voice-command-palette.tsx        # Command recognition & execution
├── voice-capture-sheet.tsx          # Mobile bottom sheet
├── voice-transcript-bubble.tsx      # Interim results display
├── voice-settings-panel.tsx         # Voice preferences UI
├── voice-onboarding.tsx             # First-time user tips
└── hooks/
    ├── use-voice-commands.ts        # Command parser & executor
    ├── use-voice-capture.ts         # High-level capture orchestration
    ├── use-smart-punctuation.ts     # Auto-punctuation logic
    └── use-voice-settings.ts        # Settings management
```

### State Management (Zustand)

```tsx
interface VoiceState {
  // Recording state
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;

  // Content
  interimTranscript: string;
  finalTranscript: string;

  // Context
  recordingContext: 'global' | 'note-editor' | 'form' | null;
  targetNoteId?: string;
  targetFieldId?: string;

  // Settings
  settings: {
    language: string;
    continuousMode: boolean;
    autoPunctuation: boolean;
    confidenceThreshold: number;
    voiceCommands: boolean;
    keyboardShortcut: string;
    showInterim: boolean;
    wakeWord: boolean;
    audioFeedback: boolean;
  };

  // Onboarding
  onboardingComplete: boolean;
  tipsShown: string[];
  captureCount: number;

  // Actions
  startRecording: (context?: string, targetId?: string) => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  cancelRecording: () => void;
  updateTranscript: (interim: string, final?: string) => void;
  processCommand: (command: string) => Promise<void>;
  saveCapture: () => Promise<void>;
  updateSettings: (settings: Partial<VoiceSettings>) => void;
  markOnboardingComplete: () => void;
  addTipShown: (tipId: string) => void;
}
```

### Command Parsing System

**Command Structure:**
```tsx
interface VoiceCommand {
  trigger: string[];          // Phrases that activate this command
  pattern: RegExp;            // Pattern to extract parameters
  category: 'creation' | 'navigation' | 'action' | 'punctuation';
  handler: (params: any) => Promise<void>;
  requiredContext?: string[]; // Where this command works
}
```

**Example Commands:**
```tsx
{
  trigger: ['new note', 'create note'],
  pattern: /(?:new|create) note (?:about |titled )?(.+)/i,
  category: 'creation',
  handler: async ({ content }) => {
    router.push(`/notes/new?content=${encodeURIComponent(content)}`);
  },
}
```

**Command Execution Pipeline:**
1. User speaks
2. Speech recognition provides transcript
3. Command parser checks for commands
4. If command found:
   - Pause normal transcript accumulation
   - Show command confirmation UI
   - Execute command handler
   - Resume or close based on command
5. If no command:
   - Continue normal transcription
   - Apply auto-punctuation
   - Accumulate text

### Auto-Punctuation Engine

**Punctuation Rules:**
```tsx
interface PunctuationRule {
  trigger: RegExp;
  replacement: string;
  confidence: number;
}

const RULES: PunctuationRule[] = [
  // Natural pauses
  {
    trigger: /\s+and\s+$/i,
    replacement: ', and ',
    confidence: 0.8
  },

  // Question detection
  {
    trigger: /(who|what|where|when|why|how)$/i,
    replacement: '$1?',
    confidence: 0.9
  },

  // Sentence endings (long pause)
  {
    trigger: /\s{3,}/,
    replacement: '. ',
    confidence: 0.7
  },

  // List items
  {
    trigger: /(?:first|second|third|next|also|finally)\s/i,
    replacement: '\n- ',
    confidence: 0.85
  },
];
```

**Processing:**
- Apply rules based on confidence threshold
- Capitalize first letter of sentences
- Handle context-aware rules (questions, lists, etc.)
- Learn from user corrections (future enhancement)

### Keyboard Shortcuts

**Global Shortcuts:**
- `Cmd/Ctrl + Shift + V` → Toggle recording (global capture)
- `Escape` → Cancel recording
- `Cmd/Ctrl + Enter` → Stop recording and save

**Context-Aware:**
- In note editor: Inserts at cursor
- In capture dialog: Toggles mic in text field
- On any page: Opens global capture

### Audio Feedback

**Sound Effects:**
- `record-start.mp3` - Subtle beep
- `record-stop.mp3` - Confirmation chime
- `command-recognized.mp3` - Success tone
- `error.mp3` - Error tone
- `processing.mp3` - Thinking sound

**Haptic Feedback (Mobile):**
- Light: Record start
- Medium: Record stop
- Error pattern: Failure
- Success pattern: Save success

### Error Handling

**Robust Error Recovery:**
```tsx
class VoiceErrorHandler {
  handleError(error: SpeechRecognitionErrorEvent) {
    switch (error.error) {
      case 'not-allowed':
        showPermissionPrompt();
        break;
      case 'no-speech':
        retryWithPrompt();
        break;
      case 'network':
        retryWithBackoff();
        break;
      case 'audio-capture':
        showHardwareError();
        break;
    }
  }

  async retryWithBackoff() {
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 10000);
    await sleep(delay);
    this.retryCount++;
    // Retry...
  }
}
```

### Performance Optimizations

**Lazy Loading:**
```tsx
const VoiceFAB = lazy(() => import('@/components/voice/voice-fab'));
const VoiceCommandPalette = lazy(() => import('@/components/voice/voice-command-palette'));
```

**Web Worker for Processing:**
```tsx
// Offload command parsing and punctuation to worker
self.addEventListener('message', (e) => {
  switch (e.data.type) {
    case 'PARSE_COMMAND':
      const command = parseCommand(e.data.transcript);
      self.postMessage({ type: 'COMMAND_PARSED', command });
      break;
    case 'APPLY_PUNCTUATION':
      const punctuated = applyAutoPunctuation(e.data.text);
      self.postMessage({ type: 'PUNCTUATION_APPLIED', text: punctuated });
      break;
  }
});
```

**Debounced Updates:**
```tsx
const debouncedInterimUpdate = useMemo(
  () => debounce((text: string) => {
    updateInterimTranscript(text);
  }, 100),
  []
);
```

## Implementation Plan

### Track 1: Core Infrastructure (Priority: Critical)

**Must complete first - foundation for all other tracks**

- **Task 1.1:** Voice state management (Zustand store) - 2-3 hours
- **Task 1.2:** Command parser and executor - 3-4 hours
- **Task 1.3:** Auto-punctuation engine - 2-3 hours
- **Task 1.4:** Keyboard shortcut system - 1-2 hours
- **Task 1.5:** Audio feedback and haptics - 1-2 hours
- **Task 1.6:** Error handling and retry logic - 2 hours

**Subtotal: ~12-16 hours**

### Track 2: Global Voice FAB (Priority: High)

**Primary UX - the always-accessible voice button**

- **Task 2.1:** VoiceFAB component with smart positioning - 3-4 hours
- **Task 2.2:** VoiceTranscriptBubble component - 2 hours
- **Task 2.3:** Recording state animations - 1-2 hours
- **Task 2.4:** Gesture support (long-press, swipe) - 2-3 hours
- **Task 2.5:** Mobile VoiceCaptureSheet alternative - 2-3 hours
- **Task 2.6:** Integration with captures API - 1-2 hours

**Subtotal: ~13-18 hours**

### Track 3: Voice Commands (Priority: High)

**Key differentiator - natural language commands**

- **Task 3.1:** VoiceCommandPalette component - 3 hours
- **Task 3.2:** Creation commands (note, task, capture) - 2 hours
- **Task 3.3:** Navigation commands - 1 hour
- **Task 3.4:** Action commands (save, cancel, etc.) - 1 hour
- **Task 3.5:** Punctuation commands - 1-2 hours
- **Task 3.6:** Command confirmation UI - 2 hours

**Subtotal: ~9-11 hours**

### Track 4: Contextual Integration (Priority: Medium)

**Voice in specific contexts - editors and forms**

- **Task 4.1:** Note editor inline voice - 2-3 hours
- **Task 4.2:** Form field voice input - 2 hours
- **Task 4.3:** QuickCaptureDialog enhancement - 1 hour
- **Task 4.4:** "Add to current note" functionality - 2 hours
- **Task 4.5:** Smart categorization suggestions - 2-3 hours
- **Task 4.6:** Edit/correction UI for transcripts - 2 hours

**Subtotal: ~11-14 hours**

### Track 5: Onboarding & Settings (Priority: Medium)

**User education and preferences**

- **Task 5.1:** VoiceOnboarding component - 2-3 hours
- **Task 5.2:** VoiceSettingsPanel component - 2 hours
- **Task 5.3:** Progressive tips system - 2 hours
- **Task 5.4:** First-time tutorial - 2 hours
- **Task 5.5:** Command cheat sheet - 1-2 hours
- **Task 5.6:** Analytics and usage tracking - 1-2 hours

**Subtotal: ~10-12 hours**

### Total Estimated Effort

**Sequential: ~55-71 hours** (7-9 working days)
**With parallelization: ~3-4 weeks calendar time**

### Dependencies

**Critical Path:**
```
Track 1 (Infrastructure)
  └─> Track 2 (FAB) ─────────────────┐
  └─> Track 3 (Commands) ────────────┤
  └─> Track 4 (Contextual) ──────────┼─> Track 5 (Onboarding) ─> Complete
```

**Key Dependencies:**
- Track 1 must complete before all others
- Track 5 requires Tracks 2 & 3 complete (needs features to document)
- Tracks 2, 3, 4 can run in parallel after Track 1

## Success Criteria

### Functionality
- ✅ Voice capture works in all contexts
- ✅ All 15+ commands work correctly
- ✅ Auto-punctuation improves readability
- ✅ Keyboard shortcuts work reliably
- ✅ Error handling is robust
- ✅ Works on mobile and desktop

### Performance
- ✅ <2 seconds from trigger to recording
- ✅ <500ms command recognition
- ✅ 60fps animations throughout
- ✅ <100KB bundle size increase

### UX
- ✅ 60%+ feature discovery in first week
- ✅ 80%+ onboarding completion
- ✅ <5% user-reported errors
- ✅ Positive user feedback

### Accessibility
- ✅ Keyboard accessible throughout
- ✅ Screen reader friendly
- ✅ High contrast mode compatible
- ✅ Touch targets meet 44px minimum

### Adoption
- ✅ 60%+ of captures via voice within 3 months
- ✅ 70%+ accuracy on auto-categorization
- ✅ 5+ voice commands used per power user per day

## Testing Strategy

**Per Task:**
- Unit tests for logic (command parser, punctuation, etc.)
- Component tests for UI (FAB, bubble, palette, etc.)
- Integration tests for workflows (record → transcribe → save)
- Manual testing on mobile and desktop
- Screen reader testing for accessibility

**Overall System:**
- End-to-end test: Global capture workflow
- End-to-end test: Voice command execution
- End-to-end test: Contextual voice in editor
- Performance test: Time from trigger to recording
- Performance test: Command recognition speed
- Usability test: First-time user experience

## Risk Mitigation

**Risks & Mitigations:**

1. **Speech recognition accuracy varies by browser**
   - Mitigation: Set confidence threshold, allow manual correction

2. **Commands might be misrecognized**
   - Mitigation: Confirmation UI, easy undo, command cheat sheet

3. **Auto-punctuation may be incorrect**
   - Mitigation: User can edit before save, toggle off in settings

4. **Feature complexity may overwhelm users**
   - Mitigation: Progressive disclosure, thorough onboarding, tips

5. **Privacy concerns with voice recordings**
   - Mitigation: Never save audio, process client-side when possible

## Future Enhancements

**Phase 2 (Post-Launch):**
- Multi-language support (Spanish, French, etc.)
- Custom voice commands (user-defined)
- Voice macros (sequences of commands)
- Transcript history and replay
- Voice notes with playback
- Offline voice recognition (via Web Speech API caching)
- ML-powered punctuation improvement based on user style

**Phase 3 (Advanced):**
- Wake word support ("Hey Brain Portal")
- Speaker identification (multi-user)
- Sentiment analysis for auto-tagging mood
- Voice search through existing notes
- Voice editing commands ("delete last sentence", "replace X with Y")

---

**Design Status:** Complete and ready for implementation

**Next Steps:**
1. Review and approve this design
2. Create detailed implementation plan (similar to modal Phase 4)
3. Set up git worktree for audio system work
4. Begin with Track 1: Core Infrastructure
