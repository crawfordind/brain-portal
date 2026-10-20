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
const claudeStream = vi.fn();
const recordAiUsage = vi.fn(async () => {});

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
  claudeStream: (...a: unknown[]) => claudeStream(...a),
}));
vi.mock("@/lib/ai/usage/store", () => ({ recordAiUsage: (...a: unknown[]) => recordAiUsage(...(a as [])) }));
vi.mock("@/lib/ai/models/direct-catalog", () => ({ directModelIds: vi.fn(async () => null) }));
vi.mock("@/lib/ai/models", () => ({ getModelChain: vi.fn(async () => ["vendor/fast-model"]) }));

import { completeWithMeta, streamComplete } from "@/lib/ai/client";
import { runWithAiUser } from "@/lib/ai/credentials/context";

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

  it("logs each call: what it was for, the model that answered, whose key, and the tokens", async () => {
    resolveAiCredential.mockResolvedValue(userKey("openrouter"));
    create.mockResolvedValue({ ...reply("ok"), usage: { prompt_tokens: 120, completion_tokens: 30 } });

    const result = await completeWithMeta("Summarize this", { slot: "fast", userId: "u1", system: "Be brief.", purpose: "Note summary" });

    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "openrouter",
        model: "served",
        source: "user",
        kind: "chat",
        purpose: "Note summary",
        prompt: "[system]\nBe brief.\n\n[user]\nSummarize this",
        inputTokens: 120,
        outputTokens: 30,
        status: "ok",
      })
    );
  });

  it("falls back to the background job's label, and logs failures too", async () => {
    resolveAiCredential.mockResolvedValue(userKey("openai"));
    create.mockRejectedValue(Object.assign(new Error("400 bad request"), { status: 400 }));

    await runWithAiUser("u1", () => completeWithMeta("hi", { slot: "fast" }), "Note tags").catch(() => null);

    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ purpose: "Note tags", status: "error", error: "400 bad request" }));
  });

  it("does not log work that belongs to no account", async () => {
    resolveAiCredential.mockResolvedValue({ provider: "openrouter", apiKey: "k", source: "server", userId: null });
    create.mockResolvedValue(reply("ok"));
    await completeWithMeta("hi", { slot: "fast" });
    expect(recordAiUsage).not.toHaveBeenCalled();
  });

  it("ends a chat stream with the model that answered and its tokens, then logs it", async () => {
    resolveAiCredential.mockResolvedValue(userKey("anthropic"));
    claudeStream.mockImplementation(async function* (_client: unknown, input: { onMeta?: (m: unknown) => void }) {
      input.onMeta?.({ model: "claude-opus-5-5", usage: { inputTokens: 40, outputTokens: 0 } });
      yield "Hello";
      input.onMeta?.({ usage: { inputTokens: 40, outputTokens: 12 } });
    });

    const stream = await streamComplete([{ role: "user", content: "hi" }], { userId: "u1" });
    const text = await new Response(stream).text();

    const frames = text.split("\n\n").filter(Boolean).map((f) => f.replace(/^data: /, ""));
    expect(frames.at(-1)).toBe("[DONE]");
    expect(JSON.parse(frames.at(-2)!)).toEqual({
      meta: { model: "claude-opus-5-5", provider: "anthropic", source: "user", inputTokens: 40, outputTokens: 12 },
    });
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "stream", purpose: "Chat", model: "claude-opus-5-5", inputTokens: 40, outputTokens: 12 })
    );
  });
});
