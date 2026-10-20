import { describe, it, expect } from "vitest";
import { directModelChain, claudeEffortForSlot, isDirectModelId } from "@/lib/ai/models/providers";
import { usableForChat } from "@/lib/ai/credentials/status";

describe("directModelChain", () => {
  it("defaults every Claude job to Claude Opus 5.5", () => {
    for (const slot of ["fast", "deep", "agent", "vision"] as const) {
      expect(directModelChain({ provider: "anthropic", slot })).toEqual(["claude-opus-5-5"]);
    }
  });

  it("honours the person's choice when their key offers it", () => {
    const available = new Set(["claude-opus-5-5", "claude-haiku-5-5"]);
    expect(directModelChain({ provider: "anthropic", slot: "fast", userChoice: "claude-haiku-5-5", availableIds: available })).toEqual([
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
  });

  it("heals a choice the key no longer offers", () => {
    const available = new Set(["claude-opus-5-5"]);
    expect(directModelChain({ provider: "anthropic", slot: "fast", userChoice: "claude-retired-1", availableIds: available })).toEqual([
      "claude-opus-5-5",
    ]);
  });

  it("ignores OpenRouter-style ids that mean nothing to a direct provider", () => {
    expect(isDirectModelId("minimax/minimax-m2.5")).toBe(false);
    expect(directModelChain({ provider: "openai", slot: "deep", pinned: "minimax/minimax-m2.5" })[0]).toBe("gpt-5");
  });

  it("keeps every candidate when the model list couldn't be fetched", () => {
    expect(directModelChain({ provider: "openai", slot: "fast", availableIds: null })).toEqual(["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"]);
  });

  it("embeds with the same model OpenRouter uses, so stored vectors stay comparable", () => {
    expect(directModelChain({ provider: "openai", slot: "embedding" })).toEqual(["text-embedding-3-small"]);
  });

  it("runs background work light and reading work deep", () => {
    expect(claudeEffortForSlot("fast")).toBe("low");
    expect(claudeEffortForSlot("deep")).toBe("high");
    expect(claudeEffortForSlot("chat")).toBe("medium");
  });

  it("offers only chat models in the picker", () => {
    expect(usableForChat("openai", "gpt-5-mini")).toBe(true);
    expect(usableForChat("openai", "text-embedding-3-small")).toBe(false);
    expect(usableForChat("openai", "gpt-4o-realtime-preview")).toBe(false);
    expect(usableForChat("anthropic", "claude-haiku-5-5")).toBe(true);
  });
});
