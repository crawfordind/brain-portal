/**
 * Start or stop voice capture from outside the FAB.
 *
 * The FAB owns the SpeechRecognition instance, so anything else that wants to
 * record (the dashboard's voice card) asks it to toggle rather than driving the
 * store directly, which would flip `isRecording` with no microphone behind it.
 * Dispatched synchronously from a click, so the browser still counts the
 * microphone prompt as user-initiated.
 */
export const VOICE_TOGGLE_EVENT = "brain-portal:voice-toggle";

export function requestVoiceToggle() {
  window.dispatchEvent(new CustomEvent(VOICE_TOGGLE_EVENT));
}
