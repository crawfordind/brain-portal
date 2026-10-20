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
