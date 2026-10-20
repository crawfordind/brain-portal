/**
 * The Claude adapter: what it sends, and what it refuses to pretend.
 */
import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { claudeComplete, ClaudeRefusalError, toClaudeMessages } from "@/lib/ai/anthropic";

function fakeClient(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const ok = (text: string, model = "claude-opus-5-5") => ({
  model,
  stop_reason: "end_turn",
  stop_details: null,
  content: [{ type: "thinking", thinking: "" }, { type: "text", text }],
});

describe("toClaudeMessages", () => {
  it("moves system messages to the system prompt and converts images", () => {
    const { system, messages } = toClaudeMessages([
      { role: "system", content: "Be brief." },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ]);
    expect(system).toBe("Be brief.");
    expect(messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Read this" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
    ]);
  });

  it("starts with the user's turn, as Claude requires", () => {
    const { messages } = toClaudeMessages([
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "Hello" },
    ]);
    expect(messages[0].role).toBe("user");
  });
});

describe("claudeComplete", () => {
  it("sends no temperature or thinking field, sets effort, and floors max_tokens for thinking", async () => {
    const { client, create } = fakeClient(ok("tags: a, b"));
    const result = await claudeComplete(client, {
      model: "claude-opus-5-5",
      messages: [{ role: "user", content: "Tag this" }],
      maxTokens: 300,
      effort: "low",
    });

    expect(result).toMatchObject({ content: "tags: a, b", finishReason: "stop", model: "claude-opus-5-5" });
    const body = create.mock.calls[0][0];
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(16000);
    expect(body).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });

  it("leaves out refusal fallbacks for a model that doesn't take them", async () => {
    const { client, create } = fakeClient(ok("hi", "claude-haiku-5-5"));
    await claudeComplete(client, { model: "claude-haiku-5-5", messages: [{ role: "user", content: "x" }], maxTokens: 100, effort: "low" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
  });

  it("turns a refusal into an error with Claude's reason, never empty output", async () => {
    const { client } = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "Not this one." },
      content: [],
    });
    await expect(
      claudeComplete(client, { model: "claude-opus-5-5", messages: [{ role: "user", content: "x" }], maxTokens: 100, effort: "low" })
    ).rejects.toThrow(ClaudeRefusalError);
  });

  it("reports truncation the way the rest of the app expects", async () => {
    const { client } = fakeClient({ ...ok("partial"), stop_reason: "max_tokens" });
    const result = await claudeComplete(client, { model: "claude-opus-5-5", messages: [{ role: "user", content: "x" }], maxTokens: 100, effort: "low" });
    expect(result.finishReason).toBe("length");
  });
});
