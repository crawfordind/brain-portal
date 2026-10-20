/**
 * "Connect OpenRouter": OpenRouter mints a key for this app in one click,
 * using its OAuth PKCE flow.
 *
 * 1. `/api/ai-keys/openrouter/connect` makes a random verifier, keeps it in a
 *    short-lived httpOnly cookie, and sends the browser to OpenRouter with the
 *    verifier's SHA-256 challenge.
 * 2. The person signs in to OpenRouter (or creates an account) and approves.
 * 3. OpenRouter sends them back to `/callback?code=…`. The server trades the
 *    code plus the verifier for a key, server to server, and stores it like a
 *    pasted one. The key is never in the browser.
 *
 * PKCE is also the CSRF guard: a code minted in someone else's browser can't
 * be redeemed here, because only this browser's cookie holds the verifier.
 */

import { createHash, randomBytes } from "crypto";

export const PKCE_COOKIE = "bp_openrouter_pkce";
export const PKCE_COOKIE_PATH = "/api/ai-keys/openrouter";
export const PKCE_COOKIE_MAX_AGE = 10 * 60;

const AUTH_URL = "https://openrouter.ai/auth";
const EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: challengeFor(verifier) };
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizationUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * OpenRouter only accepts an https callback, or http on localhost for local
 * development. Anything else would fail on their side with a confusing page.
 */
export function isAcceptableCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function exchangeCode(
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  try {
    const res = await fetchImpl(EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { key?: unknown } | null;
    if (res.ok && typeof body?.key === "string" && body.key.startsWith("sk-or-")) return { ok: true, key: body.key };
    return { ok: false, message: `OpenRouter didn't issue a key (${res.status}). Try connecting again.` };
  } catch {
    return { ok: false, message: "Couldn't reach OpenRouter. Try connecting again." };
  }
}
