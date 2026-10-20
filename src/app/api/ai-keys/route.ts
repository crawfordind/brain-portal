/**
 * Personal AI provider keys.
 *
 * GET    /api/ai-keys                 what Settings shows (never a key)
 * PUT    /api/ai-keys                 { provider, apiKey } test with the provider, then save
 * PATCH  /api/ai-keys                 { preferred?: provider | null, routing?: { fallback?, serverFallback?, chatgptBackground? } }
 * DELETE /api/ai-keys?provider=...    remove one key
 *
 * Session-only on purpose: no MCP key can read, add or change these. A key
 * leaves the server only toward its own provider.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { encryptionSecret } from "@/lib/ai/credentials/crypto";
import { invalidateAiCredentialCache } from "@/lib/ai/credentials/resolve";
import { getAiKeysStatus } from "@/lib/ai/credentials/status";
import { deleteUserAiKey, loadUserAiKeys, saveUserAiKey, updateAiPreferences } from "@/lib/ai/credentials/store";
import { revokeChatGptSession } from "@/lib/ai/chatgpt/oauth";
import { parseChatGptSession } from "@/lib/ai/chatgpt/types";
import { isMissingUserAiKeysTable } from "@/lib/ai/credentials/schema";
import {
  isAiProvider,
  keyFormatProblem,
  normalizeApiKey,
  parseAiKeyPolicy,
  PROVIDER_INFO,
  type AiProvider,
} from "@/lib/ai/credentials/types";
import { verifyApiKey } from "@/lib/ai/credentials/verify";

const NO_STORE = { "Cache-Control": "no-store" };

function notMigrated() {
  return NextResponse.json(
    { error: "Personal AI keys need a database update on this server (npm run db:migrate)." },
    { status: 503 }
  );
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getAiKeysStatus(user.id), { headers: NO_STORE });
  } catch (error) {
    console.error("[API] GET /api/ai-keys failed:", error);
    return NextResponse.json({ error: "Couldn't load your AI keys" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Each save tests the key with the provider: bound how fast that can be done.
  const limit = await checkRateLimit({ bucket: "ai-keys", maxRequests: 20, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  if (parseAiKeyPolicy(process.env.AI_KEY_POLICY) === "server_only") {
    return NextResponse.json({ error: "Personal AI keys are turned off on this server." }, { status: 403 });
  }
  if (!encryptionSecret()) {
    return NextResponse.json(
      { error: "This server can't store keys safely yet. Ask the person who runs it to set AI_KEY_ENCRYPTION_SECRET." },
      { status: 503 }
    );
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const { provider, apiKey } = body as { provider?: unknown; apiKey?: unknown };
  if (!isAiProvider(provider)) return NextResponse.json({ error: "Choose OpenRouter, OpenAI or Anthropic." }, { status: 400 });
  if (typeof apiKey !== "string") return NextResponse.json({ error: "Paste your API key." }, { status: 400 });

  const key = normalizeApiKey(apiKey);
  const problem = keyFormatProblem(provider, key);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // A key that doesn't work is never saved: finding out at the next background
  // job, hours later, is how a key problem used to look like a broken app.
  const verified = await verifyApiKey(provider, key);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.message, reason: verified.reason }, { status: 400 });
  }

  try {
    await saveUserAiKey(db, { userId: user.id, provider, apiKey: key, source: "manual", verified: true });
  } catch (error) {
    if (isMissingUserAiKeysTable(error)) return notMigrated();
    console.error("[API] PUT /api/ai-keys failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Couldn't save the key" }, { status: 500 });
  }
  invalidateAiCredentialCache(user.id);

  return NextResponse.json(
    { saved: provider, message: `${PROVIDER_INFO[provider].label} key saved and working.`, status: await getAiKeysStatus(user.id) },
    { headers: NO_STORE }
  );
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const { preferred, routing } = body as { preferred?: unknown; routing?: unknown };
  if (preferred !== undefined && preferred !== null && !isAiProvider(preferred)) {
    return NextResponse.json({ error: "preferred must be openrouter, openai, anthropic, chatgpt or null" }, { status: 400 });
  }
  const routingUpdate: { fallback?: boolean; serverFallback?: boolean; chatgptBackground?: boolean } = {};
  if (routing !== undefined) {
    if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
      return NextResponse.json({ error: "routing must be an object" }, { status: 400 });
    }
    for (const key of ["fallback", "serverFallback", "chatgptBackground"] as const) {
      const value = (routing as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") return NextResponse.json({ error: `routing.${key} must be true or false` }, { status: 400 });
      routingUpdate[key] = value;
    }
  }

  await updateAiPreferences(db, user.id, {
    ...(preferred !== undefined ? { provider: preferred as AiProvider | null } : {}),
    ...(Object.keys(routingUpdate).length > 0 ? { routing: routingUpdate } : {}),
  });
  invalidateAiCredentialCache(user.id);
  return NextResponse.json(await getAiKeysStatus(user.id), { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = request.nextUrl.searchParams.get("provider");
  if (!isAiProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  try {
    if (provider === "chatgpt") {
      // Tell OpenAI too, so the sign-in stops working everywhere, not just here.
      const session = parseChatGptSession((await loadUserAiKeys(db, user.id)).find((k) => k.provider === "chatgpt")?.apiKey);
      if (session) await revokeChatGptSession(session);
    }
    await deleteUserAiKey(db, user.id, provider);
  } catch (error) {
    if (isMissingUserAiKeysTable(error)) return notMigrated();
    throw error;
  }
  invalidateAiCredentialCache(user.id);
  return NextResponse.json(await getAiKeysStatus(user.id), { headers: NO_STORE });
}
