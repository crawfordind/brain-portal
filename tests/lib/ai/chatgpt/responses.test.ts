import { describe, it, expect, vi } from "vitest";
import { chatGptComplete, chatGptModelIds, chatGptModelList, ChatGptPlanError } from "@/lib/ai/chatgpt/responses";
import { shouldFallBack } from "@/lib/ai/fallback";

const sse = (events: unknown[]) =>
  new Response(events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });

describe("ChatGPT plan requests", () => {
  it("streams with store off and the system prompt as instructions, and reads usage", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      sse([
        { type: "response.output_text.delta", delta: "Hel" },
        { type: "response.output_text.delta", delta: "lo" },
        { type: "response.completed", response: { model: "gpt-plan-mini", usage: { input_tokens: 12, output_tokens: 3 } } },
      ])
    );
    const result = await chatGptComplete(
      { accessToken: "t", model: "gpt-plan-mini", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] },
      fetchImpl as unknown as typeof fetch
    );
    expect(result).toEqual({ content: "Hello", model: "gpt-plan-mini", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 3 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ store: false, stream: true, instructions: "Be brief.", model: "gpt-plan-mini" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_output_tokens");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("reads a used-up plan whether it arrives as a status or mid-stream, and hands over", async () => {
    const before = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }), { status: 429 })
    );
    const e1 = await chatGptComplete({ accessToken: "t", model: "m", messages: [{ role: "user", content: "hi" }] }, before as unknown as typeof fetch).catch((e) => e);
    expect(e1).toBeInstanceOf(ChatGptPlanError);
    expect(shouldFallBack(e1)).toBe(true);

    const during = vi.fn(async () =>
      sse([
        { type: "response.output_text.delta", delta: "Hi" },
        { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } },
      ])
    );
    const e2 = await chatGptComplete({ accessToken: "t", model: "m", messages: [{ role: "user", content: "hi" }] }, during as unknown as typeof fetch).catch((e) => e);
    expect(e2).toMatchObject({ code: "subscription_sharing_usage_limit_exceeded", status: 429, fallback: true });
  });

  it("reads the plan's catalog, which is a models array, not the platform's data array", async () => {
    // The real shape for a ChatGPT plan token, per OpenAI's models-and-inference docs.
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-plan-pro", display_name: "GPT Plan Pro", visibility: "list" },
            { slug: "gpt-internal", display_name: "Internal", visibility: "hide" },
            { slug: "gpt-plan-mini", display_name: "GPT Plan Mini", visibility: "list" },
          ],
        })
      )
    );
    expect(await chatGptModelIds("t", fetchImpl as unknown as typeof fetch)).toEqual(["gpt-plan-pro", "gpt-plan-mini"]);
    expect(await chatGptModelList("t", fetchImpl as unknown as typeof fetch)).toEqual({
      models: [
        { slug: "gpt-plan-pro", displayName: "GPT Plan Pro" },
        { slug: "gpt-plan-mini", displayName: "GPT Plan Mini" },
      ],
      error: null,
    });
  });

  it("says why when the list can't be read, instead of claiming there are no models", async () => {
    const refused = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "subscription_sharing_user_not_eligible", message: "no" } }), { status: 403 })
    );
    const result = await chatGptModelList("t", refused as unknown as typeof fetch);
    expect(result.models).toEqual([]);
    expect(result.error).toMatch(/Plus or Pro/);
    expect(await chatGptModelIds("t", refused as unknown as typeof fetch)).toBeNull();
  });
});
