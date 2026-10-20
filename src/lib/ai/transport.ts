/**
 * One SDK client per (provider, key).
 *
 * OpenRouter and OpenAI speak the same API, so both use the `openai` SDK with
 * a different base URL. Anthropic uses its own SDK (`anthropic.ts`). Clients
 * are cached by a hash of the key, never the key itself, and the cache is
 * bounded so a server with many accounts doesn't keep one per person forever.
 */

import { createHash } from "crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { getAppUrl } from "@/lib/app-url";
import type { ResolvedCredential } from "./credentials/resolve";
import { ANTHROPIC_API_URL } from "./credentials/verify";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

const MAX_CLIENTS = 50;
const clients = new Map<string, OpenAI | Anthropic>();

function cacheKey(credential: Pick<ResolvedCredential, "provider" | "apiKey">): string {
  return `${credential.provider}:${createHash("sha256").update(credential.apiKey).digest("hex").slice(0, 24)}`;
}

function remember<T extends OpenAI | Anthropic>(key: string, client: T): T {
  if (clients.size >= MAX_CLIENTS) {
    const oldest = clients.keys().next().value;
    if (oldest !== undefined) clients.delete(oldest);
  }
  clients.set(key, client);
  return client;
}

/** The `openai` SDK pointed at OpenRouter or OpenAI, for this credential. */
export function openAiCompatibleClient(credential: Pick<ResolvedCredential, "provider" | "apiKey">): OpenAI {
  if (credential.provider === "anthropic") throw new Error("Anthropic keys use the Anthropic client");
  const key = cacheKey(credential);
  const hit = clients.get(key);
  if (hit instanceof OpenAI) return hit;

  return remember(
    key,
    new OpenAI(
      credential.provider === "openrouter"
        ? {
            baseURL: OPENROUTER_BASE_URL,
            apiKey: credential.apiKey,
            defaultHeaders: { "HTTP-Referer": getAppUrl(), "X-Title": "Brain Portal" },
            // The SDK would otherwise add these from OPENAI_ORG_ID / OPENAI_PROJECT_ID.
            organization: null,
            project: null,
          }
        : { baseURL: OPENAI_BASE_URL, apiKey: credential.apiKey, organization: null, project: null }
    )
  );
}

export function anthropicClient(credential: Pick<ResolvedCredential, "provider" | "apiKey">): Anthropic {
  if (credential.provider !== "anthropic") throw new Error("Only Anthropic keys use the Anthropic client");
  const key = cacheKey(credential);
  const hit = clients.get(key);
  if (hit instanceof Anthropic) return hit;
  // Retries stay in our own loop (client.ts), so one policy covers every provider.
  // baseURL and authToken are pinned because the SDK otherwise reads
  // ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from the server's environment and
  // sends the person's key there, or beside a second credential.
  return remember(
    key,
    new Anthropic({ apiKey: credential.apiKey, authToken: null, baseURL: ANTHROPIC_API_URL, maxRetries: 0 })
  );
}

/** Test seam. */
export function clearClientCache(): void {
  clients.clear();
}
