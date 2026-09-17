/**
 * Entity resolution — the pure, deterministic core of the knowledge layer.
 *
 * The note graph re-surfaced entity-resolution failures as "insights" (it once
 * flagged `FieldTechAI` and `Field tech ai` as "a connection worth merging"),
 * and a single real-world entity was fragmented across many notes — "Northwind"
 * appeared as `Northwind`, `Northwind Farms`, `Northwind Farms meeting`, ... These
 * functions collapse such surface variants onto one canonical entity so the app
 * can reason about the *entity*, not the string.
 *
 * Side-effect free (no DB, no LLM) so it can be unit-tested directly.
 */

export type EntityType =
  | "person"
  | "org"
  | "place"
  | "project"
  | "input"
  | "product"
  | "other";

export const ENTITY_TYPES: readonly EntityType[] = [
  "person",
  "org",
  "place",
  "project",
  "input",
  "product",
  "other",
];

// Trailing business/legal/domain suffix tokens that don't distinguish an
// entity — "Northwind" and "Northwind Farms" are the same farm.
const SUFFIX_TOKENS = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "co",
  "corp",
  "corporation",
  "company",
  "companies",
  "plc",
  "gmbh",
  "farms",
  "farm",
  "group",
  "holdings",
  "partners",
  "associates",
  "sons",
]);

/** Trim and collapse internal whitespace for a human-readable canonical name. */
export function cleanEntityName(name: string): string {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Compute a normalized matching key for an entity name.
 *
 * Lowercases, strips diacritics, drops trailing business suffixes and a leading
 * article, then removes all non-alphanumeric characters. The final step makes
 * matching whitespace/punctuation-insensitive so "FieldTechAI" and
 * "Field tech ai" collapse to the same key. Returns "" for empty/garbage input.
 *
 * The alphanumeric-only key is deliberately aggressive: it favors merging
 * surface variants (the observed failure mode) over splitting them. Distinct
 * entities that differ only by spacing are rare; fragmented ones were common.
 */
export function normalizeEntityKey(name: string): string {
  if (!name) return "";

  const lowered = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/&/g, " and ");

  let tokens = lowered.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return "";

  // Drop a leading article.
  if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);

  // Drop trailing business suffixes (iteratively: "Foo Farms Co" → "Foo").
  while (tokens.length > 1 && SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens = tokens.slice(0, -1);
  }

  return tokens.join("");
}

export interface ResolvableEntity {
  id: string;
  normalized_key: string;
  /** Normalized keys of known aliases (optional). */
  alias_keys?: string[];
}

export interface ResolutionResult {
  /** Matched existing entity id, or null if this is a new entity. */
  entityId: string | null;
  /** The normalized key computed for the input name. */
  key: string;
}

/**
 * Resolve a raw entity name against a set of existing entities.
 *
 * Matches by exact normalized key or by any known alias key. Deliberately does
 * NOT do fuzzy/substring matching — when we merge a variant we record it as an
 * alias, so future occurrences match exactly without risking false merges
 * (e.g. "Green" into "Greenhouse Energy").
 */
export function resolveEntity(
  name: string,
  candidates: ResolvableEntity[]
): ResolutionResult {
  const key = normalizeEntityKey(name);
  if (!key) return { entityId: null, key };

  for (const candidate of candidates) {
    if (candidate.normalized_key === key) {
      return { entityId: candidate.id, key };
    }
    if (candidate.alias_keys?.includes(key)) {
      return { entityId: candidate.id, key };
    }
  }

  return { entityId: null, key };
}

/**
 * Choose the better canonical name between an existing and an incoming name.
 * Prefers the more informative form: more tokens first (so "Northwind Farms"
 * beats "Northwind"), then longer, then the existing one for stability.
 */
export function pickCanonicalName(existing: string, incoming: string): string {
  const a = cleanEntityName(existing);
  const b = cleanEntityName(incoming);
  if (!a) return b;
  if (!b) return a;

  const aTokens = a.split(/\s+/).length;
  const bTokens = b.split(/\s+/).length;
  if (bTokens !== aTokens) return bTokens > aTokens ? b : a;
  if (b.length !== a.length) return b.length > a.length ? b : a;
  return a;
}

const STOPWORD_KEYS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "today",
  "tomorrow",
  "meeting",
  "note",
  "notes",
  "thing",
  "stuff",
]);

/**
 * Deduplicate and clean a batch of entities extracted from a single source,
 * collapsing surface variants by normalized key. When variants collide, the
 * more informative canonical name wins and the others become aliases.
 *
 * Filters out empty keys, pure-numeric keys, single-character keys, and common
 * stopwords that the extractor sometimes emits as spurious entities.
 */
export function dedupeExtractedEntities(
  raw: { name: string; type?: string }[]
): { name: string; key: string; type: EntityType; aliases: string[] }[] {
  const byKey = new Map<
    string,
    { name: string; key: string; type: EntityType; aliases: Set<string> }
  >();

  for (const item of raw) {
    const name = cleanEntityName(item.name);
    const key = normalizeEntityKey(name);
    if (!key || key.length < 2) continue;
    if (/^\d+$/.test(key)) continue; // bare numbers aren't entities
    if (STOPWORD_KEYS.has(key)) continue;

    const type = normalizeEntityType(item.type);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { name, key, type, aliases: new Set() });
      continue;
    }

    const canonical = pickCanonicalName(existing.name, name);
    if (canonical !== existing.name) existing.aliases.add(existing.name);
    if (canonical !== name) existing.aliases.add(name);
    existing.name = canonical;
    // Upgrade an "other" type if this occurrence is more specific.
    if (existing.type === "other" && type !== "other") existing.type = type;
  }

  return Array.from(byKey.values()).map((e) => ({
    name: e.name,
    key: e.key,
    type: e.type,
    aliases: Array.from(e.aliases).filter((a) => cleanEntityName(a) !== e.name),
  }));
}

