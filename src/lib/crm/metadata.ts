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

/**
 * A bare first name in one source that matched several known people. The
 * entity carrying this is a placeholder holding that one mention until the
 * user says which person it was. See `matchFirstName`.
 */
export interface AmbiguousMention {
  /** The name as written, e.g. "Justin". */
  name: string;
  source_type: string;
  source_id: string;
  /** The people it could be, at the time it was read. */
  candidate_ids: string[];
}

/**
 * Something extraction took for a person or org that the user says is not a
 * contact ("Tuesday market", a product, a place). The row is kept, hidden from
 * every contact list, so the name keeps resolving here and is not re-created
 * by the next note; notes that mention it get `tag` instead.
 */
export interface NotContact {
  /** The tag the mentions were filed under. */
  tag: string;
  at: string;
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
  /** Free text the user wrote about this contact ("met at the co-op"). */
  about?: string;
  ambiguous?: AmbiguousMention;
  /** The user said this is not a contact; it lives on as a tag. See `not-contact.ts`. */
  not_contact?: NotContact;

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

export function getAbout(source: Entity | string | null | undefined): string | null {
  const raw = readEntityMetadata(source).about;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

export function getAmbiguousMention(
  source: Entity | string | null | undefined
): AmbiguousMention | null {
  const raw = readEntityMetadata(source).ambiguous;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as AmbiguousMention;
  if (!m.source_id || !Array.isArray(m.candidate_ids)) return null;
  return m;
}

export function getNotContact(
  source: Entity | string | null | undefined
): NotContact | null {
  const raw = readEntityMetadata(source).not_contact;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const tag = (raw as NotContact).tag;
  return typeof tag === "string" && tag.trim() ? (raw as NotContact) : null;
}

/** Absent means it is a contact, so no existing row changes meaning. */
export function isNotContact(source: Entity | string | null | undefined): boolean {
  return getNotContact(source) !== null;
}

/**
 * SQL predicate for "still a contact", for queries that filter in SQL rather
 * than through `isNotContact`. `alias` is the entities table's alias, if any.
 */
export function stillAContactSql(alias?: string): string {
  const col = alias ? `${alias}.metadata` : "metadata";
  return `(CASE WHEN json_valid(${col}) THEN json_extract(${col}, '$.not_contact.tag') END) IS NULL`;
}
