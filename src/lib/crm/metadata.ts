/**
 * Typed conventions over `entities.metadata`.
 *
 * The CRM stores venture config, compartments, resolution state and merge
 * candidacy in the existing JSON column rather than in new columns, because
 * `upsertEntity` writes `metadata` on INSERT only — it never overwrites it on
 * update — so background re-extraction cannot clobber any of this.
 *
 * Every default here is chosen to avoid a backfill. The entity graph already
 * holds rows written before the CRM existed, and none of them carry these keys;
 * reading an absent key must therefore mean "the ordinary case", never "needs
 * attention".
 */

import type { Entity } from "@/lib/db/schema";

export type ResolutionState = "unresolved" | "confirmed";

/** The default compartment. Absent compartments means public, not secret. */
export const PUBLIC_COMPARTMENT = "public";

export interface SendingIdentity {
  email?: string | null;
  display_name?: string | null;
  signature?: string | null;
}

export interface VentureOffer {
  sku?: string;
  name?: string;
  price?: string;
}

export interface VentureConfig {
  slug?: string;
  sending_identity?: SendingIdentity;
  /** Free text handed to a drafting model in Phase 3. */
  voice?: string;
  /** Plain-text rules a drafting model must not violate. */
  compliance_rules?: string[];
  offers?: VentureOffer[];
}

export interface MergeCandidate {
  target_entity_id: string;
  confidence: number;
  reason: string;
  flagged_at?: string;
}

export interface CrmFields {
  relationship_stage?: string | null;
  owner?: string | null;
  last_contacted_at?: string | null;
  next_action_at?: string | null;
}

export interface EntityMetadata {
  /** Written by the entity layer on insert. Preserved, never owned by the CRM. */
  aliases?: string[];

  is_venture?: boolean;
  venture?: VentureConfig;
  compartments?: string[];
  resolution?: ResolutionState;
  resolution_hint?: {
    met_at?: string;
    said?: string;
    venture_id?: string;
  };
  merge_candidate?: MergeCandidate | null;
  name_locked?: boolean;
  crm?: CrmFields;

  /** Anything written by other subsystems. Round-tripped untouched. */
  [key: string]: unknown;
}

/** Parse the JSON column, degrading to {} rather than throwing on bad data. */
export function readEntityMetadata(
  source: Entity | string | null | undefined
): EntityMetadata {
  const raw = typeof source === "string" ? source : source?.metadata;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as EntityMetadata;
  } catch {
    return {};
  }
}

/**
 * A metadata patch. `null` on a key deletes it; `undefined` leaves it alone.
 * Spelled out as a mapped type so the delete sentinel is part of the contract
 * rather than an undocumented behavior of the implementation.
 */
export type EntityMetadataPatch = {
  [K in keyof EntityMetadata]?: EntityMetadata[K] | null;
};

/**
 * Merge a patch into existing metadata and serialize. Unknown keys written by
 * other subsystems survive; an explicit `null` in the patch deletes its key.
 */
export function writeEntityMetadata(
  existing: Entity | string | null | undefined,
  patch: EntityMetadataPatch
): string {
  const current = readEntityMetadata(existing);
  const next: EntityMetadata = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else if (value !== undefined) {
      next[key] = value;
    }
  }

  return JSON.stringify(next);
}

/**
 * Strict equality on purpose. A stray truthy string left in metadata by an
 * import or an LLM must not be able to promote an entity into a venture.
 */
export function isVenture(source: Entity | string | null | undefined): boolean {
  return readEntityMetadata(source).is_venture === true;
}

/**
 * Absent means confirmed. Every entity created by extraction before the CRM
 * existed lacks this key; treating absent as unresolved would flag the entire
 * graph for review on day one.
 */
export function getResolution(
  source: Entity | string | null | undefined
): ResolutionState {
  return readEntityMetadata(source).resolution === "unresolved"
    ? "unresolved"
    : "confirmed";
}

export function isUnresolved(
  source: Entity | string | null | undefined
): boolean {
  return getResolution(source) === "unresolved";
}

/** Absent means ["public"]. No implicit secrecy, and no backfill. */
export function getCompartments(
  source: Entity | string | null | undefined
): string[] {
  const raw = readEntityMetadata(source).compartments;
  if (!Array.isArray(raw)) return [PUBLIC_COMPARTMENT];
  const cleaned = raw
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [PUBLIC_COMPARTMENT];
}

/** Absent means false. Only the seed script and manual edits set this. */
export function isNameLocked(
  source: Entity | string | null | undefined
): boolean {
  return readEntityMetadata(source).name_locked === true;
}

export function getMergeCandidate(
  source: Entity | string | null | undefined
): MergeCandidate | null {
  const raw = readEntityMetadata(source).merge_candidate;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as MergeCandidate;
  if (!candidate.target_entity_id) return null;
  return candidate;
}

export function getVentureConfig(
  source: Entity | string | null | undefined
): VentureConfig {
  const raw = readEntityMetadata(source).venture;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as VentureConfig;
}

export function getCrmFields(
  source: Entity | string | null | undefined
): CrmFields {
  const raw = readEntityMetadata(source).crm;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as CrmFields;
}
