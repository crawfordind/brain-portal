/**
 * The models a direct OpenAI or Anthropic key can use, from that provider's
 * own model list, cached per key (by hash) for an hour.
 *
 * Null means "unknown": the list could not be fetched. Resolution then keeps
 * every candidate rather than none, the same rule `catalog.ts` follows for
 * OpenRouter.
 */

import { createHash } from "crypto";
import { verifyApiKey } from "../credentials/verify";
import type { DirectProvider } from "./providers";

const TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ids: Set<string> | null; expiresAt: number }>();

export async function directModelIds(
  provider: DirectProvider,
  apiKey: string
): Promise<Set<string> | null> {
  const key = `${provider}:${createHash("sha256").update(apiKey).digest("hex").slice(0, 24)}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.ids;

  const result = await verifyApiKey(provider, apiKey);
  const ids = result.ok && result.models ? new Set(result.models) : null;
  cache.set(key, { ids, expiresAt: Date.now() + (ids ? TTL_MS : FAILURE_TTL_MS) });
  return ids;
}

/** Test seam. */
export function clearDirectCatalogCache(): void {
  cache.clear();
}
