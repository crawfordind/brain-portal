/**
 * POST /api/ai-keys/test  { provider }  re-check a saved key with its provider.
 *
 * Free: it reads the provider's key or model list, never calls a model. The
 * result is recorded, so Settings and System Health agree about the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { invalidateAiCredentialCache } from "@/lib/ai/credentials/resolve";
import { getAiKeysStatus } from "@/lib/ai/credentials/status";
import { loadUserAiKeys, recordKeyStatus } from "@/lib/ai/credentials/store";
import { isAiProvider, PROVIDER_INFO } from "@/lib/ai/credentials/types";
import { verifyApiKey } from "@/lib/ai/credentials/verify";
import { ChatGptAuthError } from "@/lib/ai/chatgpt/oauth";
import { chatGptAccessToken } from "@/lib/ai/chatgpt/session";
import { chatGptModelList } from "@/lib/ai/chatgpt/responses";
import { parseChatGptSession } from "@/lib/ai/chatgpt/types";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({ bucket: "ai-keys", maxRequests: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const { provider } = body as { provider?: unknown };
  if (!isAiProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const stored = (await loadUserAiKeys(db, user.id)).find((k) => k.provider === provider);
  if (!stored) return NextResponse.json({ error: `No ${PROVIDER_INFO[provider].label} key is saved.` }, { status: 404 });

  let ok = false;
  let message: string;
  if (!stored.apiKey) {
    await recordKeyStatus(db, user.id, provider, "unreadable", "The key can no longer be decrypted.");
    message = "This key can no longer be read (the server's secret changed). Paste it again.";
  } else if (provider === "chatgpt") {
    // A plan is checked by renewing the sign-in if needed and listing its models.
    const session = parseChatGptSession(stored.apiKey);
    try {
      if (!session) throw new ChatGptAuthError("This sign-in can't be read. Sign in with ChatGPT again.", { needsSignIn: true, status: 401 });
      const token = await chatGptAccessToken(db, user.id, session);
      const { models, error: modelError } = await chatGptModelList(token);
      ok = models.length > 0;
      message = ok
        ? `Your ChatGPT plan is connected: ${models.slice(0, 4).map((m) => m.displayName).join(", ")}${models.length > 4 ? ` and ${models.length - 4} more` : ""}.`
        : `Signed in, but couldn't read your plan's models: ${modelError ?? "none were listed"}`;
      if (ok) await recordKeyStatus(db, user.id, provider, "ok");
    } catch (error) {
      message = error instanceof Error ? error.message : "Couldn't check the ChatGPT sign-in.";
      if (error instanceof ChatGptAuthError && error.needsSignIn) await recordKeyStatus(db, user.id, provider, "invalid", message);
    }
  } else {
    const result = await verifyApiKey(provider, stored.apiKey);
    ok = result.ok;
    message = result.ok ? `${PROVIDER_INFO[provider].label} accepted the key.` : result.message;
    // "Couldn't reach the provider" says nothing about the key itself.
    if (result.ok || result.reason !== "unreachable") {
      await recordKeyStatus(db, user.id, provider, result.ok ? "ok" : "invalid", result.ok ? null : result.message);
    }
  }

  invalidateAiCredentialCache(user.id);
  return NextResponse.json({ ok, message, status: await getAiKeysStatus(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
