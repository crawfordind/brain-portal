/**
 * The network half of Sign in with ChatGPT: exchanging the code, verifying
 * the ID token, refreshing, revoking. See `types.ts` for the flow.
 */

import { createHmac, createPublicKey, createVerify, randomBytes, type JsonWebKey } from "crypto";
import {
  CHATGPT_API_BASE,
  CHATGPT_ISSUER,
  CHATGPT_PLAN_SCOPE,
  CHATGPT_REDIRECT_URI,
  CHATGPT_TOKEN_URL,
  type ChatGptSession,
} from "./types";

const TIMEOUT_MS = 15_000;

/**
 * A stable id for this installation, as OpenAI asks for. Derived from the
 * server secret, so it is the same on every instance of one deployment and
 * needs no storage, and it is never an email or a user id.
 */
export function chatGptHostId(secret: string): string {
  const hex = createHmac("sha256", secret).update("brain-portal:siwc-host:v1").digest("hex");
  // Shaped as an RFC 9562 version 8 (custom) UUID.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postForm(body: Record<string, string>, fetchImpl: typeof fetch): Promise<{ status: number; json: TokenResponse }> {
  const res = await fetchImpl(CHATGPT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = ((await res.json().catch(() => ({}))) ?? {}) as TokenResponse;
  return { status: res.status, json };
}

export class ChatGptAuthError extends Error {
  /** True when signing in again is the only fix. */
  readonly needsSignIn: boolean;
  readonly status: number;
  constructor(message: string, options: { needsSignIn: boolean; status: number }) {
    super(message);
    this.name = "ChatGptAuthError";
    this.needsSignIn = options.needsSignIn;
    this.status = options.status;
  }
}

function base64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

let jwksCache: { keys: Array<JsonWebKey & { kid?: string }>; expiresAt: number } | null = null;

async function signingKeys(fetchImpl: typeof fetch, force = false) {
  if (!force && jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const discovery = await fetchImpl(`${CHATGPT_ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const config = (await discovery.json()) as { jwks_uri?: string };
  if (!config.jwks_uri) throw new Error("ChatGPT's sign-in configuration has no key set");
  const res = await fetchImpl(config.jwks_uri, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  jwksCache = { keys: body.keys ?? [], expiresAt: Date.now() + 60 * 60 * 1000 };
  return jwksCache.keys;
}

/** Test seam. */
export function clearJwksCache(): void {
  jwksCache = null;
}

/**
 * Check the ID token the way OpenAI requires: signed by OpenAI's published
 * keys, issued by OpenAI, for this app's client id, with this sign-in's nonce,
 * and not expired. Returns its claims.
 */
export async function verifyIdToken(
  idToken: string,
  expect: { clientId: string; nonce: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<Record<string, unknown>> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("ChatGPT returned a malformed ID token");
  const header = base64urlJson(parts[0]) as { alg?: string; kid?: string };
  const claims = base64urlJson(parts[1]);
  if (header.alg !== "RS256") throw new Error(`Unexpected ID token algorithm: ${header.alg}`);

  let keys = await signingKeys(fetchImpl);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Keys rotate; one fresh read before giving up.
    keys = await signingKeys(fetchImpl, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("ChatGPT's ID token was signed with an unknown key");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"))) {
    throw new Error("ChatGPT's ID token signature didn't check out");
  }

  const iss = typeof claims.iss === "string" ? claims.iss.replace(/\/$/, "") : "";
  if (iss !== CHATGPT_ISSUER) throw new Error("The ID token wasn't issued by OpenAI");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.clientId)) throw new Error("The ID token was issued to a different app");
  if (claims.nonce !== expect.nonce) throw new Error("The ID token doesn't belong to this sign-in");
  if (typeof claims.exp === "number" && claims.exp * 1000 < now - 60_000) throw new Error("The ID token has expired");
  return claims;
}

function sessionFrom(
  json: TokenResponse,
  base: { clientId: string; hostId: string; email: string | null; idToken?: string },
  now = Date.now()
): ChatGptSession {
  if (!json.access_token || !json.refresh_token) {
    throw new ChatGptAuthError("ChatGPT didn't return a usable sign-in. Try again.", { needsSignIn: true, status: 400 });
  }
  return {
    clientId: base.clientId,
    hostId: base.hostId,
    idToken: json.id_token ?? base.idToken ?? "",
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + Math.max(60, Number(json.expires_in) || 3600) * 1000,
    scopes: (json.scope ?? "").split(/\s+/).filter(Boolean),
    email: base.email,
    savedAt: now,
  };
}

/** Trade the pasted code for tokens, and check that plan usage was granted. */
export async function exchangeChatGptCode(
  input: { code: string; verifier: string; clientId: string; nonce: string; hostId: string },
  fetchImpl: typeof fetch = fetch
): Promise<ChatGptSession> {
  const { status, json } = await postForm(
    {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      redirect_uri: CHATGPT_REDIRECT_URI,
      resource: CHATGPT_API_BASE,
    },
    fetchImpl
  );
  if (status !== 200) {
    throw new ChatGptAuthError(
      `ChatGPT didn't accept that sign-in (${json.error_description || json.error || status}). Start again: each sign-in address works once.`,
      { needsSignIn: true, status }
    );
  }
  if (!json.id_token) throw new ChatGptAuthError("ChatGPT didn't return an ID token. Try again.", { needsSignIn: true, status: 400 });
  const claims = await verifyIdToken(json.id_token, { clientId: input.clientId, nonce: input.nonce }, fetchImpl);
  const session = sessionFrom(json, {
    clientId: input.clientId,
    hostId: input.hostId,
    email: typeof claims.email === "string" ? claims.email : null,
  });
  // A valid ID token alone does not authorize plan usage; the scope must be granted.
  if (session.scopes.length > 0 && !session.scopes.includes(CHATGPT_PLAN_SCOPE)) {
    throw new ChatGptAuthError(
      "You signed in, but didn't allow Brain Portal to use your ChatGPT plan. Start again and allow plan usage.",
      { needsSignIn: true, status: 403 }
    );
  }
  return session;
}

/** Refresh tokens rotate: the old one stops working once this succeeds. */
export async function refreshChatGptSession(session: ChatGptSession, fetchImpl: typeof fetch = fetch): Promise<ChatGptSession> {
  const { status, json } = await postForm(
    {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: session.clientId,
      resource: CHATGPT_API_BASE,
    },
    fetchImpl
  );
  if (status !== 200) {
    const permanent = status === 400 || status === 401 || json.error === "invalid_grant";
    throw new ChatGptAuthError(
      permanent
        ? "Your ChatGPT sign-in has ended. Sign in with ChatGPT again in Settings → AI provider."
        : `ChatGPT couldn't renew the sign-in right now (${status}).`,
      { needsSignIn: permanent, status: permanent ? 401 : status }
    );
  }
  const next = sessionFrom(json, { clientId: session.clientId, hostId: session.hostId, email: session.email, idToken: session.idToken });
  if (next.scopes.length === 0) next.scopes = session.scopes;
  return next;
}

/** Best effort: an empty 200 is success, including for a token already dead. */
export async function revokeChatGptSession(session: ChatGptSession, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const discovery = await fetchImpl(`${CHATGPT_ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const config = (await discovery.json()) as { revocation_endpoint?: string };
    if (!config.revocation_endpoint) return;
    await fetchImpl(config.revocation_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: session.refreshToken, token_type_hint: "refresh_token", client_id: session.clientId }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Removing the saved sign-in still stops Brain Portal using it.
  }
}
