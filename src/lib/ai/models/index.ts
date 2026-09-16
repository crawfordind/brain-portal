/**
 * Runtime model selection.
 *
 * Ties the three pure pieces together: the user's saved choice (stored as JSON
 * on `users.preferences`, so no migration), the live catalog, and the slot
 * resolver. Callers ask for a *job* — `getModelChain("fast", userId)` — and get
 * back an ordered list of models to try.
 */

import { db, queryOne } from "@/lib/db/client";
import { fetchModelCatalog, type ModelCatalog } from "./catalog";
import { resolveSlot, type ResolvedSlot } from "./resolve";
import {
  MODEL_SLOTS,
  envOverrideForSlot,
  isModelSlot,
  type ModelSlot,
} from "./slots";

export type { ModelSlot } from "./slots";
export type { ResolvedSlot } from "./resolve";
export { MODEL_SLOTS, SLOT_DEFINITIONS, AUTO_ROUTER_MODEL } from "./slots";
export { fetchModelCatalog, type CatalogModel, type ModelCatalog } from "./catalog";
export { resolveSlot, selectableModels, recommendedModel } from "./resolve";

/** A user's per-slot choices. Absent keys mean "use the recommended default". */
export type ModelPreferences = Partial<Record<ModelSlot, string>>;

/**
 * Resolution is hit on every LLM call, so the DB read is cached briefly. Short
 * enough that changing a model in Settings takes effect while the user is
 * still looking at the page.
 */
const PREFERENCE_TTL_MS = 30 * 1000;
const preferenceCache = new Map<string, { prefs: ModelPreferences; expiresAt: number }>();

export async function getModelPreferences(userId: string): Promise<ModelPreferences> {
  const cachedEntry = preferenceCache.get(userId);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) return cachedEntry.prefs;

  let prefs: ModelPreferences = {};
  try {
    const row = await queryOne<{ preferences: string }>(
      "SELECT preferences FROM users WHERE id = ?",
      [userId]
    );
    prefs = parseModelPreferences(row?.preferences);
  } catch (error) {
    // A preferences read must never take down an AI call; defaults are fine.
    console.error("[Models] failed to read preferences:", error);
  }

  preferenceCache.set(userId, { prefs, expiresAt: Date.now() + PREFERENCE_TTL_MS });
  return prefs;
}

/** Pull the `models` object out of the free-form preferences blob, defensively. */
export function parseModelPreferences(raw: string | null | undefined): ModelPreferences {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    const models = (parsed as { models?: unknown } | null)?.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) return {};

    const result: ModelPreferences = {};
    for (const [key, value] of Object.entries(models as Record<string, unknown>)) {
      if (isModelSlot(key) && typeof value === "string" && value.trim()) {
        result[key] = value.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Merge new slot choices into the user's preferences.
 *
 * Read-modify-write on a JSON column, so it deliberately touches only the
 * `models` key — the blob holds unrelated settings. Passing null for a slot
 * clears it back to the recommended default.
 */
export async function setModelPreferences(
  userId: string,
  updates: Partial<Record<ModelSlot, string | null>>
): Promise<ModelPreferences> {
  const row = await queryOne<{ preferences: string }>(
    "SELECT preferences FROM users WHERE id = ?",
    [userId]
  );

  let blob: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row?.preferences || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      blob = parsed as Record<string, unknown>;
    }
  } catch {
    // Corrupt preferences shouldn't block saving a model choice.
  }

  const models = parseModelPreferences(row?.preferences) as Record<string, string>;
  for (const [slot, value] of Object.entries(updates)) {
    if (!isModelSlot(slot)) continue;
    if (value === null || value === undefined || value === "") delete models[slot];
    else models[slot] = value;
  }

  blob.models = models;

  await db.execute({
    sql: "UPDATE users SET preferences = ?, updated_at = datetime('now') WHERE id = ?",
    args: [JSON.stringify(blob), userId],
  });

  preferenceCache.delete(userId);
  return models as ModelPreferences;
}

/**
 * Resolve one slot for one user.
 *
 * `userId` is optional because a few call paths (module-level helpers, the
 * catalog preview) have no user in hand; those get environment overrides and
 * recommended defaults, which is the same thing the app did before choices
 * existed.
 */
export async function resolveModelSlot(
  slot: ModelSlot,
  userId?: string | null
): Promise<ResolvedSlot> {
  const [catalog, prefs] = await Promise.all([
    fetchModelCatalog(),
    userId ? getModelPreferences(userId) : Promise.resolve({} as ModelPreferences),
  ]);

  return resolveSlot({
    slot,
    userChoice: prefs[slot] ?? null,
    envChoice: envOverrideForSlot(slot),
    // A snapshot catalog means the fetch failed; treat availability as unknown
    // rather than pretending the one-entry snapshot is the whole of OpenRouter.
    availableIds: catalog.live ? catalog.ids : null,
    visionCapableIds: catalog.live ? catalog.visionIds : null,
  });
}

/** The ordered list of models to try for a slot. Never empty. */
export async function getModelChain(
  slot: ModelSlot,
  userId?: string | null
): Promise<string[]> {
  const resolved = await resolveModelSlot(slot, userId);
  return resolved.chain;
}

/** The single model to use for a slot — for callers that can't take a chain. */
export async function getModelForSlot(
  slot: ModelSlot,
  userId?: string | null
): Promise<string> {
  const resolved = await resolveModelSlot(slot, userId);
  return resolved.primary;
}

/** Every slot resolved at once, for the Settings page and health reporting. */
export async function resolveAllSlots(
  userId?: string | null
): Promise<{ catalog: ModelCatalog; resolved: Record<ModelSlot, ResolvedSlot> }> {
  const catalog = await fetchModelCatalog();
  const prefs = userId ? await getModelPreferences(userId) : {};

  const resolved = {} as Record<ModelSlot, ResolvedSlot>;
  for (const slot of MODEL_SLOTS) {
    resolved[slot] = resolveSlot({
      slot,
      userChoice: prefs[slot] ?? null,
      envChoice: envOverrideForSlot(slot),
      availableIds: catalog.live ? catalog.ids : null,
      visionCapableIds: catalog.live ? catalog.visionIds : null,
    });
  }

  return { catalog, resolved };
}

/** Test seam. */
export function clearPreferenceCache(): void {
  preferenceCache.clear();
}
