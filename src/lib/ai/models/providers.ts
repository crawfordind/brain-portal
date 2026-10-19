/**
 * Which model fills each slot when the key is OpenAI's or Anthropic's own.
 *
 * OpenRouter keys keep the live-catalog resolution in `resolve.ts`. A direct
 * key can only call its own provider's models, under that provider's names
 * ("claude-opus-5-5", not "anthropic/claude-..."), so it gets its own
 * candidates here, and the person can pick any model their key lists in
 * Settings. Pure data and functions, no imports beyond types.
 */

import type { ModelSlot } from "./slots";

export type DirectProvider = "openai" | "anthropic";

/**
 * Candidates per slot, best first. Resolution keeps the first one the
 * account's own model list includes, when that list is known.
 *
 * Anthropic: one model for every job by default. Claude Opus 5.5 is the
 * current default; the cheaper Claude Haiku 5.5 or Claude Sonnet 5.5 suits
 * the constant background work in "Everyday tasks", and that choice is the
 * person's to make in Settings.
 */
export const DIRECT_PROVIDER_CANDIDATES: Record<DirectProvider, Partial<Record<ModelSlot, string[]>>> = {
  anthropic: {
    fast: ["claude-opus-5-5"],
    deep: ["claude-opus-5-5"],
    agent: ["claude-opus-5-5"],
    vision: ["claude-opus-5-5"],
    // Anthropic has no embeddings API; see credentials/types.ts.
  },
  openai: {
    fast: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    deep: ["gpt-5", "gpt-4.1", "gpt-4o"],
    agent: ["gpt-5", "gpt-4.1", "gpt-4o"],
    vision: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    // Same model and vector width as OpenRouter's "openai/text-embedding-3-small",
    // so switching between the two keeps every stored vector comparable.
    embedding: ["text-embedding-3-small"],
  },
};

/**
 * Model ids from an OpenRouter-style setting ("vendor/model") mean nothing to
 * a direct provider. They are ignored rather than guessed at.
 */
export function isDirectModelId(id: string): boolean {
  return Boolean(id) && !id.includes("/");
}

/**
 * The ordered models to try for a slot on a direct provider.
 *
 * - The person's saved choice first, unless their key's model list is known
 *   and doesn't include it (a retired model then heals to the default).
 * - Then the candidates, keeping those the list includes. If the list is
 *   unknown (it could not be fetched), every candidate stays: losing the
 *   network must not leave a slot with nothing to try.
 * - An explicit model the caller pinned goes first when it is a direct id.
 */
export function directModelChain(input: {
  provider: DirectProvider;
  slot: ModelSlot;
  userChoice?: string | null;
  pinned?: string | null;
  availableIds?: ReadonlySet<string> | null;
}): string[] {
  const { provider, slot, userChoice, pinned, availableIds } = input;
  const offered = (id: string) => !availableIds || availableIds.has(id);
  const candidates = DIRECT_PROVIDER_CANDIDATES[provider][slot] ?? [];

  const chain = [
    ...(pinned && isDirectModelId(pinned) ? [pinned] : []),
    ...(userChoice && isDirectModelId(userChoice) && offered(userChoice) ? [userChoice] : []),
    ...candidates.filter(offered),
  ];
  const unique = chain.filter((id, index) => chain.indexOf(id) === index);
  // Nothing the account lists matched: try the candidates anyway and let the
  // provider's answer say what is wrong, rather than calling nothing.
  return unique.length > 0 ? unique : [...candidates];
}

/** Effort per job for Claude: background work runs light, reading work runs deep. */
export function claudeEffortForSlot(slot: ModelSlot | "chat"): "low" | "medium" | "high" {
  switch (slot) {
    case "fast":
    case "vision":
      return "low";
    case "deep":
    case "agent":
      return "high";
    default:
      return "medium";
  }
}
