/**
 * GET /api/ai-keys/openrouter/connect — start "Connect OpenRouter".
 * See src/lib/ai/credentials/openrouter-connect.ts for the whole flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAppUrl } from "@/lib/app-url";
import { encryptionSecret } from "@/lib/ai/credentials/crypto";
import { parseAiKeyPolicy } from "@/lib/ai/credentials/types";
import {
  PKCE_COOKIE,
  PKCE_COOKIE_MAX_AGE,
  PKCE_COOKIE_PATH,
  authorizationUrl,
  createPkcePair,
  isAcceptableCallback,
} from "@/lib/ai/credentials/openrouter-connect";

function backToSettings(request: NextRequest, error: string) {
  return NextResponse.redirect(new URL(`/settings?ai_error=${error}#ai-provider`, request.url));
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login?redirect=/settings", request.url));

  if (parseAiKeyPolicy(process.env.AI_KEY_POLICY) === "server_only") return backToSettings(request, "disabled");
  if (!encryptionSecret()) return backToSettings(request, "no_secret");

  const callback = `${getAppUrl({ requestOrigin: request.nextUrl.origin }).replace(/\/$/, "")}/api/ai-keys/openrouter/callback`;
  if (!isAcceptableCallback(callback)) return backToSettings(request, "callback_not_https");

  const { verifier, challenge } = createPkcePair();
  const response = NextResponse.redirect(authorizationUrl(callback, challenge));
  response.cookies.set(PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the return trip is a top-level navigation from openrouter.ai.
    sameSite: "lax",
    path: PKCE_COOKIE_PATH,
    maxAge: PKCE_COOKIE_MAX_AGE,
  });
  return response;
}
