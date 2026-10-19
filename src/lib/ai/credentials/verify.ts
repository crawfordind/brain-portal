/**
 * Check a key with the provider before relying on it, at no cost: every check
 * is a read of the provider's own key or model list, never a model call.
 *
 * Also the source of the model list Settings offers for OpenAI and Anthropic,
 * since only the person's key can say which models their account can use.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "./types";

export type VerifyResult =
  | { ok: true; models: string[] | null }
  | { ok: false; reason: "invalid" | "unreachable" | "rejected"; message: string };

const TIMEOUT_MS = 10_000;

async function getJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body };
}

function failure(status: number, label: string): VerifyResult {
  if (status === 401) return { ok: false, reason: "invalid", message: `${label} didn't accept this key. Check it was copied in full, or make a new one.` };
  if (status === 402) return { ok: false, reason: "rejected", message: `${label} accepted the key but the account has no credit. Add credit, then test again.` };
  if (status === 403) return { ok: false, reason: "rejected", message: `${label} accepted the key but won't let it do this. Check the key's permissions or project.` };
  return { ok: false, reason: "unreachable", message: `${label} answered with an error (${status}). Try again in a minute.` };
}

export async function verifyApiKey(
  provider: AiProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifyResult> {
  try {
    if (provider === "openrouter") {
      const { status } = await getJson("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${apiKey}` }, fetchImpl);
      // The model list is public and already handled by the catalog.
      return status === 200 ? { ok: true, models: null } : failure(status, "OpenRouter");
    }

    if (provider === "openai") {
      const { status, body } = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` }, fetchImpl);
      if (status !== 200) return failure(status, "OpenAI");
      const data = Array.isArray(body?.data) ? (body!.data as Array<{ id?: unknown }>) : [];
      return { ok: true, models: data.map((m) => m.id).filter((id): id is string => typeof id === "string").sort() };
    }

    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0, fetch: fetchImpl });
    const models: string[] = [];
    for await (const model of client.models.list({ limit: 100 })) models.push(model.id);
    return { ok: true, models };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return failure(401, "Anthropic");
    if (error instanceof Anthropic.PermissionDeniedError) return failure(403, "Anthropic");
    if (error instanceof Anthropic.APIError && typeof error.status === "number") return failure(error.status, "Anthropic");
    return {
      ok: false,
      reason: "unreachable",
      message: "Couldn't reach the provider to check the key. Try again in a minute.",
    };
  }
}
