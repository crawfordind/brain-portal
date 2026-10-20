import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync, createSign } from "crypto";
import {
  chatGptHostId,
  ChatGptAuthError,
  clearJwksCache,
  exchangeChatGptCode,
  refreshChatGptSession,
  verifyIdToken,
} from "@/lib/ai/chatgpt/oauth";
import type { ChatGptSession } from "@/lib/ai/chatgpt/types";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

function sign(claims: Record<string, unknown>, kid = "k1"): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  return `${body}.${signer.sign(privateKey).toString("base64url")}`;
}

const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: "https://auth.openai.com",
  aud: "oaiapp_1",
  nonce: "n1",
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: "owner@example.com",
  ...over,
});

function fetchWith(tokenResponse: { status: number; body: unknown }) {
  return vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify({ jwks_uri: "https://auth.openai.com/jwks", revocation_endpoint: "https://auth.openai.com/revoke" }));
    }
    if (u === "https://auth.openai.com/jwks") return new Response(JSON.stringify({ keys: [jwk] }));
    return new Response(JSON.stringify(tokenResponse.body), { status: tokenResponse.status });
  });
}

describe("ChatGPT ID token checks", () => {
  beforeEach(() => clearJwksCache());

  it("accepts a token signed by OpenAI's key, for this app and this sign-in", async () => {
    const claims = await verifyIdToken(sign(goodClaims()), { clientId: "oaiapp_1", nonce: "n1" }, fetchWith({ status: 200, body: {} }) as unknown as typeof fetch);
    expect(claims.email).toBe("owner@example.com");
  });

  it("refuses a token for another app, another sign-in, or with a forged signature", async () => {
    const f = fetchWith({ status: 200, body: {} }) as unknown as typeof fetch;
    await expect(verifyIdToken(sign(goodClaims({ aud: "oaiapp_other" })), { clientId: "oaiapp_1", nonce: "n1" }, f)).rejects.toThrow(/different app/);
    await expect(verifyIdToken(sign(goodClaims({ nonce: "other" })), { clientId: "oaiapp_1", nonce: "n1" }, f)).rejects.toThrow(/this sign-in/);
    const forged = sign(goodClaims()).replace(/\.[^.]+$/, ".AAAA");
    await expect(verifyIdToken(forged, { clientId: "oaiapp_1", nonce: "n1" }, f)).rejects.toThrow(/signature/);
  });
});

describe("exchanging and refreshing", () => {
  beforeEach(() => clearJwksCache());

  it("saves a session only when plan usage was granted", async () => {
    const tokens = { access_token: "at", refresh_token: "rt", id_token: sign(goodClaims()), expires_in: 3600 };
    const ok = fetchWith({ status: 200, body: { ...tokens, scope: "openid email offline_access resource.invoke chatgpt.tokens.use.direct" } });
    const session = await exchangeChatGptCode({ code: "c", verifier: "v", clientId: "oaiapp_1", nonce: "n1", hostId: "h" }, ok as unknown as typeof fetch);
    expect(session).toMatchObject({ clientId: "oaiapp_1", accessToken: "at", refreshToken: "rt", email: "owner@example.com" });
    const body = new URLSearchParams(String(ok.mock.calls.find((c) => String(c[0]).includes("/oauth/token"))![1]!.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: "authorization_code",
      client_id: "oaiapp_1",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      resource: "https://api.openai.com/v1",
      code_verifier: "v",
    });

    clearJwksCache();
    const noPlan = fetchWith({ status: 200, body: { ...tokens, scope: "openid email" } });
    await expect(
      exchangeChatGptCode({ code: "c", verifier: "v", clientId: "oaiapp_1", nonce: "n1", hostId: "h" }, noPlan as unknown as typeof fetch)
    ).rejects.toThrow(/didn't allow Brain Portal to use your ChatGPT plan/);
  });

  it("stores the rotated refresh token, and asks for a new sign-in when refresh is refused", async () => {
    const session: ChatGptSession = {
      clientId: "oaiapp_1", hostId: "h", idToken: "", accessToken: "old", refreshToken: "rt1",
      expiresAt: Date.now(), scopes: ["chatgpt.tokens.use.direct"], email: null, savedAt: 0,
    };
    const next = await refreshChatGptSession(
      session,
      fetchWith({ status: 200, body: { access_token: "new", refresh_token: "rt2", expires_in: 3600 } }) as unknown as typeof fetch
    );
    expect(next).toMatchObject({ accessToken: "new", refreshToken: "rt2", scopes: ["chatgpt.tokens.use.direct"] });

    const refused = await refreshChatGptSession(session, fetchWith({ status: 400, body: { error: "invalid_grant" } }) as unknown as typeof fetch).catch((e) => e);
    expect(refused).toBeInstanceOf(ChatGptAuthError);
    expect(refused.needsSignIn).toBe(true);
  });

  it("derives a stable host id that is never an email or user id", () => {
    const id = chatGptHostId("a-secret-long-enough");
    expect(id).toBe(chatGptHostId("a-secret-long-enough"));
    expect(id).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(chatGptHostId("another-secret-long-enough"));
  });
});
