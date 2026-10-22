import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VoiceIntroCard } from "@/components/stream/voice-intro-card";
import { VOICE_TOGGLE_EVENT } from "@/components/voice/events";
import { useVoiceStore } from "@/lib/stores/voice-store";

async function hydrate() {
  await act(async () => {
    await useVoiceStore.persist.rehydrate();
  });
}

describe("VoiceIntroCard", () => {
  beforeEach(() => {
    localStorage.clear();
    useVoiceStore.setState({ onboardingComplete: false, isRecording: false });
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = function () {};
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it("shows for a user who has not met voice yet", async () => {
    render(<VoiceIntroCard />);
    await hydrate();
    expect(screen.getByRole("heading", { name: /try voice capture/i })).toBeInTheDocument();
  });

  it("stays hidden once onboarding is complete", async () => {
    useVoiceStore.setState({ onboardingComplete: true });
    render(<VoiceIntroCard />);
    await hydrate();
    expect(screen.queryByRole("heading", { name: /try voice capture/i })).toBeNull();
  });

  it("stays hidden where the browser cannot recognise speech", async () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    render(<VoiceIntroCard />);
    await hydrate();
    expect(screen.queryByRole("heading", { name: /try voice capture/i })).toBeNull();
  });

  it("dismisses for good from the close button", async () => {
    render(<VoiceIntroCard />);
    await hydrate();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(useVoiceStore.getState().onboardingComplete).toBe(true);
    expect(screen.queryByRole("heading", { name: /try voice capture/i })).toBeNull();
  });

  it("asks the FAB to start recording and stays up while it does", async () => {
    const onToggle = vi.fn();
    window.addEventListener(VOICE_TOGGLE_EVENT, onToggle);
    render(<VoiceIntroCard />);
    await hydrate();

    fireEvent.click(screen.getByRole("button", { name: /try it/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().onboardingComplete).toBe(true);

    act(() => useVoiceStore.setState({ isRecording: true }));
    fireEvent.click(screen.getByRole("button", { name: /stop and save/i }));
    expect(onToggle).toHaveBeenCalledTimes(2);

    act(() => useVoiceStore.setState({ isRecording: false }));
    expect(screen.queryByRole("heading", { name: /try voice capture/i })).toBeNull();
    window.removeEventListener(VOICE_TOGGLE_EVENT, onToggle);
  });
});
