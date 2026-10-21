/**
 * POST /api/ai-keys/chatgpt/finish  { callbackUrl }
 *
 * Finish "Sign in with ChatGPT" with the address the person pasted: check it
 * belongs to the sign-in this browser started, trade the code for tokens,
 * verify the ID token, confirm plan usage was granted, and save the sign-in
 * encrypted, like a key. Then ChatGPT becomes the first choice for AI.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { encryptionSecret } from "@/lib/ai/credentials/crypto";
import { invalidateAiCredentialCache } from "@/lib/ai/credentials/resolve";
import { getAiKeysStatus } from "@/lib/ai/credentials/status";
import { updateAiPreferences } from "@/lib/ai/credentials/store";
import { isMissingUserAiKeysTable } from "@/lib/ai/credentials/schema";
import { chatGptHostId, ChatGptAuthError, exchangeChatGptCode } from "@/lib/ai/chatgpt/oauth";
import { saveChatGptSession } from "@/lib/ai/chatgpt/session";
import { chatGptModelList } from "@/lib/ai/chatgpt/responses";
import { parseCallbackUrl } from "@/lib/ai/chatgpt/types";
import { accessFor, decodePending, PENDING_COOKIE, PENDING_COOKIE_PATH } from "@/lib/ai/chatgpt/access";
import { timingSafeEqual } from "crypto";

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({ bucket: "ai-keys", maxRequests: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Wait a few minutes." }, { status: 429 });

  const secret = encryptionSecret();
  if (!secret) return NextResponse.json({ error: "This server can't store a sign-in safely yet." }, { status: 503 });
  const access = await accessFor(user);
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 });

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const pasted = (body as { callbackUrl?: unknown }).callbackUrl;
  if (typeof pasted !== "string") return NextResponse.json({ error: "Paste the address ChatGPT sent you to." }, { status: 400 });

  const pending = decodePending(request.cookies.get(PENDING_COOKIE)?.value);
  if (!pending) {
    return NextResponse.json(
      { error: "This sign-in has expired or was started in another browser. Press Sign in with ChatGPT again." },
      { status: 400 }
    );
  }
  const callback = parseCallbackUrl(pasted);
  if (!callback.ok) return NextResponse.json({ error: callback.message }, { status: 400 });
  if (!sameText(callback.state, pending.state)) {
    return NextResponse.json(
      { error: "That address is from a different sign-in. Use the one from the ChatGPT tab you opened last." },
      { status: 400 }
    );
  }
  const clientId = callback.clientId ?? pending.clientId;
  if (!clientId) {
    return NextResponse.json({ error: "ChatGPT didn't say which app it registered. Copy the whole address and try again." }, { status: 400 });
  }

  let session;
  try {
    session = await exchangeChatGptCode({
      code: callback.code,
      verifier: pending.verifier,
      clientId,
      nonce: pending.nonce,
      hostId: chatGptHostId(secret),
    });
  } catch (error) {
    const message =
      error instanceof ChatGptAuthError
        ? error.message
        : `Couldn't finish the ChatGPT sign-in: ${error instanceof Error ? error.message : "unknown error"}`;
    console.warn("[ai-keys] ChatGPT sign-in failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // A plan that lists no models can't run anything; say so now, not later.
  const { models, error: modelError } = await chatGptModelList(session.accessToken);

  try {
    await saveChatGptSession(db, user.id, session, models.length > 0);
  } catch (error) {
    if (isMissingUserAiKeysTable(error)) {
      return NextResponse.json({ error: "Personal AI keys need a database update on this server (npm run db:migrate)." }, { status: 503 });
    }
    throw error;
  }
  // Connecting a plan means "use this first"; background use only if they agreed.
  await updateAiPreferences(db, user.id, { provider: "chatgpt", routing: { chatgptBackground: pending.background } });
  invalidateAiCredentialCache(user.id);

  const response = NextResponse.json(
    {
      saved: "chatgpt",
      message:
        models.length > 0
          ? `You're using your ChatGPT plan${session.email ? ` (${session.email})` : ""}, with ${models.length} model${models.length === 1 ? "" : "s"}. Brain Portal tries it first.`
          : `Signed in, but couldn't read your plan's models: ${modelError ?? "none were listed"} Press Test on the ChatGPT card to try again.`,
      status: await getAiKeysStatus(user.id),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set(PENDING_COOKIE, "", { path: PENDING_COOKIE_PATH, maxAge: 0 });
  return response;
}