/** Coerce an arbitrary type string to a known EntityType (default "other"). */
export function normalizeEntityType(type?: string): EntityType {
  const t = (type || "").toLowerCase().trim();
  return (ENTITY_TYPES as readonly string[]).includes(t)
    ? (t as EntityType)
    : "other";
}

/**
 * Build the set of unique unordered entity-id pairs that co-occur in a source,
 * used to create/strengthen `related` edges. Self-pairs and duplicate ids are
 * ignored; each pair is returned once with ids in stable (sorted) order.
 */
export function buildCoOccurrencePairs(
  entityIds: string[]
): [string, string][] {
  const unique = Array.from(new Set(entityIds));
  const pairs: [string, string][] = [];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const [a, b] = [unique[i], unique[j]].sort();
      pairs.push([a, b]);
    }
  }
  return pairs;
}

// =====================================================
// MERGE CONFIDENCE GATE
// =====================================================

/**
 * Compute a matching key WITHOUT dropping business suffixes.
 *
 * `normalizeEntityKey` is deliberately aggressive: it strips "Farms", "Co",
 * "Holdings" and friends so fragmented references to one farm collapse. That is
 * right for a knowledge graph and wrong for a contact record, because
 * "Northwind Farms", "Northwind Holdings" and "Northwind & Sons" all reduce to
 * `northwind` and then collide irreversibly under
 * UNIQUE(user_id, normalized_key).
 *
 * The strict key is what tells those two situations apart. When two names share
 * a normalized key AND a strict key, they really are the same string modulo
 * punctuation. When they share only the normalized key, the match was
 * *manufactured* by suffix stripping and must be reviewed rather than applied.
 */
export function normalizeEntityKeyStrict(name: string): string {
  if (!name) return "";

  const lowered = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ");

  let tokens = lowered.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);

  return tokens.join("");
}

/** One side of a proposed merge, as plain data so this stays pure. */
export interface MergeSubject {
  id?: string;
  name: string;
  entityType: EntityType;
  /** Absent is treated as "confirmed", matching the metadata convention. */
  resolution?: "unresolved" | "confirmed";
  nameLocked?: boolean;
  /** Normalized values of channels we have actually received from. */
  verifiedEmails?: string[];
}

export type MergeVerdict =
  | { action: "merge"; confidence: number; reason: string }
  | { action: "flag"; confidence: number; reason: string }
  | { action: "separate"; confidence: number; reason: string };

/**
 * Decide what to do when an incoming name resolves onto an existing entity.
 *
 * Rules are evaluated in order and the first match wins. Rules 1 through 4
 * reproduce today's behavior exactly, so the common case (an exact key match on
 * the same type) still merges silently. Only rule 5 is new: it is the narrow,
 * detectable subset where the key match exists solely because a suffix token
 * was stripped.
 *
 * `flag` means "keep both rows, record a merge_candidate, let a human decide".
 * Merges are executed through `entity_aliases`, which is what makes an accepted
 * merge reversible.
 */
export function assessMerge(
  existing: MergeSubject,
  incoming: MergeSubject
): MergeVerdict {
  const exactStrict =
    normalizeEntityKeyStrict(existing.name) ===
      normalizeEntityKeyStrict(incoming.name) &&
    normalizeEntityKeyStrict(existing.name) !== "";

  // Rule 1. Never fuse anything with an unresolved entity. "Rascal" and
  // "Matt in Carlisle" are placeholders for a person we cannot yet name;
  // merging them on a name collision would invent a relationship.
  if (
    existing.resolution === "unresolved" ||
    incoming.resolution === "unresolved"
  ) {
    return {
      action: "separate",
      confidence: 0,
      reason: "One side is an unresolved contact, which never auto-merges.",
    };
  }

  // Rule 2. A verified channel is stronger evidence than a name. If both sides
  // have one and they disagree, these are two different parties who happen to
  // share a name.
  const a = existing.verifiedEmails ?? [];
  const b = incoming.verifiedEmails ?? [];
  if (a.length > 0 && b.length > 0 && !a.some((email) => b.includes(email))) {
    return {
      action: "separate",
      confidence: 0,
      reason: `Verified email addresses conflict (${a[0]} vs ${b[0]}).`,
    };
  }

  // Rule 3. A person is not an organisation. Worth a look, never automatic.
  if (existing.entityType !== incoming.entityType) {
    return {
      action: "flag",
      confidence: 0.5,
      reason: `Type mismatch: ${existing.entityType} vs ${incoming.entityType}.`,
    };
  }

  // Rule 0, checked here because it only bites once types agree: a locked
  // entity (a venture, or anything a human pinned) accepts only an exact match.
  // Largely redundant with rule 5, kept explicit so the protection does not
  // depend on the suffix list happening to cover the case.
  if (existing.nameLocked && !exactStrict) {
    return {
      action: "flag",
      confidence: 0.4,
      reason: `"${existing.name}" is name-locked and the incoming name is not an exact match.`,
    };
  }

  // Rule 4. The common case, unchanged from previous behavior.
  if (exactStrict) {
    return {
      action: "merge",
      confidence: 1,
      reason: "Exact name match after normalization.",
    };
  }

  // Rule 5. The match exists only because a suffix token was stripped.
  return {
    action: "flag",
    confidence: 0.6,
    reason: `"${existing.name}" and "${incoming.name}" match only after dropping a business suffix.`,
  };
}
