/**
 * PUT /api/ai-keys/models  { provider: "openai" | "anthropic" | "chatgpt", models: { <slot>: <id | null> } }
 *
 * Which of the account's own OpenAI or Claude models runs each job. OpenRouter
 * choices stay on PUT /api/models. Checked against the key's own model list
 * when it can be fetched, so a typo fails here rather than in a background
 * job; null returns a slot to the default.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { invalidateAiCredentialCache } from "@/lib/ai/credentials/resolve";
import { getAiKeysStatus } from "@/lib/ai/credentials/status";
import { loadUserAiKeys, updateAiPreferences } from "@/lib/ai/credentials/store";
import { PROVIDER_INFO } from "@/lib/ai/credentials/types";
import { directModelIds } from "@/lib/ai/models/direct-catalog";
import { isModelSlot } from "@/lib/ai/models/slots";
import { chatGptAccessToken } from "@/lib/ai/chatgpt/session";
import { chatGptModelIds } from "@/lib/ai/chatgpt/responses";
import { parseChatGptSession } from "@/lib/ai/chatgpt/types";

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const { provider, models } = body as { provider?: unknown; models?: unknown };
  if (provider !== "openai" && provider !== "anthropic" && provider !== "chatgpt") {
    return NextResponse.json({ error: "provider must be openai, anthropic or chatgpt" }, { status: 400 });
  }
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return NextResponse.json({ error: "Body must be { provider, models: { <slot>: <id or null> } }" }, { status: 400 });
  }

  const slots: Record<string, string | null> = {};
  for (const [slot, value] of Object.entries(models as Record<string, unknown>)) {
    if (!isModelSlot(slot) || slot === "embedding") {
      return NextResponse.json({ error: `Unknown slot: ${slot}` }, { status: 400 });
    }
    if (value !== null && value !== "" && typeof value !== "string") {
      return NextResponse.json({ error: `Model for ${slot} must be a string or null` }, { status: 400 });
    }
    slots[slot] = value ? String(value).trim() : null;
  }

  const stored = (await loadUserAiKeys(db, user.id)).find((k) => k.provider === provider);
  if (!stored?.apiKey) {
    return NextResponse.json({ error: `Save a working ${PROVIDER_INFO[provider].label} key first.` }, { status: 400 });
  }
  let available: Set<string> | null;
  if (provider === "chatgpt") {
    const session = parseChatGptSession(stored.apiKey);
    const ids = session ? await chatGptAccessToken(db, user.id, session).then(chatGptModelIds).catch(() => null) : null;
    available = ids ? new Set(ids) : null;
  } else {
    available = await directModelIds(provider, stored.apiKey);
  }
  if (available) {
    for (const [slot, id] of Object.entries(slots)) {
      if (id && !available.has(id)) {
        return NextResponse.json(
          { error: `Your ${PROVIDER_INFO[provider].label} key can't use "${id}" for ${slot}.` },
          { status: 400 }
        );
      }
    }
  }

  await updateAiPreferences(db, user.id, { models: { provider, slots } });
  invalidateAiCredentialCache(user.id);
  return NextResponse.json(await getAiKeysStatus(user.id), { headers: { "Cache-Control": "no-store" } });
}
