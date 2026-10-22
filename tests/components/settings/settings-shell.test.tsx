import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "../../helpers/render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// The panels fetch their own data; the shell only decides which one shows.
vi.mock("@/components/notifications/notification-preferences", () => ({
  NotificationPreferencesPanel: () => <div>notifications panel</div>,
}));
vi.mock("@/components/settings/ai-provider-settings", () => ({
  AiProviderSettingsPanel: () => <div>ai provider panel</div>,
}));
vi.mock("@/components/settings/ai-usage-settings", () => ({
  AiUsageSettingsPanel: () => <div>ai usage panel</div>,
}));
vi.mock("@/components/settings/guardrails-settings", () => ({
  GuardrailsSettingsPanel: () => <div>guardrails panel</div>,
}));
vi.mock("@/components/settings/mcp-keys-panel", () => ({
  McpKeysPanel: () => <div>api keys panel</div>,
}));
vi.mock("@/components/settings/model-settings", () => ({
  ModelSettingsPanel: () => <div>models panel</div>,
}));
vi.mock("@/components/settings/sharing-settings", () => ({
  SharingSettingsPanel: () => <div>sharing panel</div>,
}));

import { SettingsShell } from "@/components/settings/settings-shell";

const account = {
  email: "owner@example.com",
  displayName: null,
  createdAt: "2026-01-15 10:00:00",
};

function setHash(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("SettingsShell", () => {
  beforeEach(() => {
    // Radix's slider (Voice) measures itself; jsdom has no ResizeObserver.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    window.history.replaceState(null, "", "/settings");
  });

  it("opens Profile when the URL names no section", () => {
    renderWithProviders(<SettingsShell account={account} />);
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    expect(screen.getAllByText("owner@example.com").length).toBeGreaterThan(0);
  });

  it("opens the section an existing link points at", () => {
    window.history.replaceState(null, "", "/settings#notifications");
    renderWithProviders(<SettingsShell account={account} />);
    expect(screen.getByRole("heading", { level: 2, name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("notifications panel")).toBeInTheDocument();
  });

  it("switches section from the sidebar and marks it current", () => {
    renderWithProviders(<SettingsShell account={account} />);
    fireEvent.click(screen.getByRole("link", { name: /^API access/ }));
    expect(window.location.hash).toBe("#api-access");
    setHash("api-access");
    expect(screen.getByText("api keys panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^API access/ })).toHaveAttribute("aria-current", "page");
  });

  it("filters the sidebar by search and opens the first match on Enter", () => {
    renderWithProviders(<SettingsShell account={account} />);
    const search = screen.getByRole("searchbox", { name: /search settings/i });
    fireEvent.change(search, { target: { value: "dark mode" } });
    expect(screen.getByRole("link", { name: /^Appearance/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Notifications/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(window.location.hash).toBe("#appearance");
  });

  it("says so when nothing matches", () => {
    renderWithProviders(<SettingsShell account={account} />);
    fireEvent.change(screen.getByRole("searchbox", { name: /search settings/i }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/no settings match/i)).toBeInTheDocument();
  });

  it("returns to the list from a section with the back button", () => {
    window.history.replaceState(null, "", "/settings#voice");
    renderWithProviders(<SettingsShell account={account} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(window.location.hash).toBe("");
  });
});
