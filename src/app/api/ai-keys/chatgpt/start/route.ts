/**
 * POST /api/ai-keys/chatgpt/start  { background?: boolean }  → { url }
 *
 * Begin "Sign in with ChatGPT". The browser opens `url`, the person approves
 * in ChatGPT, and ChatGPT sends them to a 127.0.0.1 address that doesn't load
 * (OpenAI only allows loopback redirects for open-source apps). They paste
 * that address into Settings, which posts it to `/finish`. The PKCE verifier,
 * state and nonce wait in an httpOnly cookie meanwhile, so only this browser
 * can finish the sign-in it started.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { encryptionSecret } from "@/lib/ai/credentials/crypto";
import { loadUserAiKeys } from "@/lib/ai/credentials/store";
import { parseAiKeyPolicy } from "@/lib/ai/credentials/types";
import { createPkcePair } from "@/lib/ai/credentials/openrouter-connect";
import { chatGptHostId, randomToken } from "@/lib/ai/chatgpt/oauth";
import { buildAuthorizeUrl, parseChatGptSession } from "@/lib/ai/chatgpt/types";
import {
  accessFor,
  encodePending,
  PENDING_COOKIE,
  PENDING_COOKIE_MAX_AGE,
  PENDING_COOKIE_PATH,
} from "@/lib/ai/chatgpt/access";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({ bucket: "ai-keys", maxRequests: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });

  if (parseAiKeyPolicy(process.env.AI_KEY_POLICY) === "server_only") {
    return NextResponse.json({ error: "Personal AI keys are turned off on this server." }, { status: 403 });
  }
  const secret = encryptionSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "This server can't store a sign-in safely yet. Ask the person who runs it to set AI_KEY_ENCRYPTION_SECRET." },
      { status: 503 }
    );
  }
  const access = await accessFor(user);
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const background = (body as { background?: unknown }).background === true;

  // A returning account reuses the client id ChatGPT issued it the first time.
  let previous = null;
  try {
    const stored = (await loadUserAiKeys(db, user.id)).find((k) => k.provider === "chatgpt");
    previous = parseChatGptSession(stored?.apiKey);
  } catch {
    previous = null;
  }

  const { verifier, challenge } = createPkcePair();
  const state = randomToken();
  const nonce = randomToken();
  const url = buildAuthorizeUrl({
    challenge,
    state,
    nonce,
    hostId: chatGptHostId(secret),
    clientId: previous?.clientId ?? null,
    idTokenHint: previous?.idToken || null,
  });

  const response = NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(
    PENDING_COOKIE,
    encodePending({ verifier, state, nonce, clientId: previous?.clientId ?? null, background }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: PENDING_COOKIE_PATH,
      maxAge: PENDING_COOKIE_MAX_AGE,
    }
  );
  return response;
}
