/**
 * Turning a slot into an ordered list of models to actually try.
 *
 * The rule that matters: **a model id is only used if the live catalog still
 * offers it.** Providers retire ids without warning, and the old behavior — a
 * hardcoded constant passed straight to the API — turned that into a dead
 * subsystem and a support conversation. Here a retired id simply fails the
 * catalog check and the next candidate takes its place, including when the
 * retired id is the user's own saved choice.
 *
 * The chain always ends at the Auto Router for chat slots, so there is a
 * terminal option that cannot 404.
 *
 * Pure and dependency-free, so every branch below is unit-testable without a
 * network or a database.
 */

import {
  AUTO_ROUTER_MODEL,
  SLOT_DEFINITIONS,
  type ModelSlot,
} from "./slots";

export type SelectionSource =
  | "user"          // explicitly chosen in Settings
  | "environment"   // OPENROUTER_MODEL and friends
  | "default"       // the slot's top surviving candidate
  | "auto"          // nothing else survived; the Auto Router is carrying it
  | "unresolved";   // no catalog available and nothing to fall back to

export interface ResolvedSlot {
  slot: ModelSlot;
  /** The model to send first. */
  primary: string;
  /** Everything to try, in order, primary included. Never empty. */
  chain: string[];
  /** Where `primary` came from — drives what Settings shows. */
  source: SelectionSource;
  /**
   * Set when a configured id was dropped because the catalog no longer lists
   * it. This is what lets Settings say "the model you picked is gone" rather
   * than silently using something else.
   */
  retiredSelection?: string;
}

export interface ResolveOptions {
  slot: ModelSlot;
  /** The user's saved choice for this slot, if any. */
  userChoice?: string | null;
  /** An environment override, if any. */
  envChoice?: string | null;
  /**
   * Ids the live catalog currently offers. Pass `null` when the catalog could
   * not be fetched — resolution then trusts the configured ids rather than
   * discarding everything on the strength of a failed network call.
   */
  availableIds: Set<string> | null;
  /** Ids that additionally accept image input; only consulted for vision slots. */
  visionCapableIds?: Set<string> | null;
}

/** How many candidates to keep behind the primary. Enough to survive an outage. */
const MAX_CHAIN_LENGTH = 4;

export function resolveSlot(options: ResolveOptions): ResolvedSlot {
  const { slot, userChoice, envChoice, availableIds, visionCapableIds } = options;
  const definition = SLOT_DEFINITIONS[slot];

  // A null catalog means "we couldn't check", not "nothing exists". Failing to
  // reach openrouter.ai must not knock a working deployment onto the Auto
  // Router, so in that case every configured id is taken at face value.
  const offered = (id: string): boolean => {
    if (availableIds === null) return true;
    if (!availableIds.has(id)) return false;
    // For vision, being listed isn't enough — it has to accept images.
    if (definition.requiresVision && visionCapableIds) {
      return visionCapableIds.has(id);
    }
    return true;
  };

  const chain: string[] = [];
  const push = (id: string) => {
    if (id && !chain.includes(id)) chain.push(id);
  };

  let source: SelectionSource = "default";
  let retiredSelection: string | undefined;

  // 1. The user's explicit choice, when it is still real.
  if (userChoice) {
    if (offered(userChoice)) {
      push(userChoice);
      source = "user";
    } else {
      retiredSelection = userChoice;
    }
  }

  // 2. An environment override, same treatment.
  if (chain.length === 0 && envChoice) {
    if (offered(envChoice)) {
      push(envChoice);
      source = "environment";
    } else if (!retiredSelection) {
      retiredSelection = envChoice;
    }
  }

  // 3. The slot's candidates, best first, keeping only what survives.
  for (const candidate of definition.candidates) {
    if (chain.length >= MAX_CHAIN_LENGTH) break;
    if (offered(candidate)) push(candidate);
  }

  // 4. The floor. For chat slots the Auto Router always works; for embeddings
  //    there is no such thing, so an unresolvable slot says so honestly rather
  //    than pretending a text model can produce a 1536-dim vector.
  if (definition.autoRouterEligible) {
    push(AUTO_ROUTER_MODEL);
    if (chain.length === 1) source = "auto";
  }

  if (chain.length === 0) {
    // Embeddings with an empty catalog match: keep the first declared
    // candidate so the caller has something to attempt and a real error to
    // report, rather than an empty chain to crash on.
    push(definition.candidates[0]);
    source = "unresolved";
  }

  return {
    slot,
    primary: chain[0],
    chain,
    source,
    ...(retiredSelection ? { retiredSelection } : {}),
  };
}

/**
 * Candidates a user may pick for a slot, newest-first within what exists.
 *
 * Vision slots hide text-only models: offering one would let the user
 * configure a combination that cannot work.
 */
export function selectableModels(
  slot: ModelSlot,
  availableIds: Set<string>,
  visionCapableIds?: Set<string> | null
): string[] {
  const definition = SLOT_DEFINITIONS[slot];
  return [...availableIds].filter((id) => {
    if (id === AUTO_ROUTER_MODEL) return definition.autoRouterEligible;
    if (definition.requiresVision && visionCapableIds) {
      return visionCapableIds.has(id);
    }
    if (definition.slot === "embedding") {
      // Embedding models are a distinct endpoint; matching on the id is crude
      // but the catalog does not otherwise mark them.
      return id.includes("embedding");
    }
    return !id.includes("embedding");
  });
}

/** The recommended id for a slot: its best candidate that currently exists. */
export function recommendedModel(
  slot: ModelSlot,
  availableIds: Set<string> | null,
  visionCapableIds?: Set<string> | null
): string | null {
  const definition = SLOT_DEFINITIONS[slot];
  for (const candidate of definition.candidates) {
    if (availableIds === null) return candidate;
    if (!availableIds.has(candidate)) continue;
    if (definition.requiresVision && visionCapableIds && !visionCapableIds.has(candidate)) {
      continue;
    }
    return candidate;
  }
  return null;
}
