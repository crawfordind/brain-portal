/**
 * `/api/ai-keys` and "Connect OpenRouter". A key is tested before it is
 * saved, never echoed back, and the OAuth return trip only works in the
 * browser that started it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyApiKey = vi.fn();
const saveUserAiKey = vi.fn();
const exchangeFetch = vi.fn();

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "u1", email: "owner@example.com" })) }));
vi.mock("@/lib/db/client", async () => (await import("../../../helpers/db-mock")).createDbClientMock());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 20, remaining: 19, resetAt: Date.now() })) }));
vi.mock("@/lib/ai/credentials/verify", () => ({ verifyApiKey: (...a: unknown[]) => verifyApiKey(...a) }));
vi.mock("@/lib/ai/credentials/status", () => ({ getAiKeysStatus: vi.fn(async () => ({ keys: [] })) }));
vi.mock("@/lib/ai/credentials/store", () => ({
  saveUserAiKey: (...a: unknown[]) => saveUserAiKey(...a),
  deleteUserAiKey: vi.fn(),
  updateAiPreferences: vi.fn(),
}));

import { PUT } from "@/app/api/ai-keys/route";
import { GET as connect } from "@/app/api/ai-keys/openrouter/connect/route";
import { GET as callback } from "@/app/api/ai-keys/openrouter/callback/route";
import { challengeFor, PKCE_COOKIE } from "@/lib/ai/credentials/openrouter-connect";

const CLAUDE = "sk-ant-api03-" + "c".repeat(40);

function put(body: unknown) {
  return new NextRequest("https://app.example.com/api/ai-keys", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/ai-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tests the key with its provider, saves it, and never echoes it", async () => {
    verifyApiKey.mockResolvedValue({ ok: true, models: ["claude-opus-5-5"] });

    const res = await PUT(put({ provider: "anthropic", apiKey: ` ${CLAUDE} ` }));

    expect(res.status).toBe(200);
    expect(verifyApiKey).toHaveBeenCalledWith("anthropic", CLAUDE);
    expect(saveUserAiKey.mock.calls[0][1]).toMatchObject({ userId: "u1", provider: "anthropic", apiKey: CLAUDE, verified: true });
    expect(await res.text()).not.toContain(CLAUDE);
  });

  it("does not save a key the provider rejects", async () => {
    verifyApiKey.mockResolvedValue({ ok: false, reason: "invalid", message: "Anthropic didn't accept this key." });

    const res = await PUT(put({ provider: "anthropic", apiKey: CLAUDE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/didn't accept/);
    expect(saveUserAiKey).not.toHaveBeenCalled();
  });

  it("catches a key pasted under the wrong provider without calling anyone", async () => {
    const res = await PUT(put({ provider: "openai", apiKey: CLAUDE }));
    expect(res.status).toBe(400);
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("refuses personal keys when the operator turned them off", async () => {
    vi.stubEnv("AI_KEY_POLICY", "server_only");
    const res = await PUT(put({ provider: "anthropic", apiKey: CLAUDE }));
    vi.unstubAllEnvs();
    expect(res.status).toBe(403);
    expect(saveUserAiKey).not.toHaveBeenCalled();
  });
});

describe("Connect OpenRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", exchangeFetch);
  });

  it("sends the browser to OpenRouter with a PKCE challenge and keeps the verifier in an httpOnly cookie", async () => {
    vi.stubEnv("APP_URL", "https://app.example.com");
    const res = await connect(new NextRequest("https://app.example.com/api/ai-keys/openrouter/connect"));
    vi.unstubAllEnvs();

    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://openrouter.ai/auth");
    expect(location.searchParams.get("callback_url")).toBe("https://app.example.com/api/ai-keys/openrouter/callback");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    const verifier = cookie.match(new RegExp(`${PKCE_COOKIE}=([^;]+)`))![1];
    expect(location.searchParams.get("code_challenge")).toBe(challengeFor(verifier));
  });

  it("trades the code for a key server-side and saves it as a connected key", async () => {
    exchangeFetch.mockResolvedValue(new Response(JSON.stringify({ key: "sk-or-v1-minted" }), { status: 200 }));

    const res = await callback(
      new NextRequest("https://app.example.com/api/ai-keys/openrouter/callback?code=abc", {
        headers: { cookie: `${PKCE_COOKIE}=the-verifier` },
      })
    );

    expect(JSON.parse(exchangeFetch.mock.calls[0][1].body)).toEqual({
      code: "abc",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
    expect(saveUserAiKey.mock.calls[0][1]).toMatchObject({ provider: "openrouter", apiKey: "sk-or-v1-minted", source: "connect" });
    expect(new URL(res.headers.get("location")!).searchParams.get("ai")).toBe("connected");
    expect(res.headers.get("location")).not.toContain("sk-or-v1-minted");
  });

  it("refuses a return trip from a browser that didn't start it", async () => {
    const res = await callback(new NextRequest("https://app.example.com/api/ai-keys/openrouter/callback?code=abc"));
    expect(exchangeFetch).not.toHaveBeenCalled();
    expect(saveUserAiKey).not.toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).searchParams.get("ai_error")).toBe("expired");
  });
});
