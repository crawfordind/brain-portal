/**
 * GET /api/ai-keys/openrouter/callback?code=… — finish "Connect OpenRouter":
 * trade the code for a key, server to server, and save it to this account.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { invalidateAiCredentialCache } from "@/lib/ai/credentials/resolve";
import { saveUserAiKey } from "@/lib/ai/credentials/store";
import { PKCE_COOKIE, PKCE_COOKIE_PATH, exchangeCode } from "@/lib/ai/credentials/openrouter-connect";

function finish(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/settings?${query}#ai-provider`, request.url));
  // One use: the verifier is spent whatever happened.
  response.cookies.set(PKCE_COOKIE, "", { path: PKCE_COOKIE_PATH, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login?redirect=/settings", request.url));

  const code = request.nextUrl.searchParams.get("code");
  const verifier = request.cookies.get(PKCE_COOKIE)?.value;
  if (!code) return finish(request, "ai_error=cancelled");
  // No verifier: the connect was started in another browser, or took over 10 minutes.
  if (!verifier) return finish(request, "ai_error=expired");

  const exchanged = await exchangeCode(code, verifier);
  if (!exchanged.ok) return finish(request, "ai_error=exchange_failed");

  try {
    // Freshly issued by OpenRouter for this flow, so it is known to work.
    await saveUserAiKey(db, { userId: user.id, provider: "openrouter", apiKey: exchanged.key, source: "connect", verified: true });
  } catch (error) {
    console.error("[AI keys] saving connected OpenRouter key failed:", error instanceof Error ? error.message : error);
    return finish(request, "ai_error=save_failed");
  }
  invalidateAiCredentialCache(user.id);
  return finish(request, "ai=connected");
}
