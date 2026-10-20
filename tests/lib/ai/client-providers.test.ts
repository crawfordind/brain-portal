/**
 * `completeWithMeta` sends each call to the provider whose key pays for it,
 * in that provider's own dialect, and never quietly swaps a rejected personal
 * key for the server's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveAiCredential = vi.fn();
const resolveChain = vi.fn((..._a: unknown[]): unknown[] | null => null);
const noteKeyRejected = vi.fn();
const create = vi.fn();
const claudeComplete = vi.fn();
const claudeStream = vi.fn();
const recordAiUsage = vi.fn(async () => {});

vi.mock("@/lib/ai/credentials/resolve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/credentials/resolve")>()),
  // Each test sets one credential, or a chain with `resolveChain`.
  resolveAiCredentialChain: async (...a: unknown[]) => {
    const chain = resolveChain(...a);
    return chain ?? [await resolveAiCredential(...a)];
  },
  noteKeyRejected: (...a: unknown[]) => noteKeyRejected(...a),
  directProviderModelChoices: vi.fn(async () => ({})),
  isAuthError: (e: { status?: number }) => e?.status === 401,
}));
vi.mock("@/lib/ai/transport", () => ({
  openAiCompatibleClient: () => ({ chat: { completions: { create: (...a: unknown[]) => create(...a) } } }),
  anthropicClient: () => ({}),
}));
vi.mock("@/lib/ai/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/anthropic")>()),
  claudeComplete: (...a: unknown[]) => claudeComplete(...a),
  claudeStream: (...a: unknown[]) => claudeStream(...a),
}));
const chatGptComplete = vi.fn();
const chatGptStream = vi.fn();
vi.mock("@/lib/ai/chatgpt/responses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chatgpt/responses")>()),
  chatGptComplete: (...a: unknown[]) => chatGptComplete(...a),
  chatGptStream: (...a: unknown[]) => chatGptStream(...a),
  chatGptModelIds: vi.fn(async () => ["gpt-plan-pro", "gpt-plan-mini"]),
}));
vi.mock("@/lib/ai/usage/store", () => ({ recordAiUsage: (...a: unknown[]) => recordAiUsage(...(a as [])) }));
vi.mock("@/lib/ai/models/direct-catalog", () => ({ directModelIds: vi.fn(async () => null) }));
vi.mock("@/lib/ai/models", () => ({ getModelChain: vi.fn(async () => ["vendor/fast-model"]) }));

import { completeWithMeta, streamComplete } from "@/lib/ai/client";
import { runWithAiUser } from "@/lib/ai/credentials/context";
import { ChatGptPlanError } from "@/lib/ai/chatgpt/responses";

const userKey = (provider: string) => ({ provider, apiKey: "k", source: "user", userId: "u1" });
const reply = (content: string) => ({ model: "served", choices: [{ message: { content }, finish_reason: "stop" }] });

describe("completeWithMeta across providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveChain.mockReturnValue(null);
  });

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

  describe("backing up across providers", () => {
    const plan = { provider: "chatgpt", apiKey: "plan-token", source: "user", userId: "u1" };
    const usageLimit = () =>
      new ChatGptPlanError("Your ChatGPT plan's usage limit is used up for now.", {
        status: 429,
        code: "subscription_sharing_usage_limit_exceeded",
        fallback: true,
      });

    it("tries the ChatGPT plan first, with a light model for everyday jobs", async () => {
      resolveChain.mockReturnValue([plan, userKey("openai")]);
      chatGptComplete.mockResolvedValue({ content: "from plan", model: "gpt-plan-mini", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2 } });

      const result = await completeWithMeta("hi", { slot: "fast", userId: "u1" });

      expect(result).toMatchObject({ content: "from plan", provider: "chatgpt" });
      expect(chatGptComplete.mock.calls[0][0]).toMatchObject({ accessToken: "plan-token", model: "gpt-plan-mini" });
      expect(create).not.toHaveBeenCalled();
    });

    it("hands the job to the next key when the plan's usage runs out, and says so", async () => {
      resolveChain.mockReturnValue([plan, userKey("openai")]);
      chatGptComplete.mockRejectedValue(usageLimit());
      create.mockResolvedValue(reply("from openai"));

      const result = await completeWithMeta("hi", { slot: "fast", userId: "u1", retries: 2 });

      expect(result).toMatchObject({ content: "from openai", provider: "openai", fellBackFrom: ["ChatGPT plan"] });
      // A usage limit is not retried on the same plan: it would only spend time.
      expect(chatGptComplete).toHaveBeenCalledTimes(1);
      expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "chatgpt", status: "error" }));
      expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "openai", status: "ok" }));
    });

    it("backs up a rejected or out-of-credit key with the next one", async () => {
      resolveChain.mockReturnValue([userKey("openai"), userKey("anthropic")]);
      create.mockRejectedValue(Object.assign(new Error("402 insufficient credits"), { status: 402 }));
      claudeComplete.mockResolvedValue({ content: "from claude", finishReason: "stop", model: "claude-opus-5-5" });

      const result = await completeWithMeta("hi", { slot: "fast", userId: "u1" });
      expect(result).toMatchObject({ content: "from claude", provider: "anthropic", fellBackFrom: ["OpenAI"] });
    });

    it("does not shop a malformed request around: every provider would refuse it", async () => {
      resolveChain.mockReturnValue([userKey("openai"), userKey("anthropic")]);
      create.mockRejectedValue(Object.assign(new Error("400 invalid request"), { status: 400 }));

      await expect(completeWithMeta("hi", { slot: "fast", userId: "u1" })).rejects.toThrow("400 invalid request");
      expect(claudeComplete).not.toHaveBeenCalled();
    });

    it("streams from the next provider when the first fails before saying anything", async () => {
      resolveChain.mockReturnValue([plan, userKey("openrouter")]);
      // eslint-disable-next-line require-yield
      chatGptStream.mockImplementation(async function* () {
        throw usageLimit();
      });
      create.mockResolvedValue(
        (async function* () {
          yield { model: "vendor/fast-model", choices: [{ delta: { content: "Hello" } }] };
          yield { model: "vendor/fast-model", choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } };
        })()
      );

      const text = await new Response(await streamComplete([{ role: "user", content: "hi" }], { userId: "u1" })).text();

      expect(text).toContain('"content":"Hello"');
      const meta = JSON.parse(text.split("\n\n").find((f) => f.includes('"meta"'))!.replace(/^data: /, ""));
      expect(meta.meta).toMatchObject({ provider: "openrouter", fellBackFrom: ["ChatGPT plan"] });
      expect(text).not.toContain('"error"');
    });
  });
});
