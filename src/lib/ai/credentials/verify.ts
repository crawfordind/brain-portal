/**
 * Check a key with the provider before relying on it, at no cost: every check
 * is a read of the provider's own key or model list, never a model call.
 *
 * Also the source of the model list Settings offers for OpenAI and Anthropic,
 * since only the person's key can say which models their account can use.
 *
 * Plain `fetch` for every provider, on purpose. The Anthropic SDK reads
 * `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_CUSTOM_HEADERS`
 * from the server's environment even when it is handed a key, so a host with
 * any of those set sent the person's key somewhere else, or with a second
 * credential beside it, and the check failed with a 400 that had nothing to do
 * with the key. Here the request is exactly what is written below.
 */

import type { AiProvider } from "./types";

export type VerifyResult =
  | { ok: true; models: string[] | null }
  | { ok: false; reason: "invalid" | "unreachable" | "rejected"; message: string };

const TIMEOUT_MS = 10_000;
export const ANTHROPIC_API_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";

async function getJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body };
}

/** The provider's own explanation, which all three put at `error.message`. */
export function providerErrorText(body: Record<string, unknown> | null): string | null {
  const error = body?.error;
  const message =
    typeof error === "string" ? error : error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string" || !message.trim()) return null;
  // Never echo anything key-shaped back, and keep it to one readable line.
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key]").replace(/\s+/g, " ").trim().slice(0, 300);
}

function failure(status: number, label: string, detail: string | null = null): VerifyResult {
  const said = detail ? ` ${label} said: "${detail}"` : "";
  if (status === 401) return { ok: false, reason: "invalid", message: `${label} didn't accept this key. Check it was copied in full, or make a new one.${said}` };
  // Anthropic reports an empty balance as a 400, not a 402.
  if (status === 402 || (detail && /credit balance|billing|purchase credits/i.test(detail))) {
    return { ok: false, reason: "rejected", message: `${label} accepted the key but the account has no credit. Add credit, then test again.${said}` };
  }
  if (status === 403) return { ok: false, reason: "rejected", message: `${label} accepted the key but won't let it do this. Check the key's permissions or project.${said}` };
  if (status === 429) return { ok: false, reason: "unreachable", message: `${label} is rate limiting this key right now. Try again in a minute.${said}` };
  if (status >= 500) return { ok: false, reason: "unreachable", message: `${label} is having trouble (${status}). Try again in a minute.${said}` };
  // Not a verdict on the key itself, so a saved key isn't marked invalid for it.
  return { ok: false, reason: "unreachable", message: `${label} refused the check (${status}).${said || " Try again, or make a new key."}` };
}

export async function verifyApiKey(
  provider: AiProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifyResult> {
  try {
    if (provider === "openrouter") {
      const { status, body } = await getJson("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${apiKey}` }, fetchImpl);
      // The model list is public and already handled by the catalog.
      return status === 200 ? { ok: true, models: null } : logged(provider, status, failure(status, "OpenRouter", providerErrorText(body)));
    }

    if (provider === "openai") {
      const { status, body } = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` }, fetchImpl);
      if (status !== 200) return logged(provider, status, failure(status, "OpenAI", providerErrorText(body)));
      const data = Array.isArray(body?.data) ? (body!.data as Array<{ id?: unknown }>) : [];
      return { ok: true, models: data.map((m) => m.id).filter((id): id is string => typeof id === "string").sort() };
    }

    const models: string[] = [];
    let after: string | null = null;
    // A handful of pages at most; the loop is bounded so a bad cursor can't spin.
    for (let page = 0; page < 5; page++) {
      const url = new URL("/v1/models", ANTHROPIC_API_URL);
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after_id", after);
      const { status, body } = await getJson(
        url.toString(),
        { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
        fetchImpl
      );
      if (status !== 200) return logged(provider, status, failure(status, "Anthropic", providerErrorText(body)));
      const data = Array.isArray(body?.data) ? (body!.data as Array<{ id?: unknown }>) : [];
      for (const m of data) if (typeof m.id === "string") models.push(m.id);
      after = body?.has_more === true && typeof body.last_id === "string" ? body.last_id : null;
      if (!after) break;
    }
    return { ok: true, models };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Couldn't reach the provider to check the key. Try again in a minute.",
    };
  }
}

/** Status and the provider's words go to the server log; the key never does. */
function logged(provider: AiProvider, status: number, result: VerifyResult): VerifyResult {
  if (!result.ok) console.warn(`[ai-keys] ${provider} key check failed (${status}): ${result.message}`);
  return result;
}
