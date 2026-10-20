/**
 * `completeWithMeta` sends each call to the provider whose key pays for it,
 * in that provider's own dialect, and never quietly swaps a rejected personal
 * key for the server's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveAiCredential = vi.fn();
const noteKeyRejected = vi.fn();
const create = vi.fn();
const claudeComplete = vi.fn();

vi.mock("@/lib/ai/credentials/resolve", () => ({
  resolveAiCredential: (...a: unknown[]) => resolveAiCredential(...a),
  noteKeyRejected: (...a: unknown[]) => noteKeyRejected(...a),
  directProviderModelChoices: vi.fn(async () => ({})),
  isAuthError: (e: { status?: number }) => e?.status === 401,
}));
vi.mock("@/lib/ai/transport", () => ({
  openAiCompatibleClient: () => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } }),
  anthropicClient: () => ({}),
}));
vi.mock("@/lib/ai/anthropic", () => ({
  claudeComplete: (...a: unknown[]) => claudeComplete(...a),
  claudeStream: vi.fn(),
}));
vi.mock("@/lib/ai/models/direct-catalog", () => ({ directModelIds: vi.fn(async () => null) }));
vi.mock("@/lib/ai/models", () => ({ getModelChain: vi.fn(async () => ["vendor/fast-model"]) }));

import { completeWithMeta } from "@/lib/ai/client";

const userKey = (provider: string) => ({ provider, apiKey: "k", source: "user", userId: "u1" });
const reply = (content: string) => ({ model: "served", choices: [{ message: { content }, finish_reason: "stop" }] });

describe("completeWithMeta across providers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls OpenAI with its own model names and reasoning-model parameters", async () => {
    resolveAiCredential.mockResolvedValue(userKey("openai"));
    create.mockResolvedValue(reply("ok"));

    await completeWithMeta("hi", { slot: "fast", userId: "u1", maxTokens: 300, temperature: 0.7 });

    const body = create.mock.calls[0][0];
    expect(body.model).toBe("gpt-5-mini");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(16000);
    // OpenRouter's failover field means nothing to OpenAI.
    expect(body).not.toHaveProperty("models");
  });

  it("sends a Claude key's work to Claude, with the slot's model and effort", async () => {
    resolveAiCredential.mockResolvedValue(userKey("anthropic"));
    claudeComplete.mockResolvedValue({ content: "from claude", finishReason: "stop", model: "claude-opus-5-5" });

    const result = await completeWithMeta("hi", { slot: "deep", userId: "u1" });

    expect(result.content).toBe("from claude");
    expect(claudeComplete.mock.calls[0][1]).toMatchObject({ model: "claude-opus-5-5", effort: "high" });
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps OpenRouter's catalog chain and failover for an OpenRouter key", async () => {
    resolveAiCredential.mockResolvedValue({ provider: "openrouter", apiKey: "k", source: "server", userId: null });
    create.mockResolvedValue(reply("ok"));

    await completeWithMeta("hi", { slot: "fast" });

    expect(create.mock.calls[0][0]).toMatchObject({ model: "vendor/fast-model", max_tokens: 2048, temperature: 0.7 });
  });

  it("fails loudly on a rejected personal key, records it, and does not retry on anyone else's key", async () => {
    resolveAiCredential.mockResolvedValue(userKey("openai"));
    create.mockRejectedValue(Object.assign(new Error("401 Incorrect API key"), { status: 401 }));

    const error = await completeWithMeta("hi", { slot: "fast", userId: "u1", retries: 2 }).catch((e) => e);

    expect(error.message).toMatch(/OpenAI rejected your API key/);
    expect(error.status).toBe(401);
    expect(noteKeyRejected).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(resolveAiCredential).toHaveBeenCalledTimes(1);
  });
});
