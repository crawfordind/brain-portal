import { describe, it, expect, vi } from "vitest";
import { verifyApiKey } from "@/lib/ai/credentials/verify";
import { diagnoseError } from "@/lib/system-health/diagnose";
import { credentialErrorMessage } from "@/lib/ai/credentials/types";

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe("verifyApiKey", () => {
  it("checks an OpenAI key with the free model list, and returns the models it can use", async () => {
    const fetchImpl = respond(200, { data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] });
    expect(await verifyApiKey("openai", "sk-test", fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, models: ["gpt-5", "gpt-5-mini"] });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
  });

  it("names a rejected key, a key with no credit, and an outage differently", async () => {
    const f = (s: number) => respond(s) as unknown as typeof fetch;
    expect(await verifyApiKey("openrouter", "sk-or-x", f(401))).toMatchObject({ ok: false, reason: "invalid" });
    expect(await verifyApiKey("openrouter", "sk-or-x", f(402))).toMatchObject({ ok: false, reason: "rejected", message: expect.stringMatching(/credit/) });
    expect(await verifyApiKey("openrouter", "sk-or-x", f(503))).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("checks a Claude key with exactly one plain request to Anthropic, whatever the server's environment says", async () => {
    const saved = { ...process.env };
    process.env.ANTHROPIC_BASE_URL = "https://proxy.example.com";
    process.env.ANTHROPIC_AUTH_TOKEN = "some-other-token";
    process.env.ANTHROPIC_CUSTOM_HEADERS = "x-extra: 1";
    try {
      const fetchImpl = respond(200, { data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }], has_more: false });
      const result = await verifyApiKey("anthropic", "sk-ant-api03-test", fetchImpl as unknown as typeof fetch);
      expect(result).toEqual({ ok: true, models: ["claude-opus-5-5", "claude-haiku-5-5"] });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://api.anthropic.com/v1/models?limit=100");
      expect(init?.headers).toEqual({ "x-api-key": "sk-ant-api03-test", "anthropic-version": "2023-06-01" });
    } finally {
      process.env = saved;
    }
  });

  it("follows Anthropic's model list across pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "a" }], has_more: true, last_id: "a" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "b" }], has_more: false }), { status: 200 }));
    expect(await verifyApiKey("anthropic", "sk-ant-x", fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, models: ["a", "b"] });
    expect(String(fetchImpl.mock.calls[1][0])).toContain("after_id=a");
  });

  it("passes on the provider's own explanation instead of a bare status code", async () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "anthropic-version: header is required" } };
    const result = await verifyApiKey("anthropic", "sk-ant-x", respond(400, body) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect(!result.ok && result.message).toContain('Anthropic said: "anthropic-version: header is required"');
  });

  it("reads Anthropic's 400 for an empty balance as a credit problem", async () => {
    const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } };
    const result = await verifyApiKey("anthropic", "sk-ant-x", respond(400, body) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, reason: "rejected", message: expect.stringMatching(/no credit/) });
  });

  it("never repeats a key that appears in the provider's message", async () => {
    const body = { error: { message: "Incorrect API key provided: sk-proj-abcdefghijklmnop" } };
    const result = await verifyApiKey("openai", "sk-proj-abcdefghijklmnop", respond(401, body) as unknown as typeof fetch);
    expect(!result.ok && result.message).not.toContain("abcdefghijklmnop");
  });

  it("treats a network failure as unknown, not as a bad key", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("fetch failed"); });
    expect(await verifyApiKey("openai", "sk-test", fetchImpl as unknown as typeof fetch)).toMatchObject({ ok: false, reason: "unreachable" });
  });
});

describe("System Health reads personal-key failures", () => {
  it("sends the person to Settings for their own key, not to the admin", () => {
    expect(diagnoseError(credentialErrorMessage("user_key_required", "chat")).code).toBe("AI_USER_KEY_NEEDED");
    expect(diagnoseError(credentialErrorMessage("capability_missing", "embedding")).code).toBe("AI_USER_KEY_NEEDED");
    expect(diagnoseError("OpenAI rejected your API key. Update it in Settings → AI provider.").code).toBe("AI_USER_KEY_REJECTED");
    // The server's own key still reads as an admin problem.
    expect(diagnoseError("401 No auth credentials found").code).toBe("AI_KEY_MISSING");
  });
});
