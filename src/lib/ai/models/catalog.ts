/**
 * The live OpenRouter model catalog.
 *
 * `GET https://openrouter.ai/api/v1/models` is public, unauthenticated, and
 * always current — which makes it, not a constant in this repo, the right
 * source of truth for "does this model still exist?". Settings renders from
 * it, and `resolve.ts` uses it to drop ids that providers have retired.
 *
 * Cached in-process rather than in `ai_cache`, because the catalog is global
 * while that table is per-user (its `user_id` is a FK). A warm serverless
 * instance reuses the cache; a cold one pays one cheap request.
 */

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

/** The catalog changes on the order of days; an hour of staleness is fine. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Never let a slow provider hold up a page render. */
const FETCH_TIMEOUT_MS = 8000;

export interface CatalogModel {
  id: string;
  name: string;
  /** Maximum context in tokens, 0 when the catalog omits it. */
  contextLength: number;
  /** USD per million prompt tokens, null when unknown or variable. */
  promptCostPerMillion: number | null;
  /** USD per million completion tokens, null when unknown or variable. */
  completionCostPerMillion: number | null;
  /** True when the model accepts image input. */
  supportsVision: boolean;
  description: string;
}

export interface ModelCatalog {
  models: CatalogModel[];
  ids: Set<string>;
  visionIds: Set<string>;
  fetchedAt: string;
  /** False when this is the built-in snapshot rather than a live fetch. */
  live: boolean;
  /** Why the live fetch failed, when it did. */
  error?: string;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; modality?: unknown };
}

let cached: { catalog: ModelCatalog; expiresAt: number } | null = null;
/** Collapses concurrent cold-start fetches into one request. */
let inFlight: Promise<ModelCatalog> | null = null;

/**
 * OpenRouter prices are strings of USD *per token* ("0.0000005"), which is
 * unreadable in a dropdown. Per-million is the unit people compare in.
 */
function perMillion(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value * 1_000_000;
}

function supportsVision(model: RawModel): boolean {
  const modalities = model.architecture?.input_modalities;
  if (Array.isArray(modalities)) {
    return modalities.some((m) => typeof m === "string" && m.toLowerCase() === "image");
  }
  // Older catalog entries only carry a combined "text+image->text" string.
  const modality = model.architecture?.modality;
  return typeof modality === "string" && modality.toLowerCase().includes("image");
}

export function normalizeCatalogResponse(payload: unknown): CatalogModel[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const models: CatalogModel[] = [];
  for (const entry of data as RawModel[]) {
    if (!entry || typeof entry.id !== "string" || !entry.id) continue;
    models.push({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
      contextLength:
        typeof entry.context_length === "number" && entry.context_length > 0
          ? entry.context_length
          : 0,
      promptCostPerMillion: perMillion(entry.pricing?.prompt),
      completionCostPerMillion: perMillion(entry.pricing?.completion),
      supportsVision: supportsVision(entry),
      description: typeof entry.description === "string" ? entry.description : "",
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

function buildCatalog(models: CatalogModel[], live: boolean, error?: string): ModelCatalog {
  return {
    models,
    ids: new Set(models.map((m) => m.id)),
    visionIds: new Set(models.filter((m) => m.supportsVision).map((m) => m.id)),
    fetchedAt: new Date().toISOString(),
    live,
    ...(error ? { error } : {}),
  };
}

/**
 * The catalog to show when openrouter.ai cannot be reached.
 *
 * Deliberately tiny: it exists so Settings renders something rather than an
 * error, not as a second source of truth. Note that resolution treats an
 * unreachable catalog as "unknown" (`availableIds: null`) rather than using
 * this list, so a failed fetch never demotes a working model.
 */
const SNAPSHOT: CatalogModel[] = [
  {
    id: "openrouter/auto",
    name: "Auto Router (OpenRouter picks)",
    contextLength: 0,
    promptCostPerMillion: null,
    completionCostPerMillion: null,
    supportsVision: false,
    description:
      "Lets OpenRouter choose a live model per request. Cannot go out of date.",
  },
];

export async function fetchModelCatalog(
  options: { force?: boolean } = {}
): Promise<ModelCatalog> {
  const now = Date.now();
  if (!options.force && cached && cached.expiresAt > now) {
    return cached.catalog;
  }
  if (!options.force && inFlight) return inFlight;

  const request = (async (): Promise<ModelCatalog> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(CATALOG_URL, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`OpenRouter catalog returned ${response.status}`);
        }

        const models = normalizeCatalogResponse(await response.json());
        if (models.length === 0) {
          throw new Error("OpenRouter catalog was empty");
        }

        const catalog = buildCatalog(models, true);
        cached = { catalog, expiresAt: Date.now() + CACHE_TTL_MS };
        return catalog;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[Models] catalog fetch failed:", message);

      // Serve a stale catalog in preference to the snapshot — day-old truth
      // beats a one-entry placeholder.
      if (cached) return { ...cached.catalog, live: false, error: message };
      return buildCatalog(SNAPSHOT, false, message);
    } finally {
      inFlight = null;
    }
  })();

  inFlight = request;
  return request;
}

/** Test seam: drop the memoized catalog. */
export function clearCatalogCache(): void {
  cached = null;
  inFlight = null;
}
