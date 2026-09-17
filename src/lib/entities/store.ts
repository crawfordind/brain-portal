/**
 * Entity store — persistence for the knowledge layer.
 *
 * Resolves extracted entities onto canonical nodes, records where each was
 * mentioned (for timelines), and maintains co-occurrence edges. Ingestion is
 * idempotent: re-running over the same source does not double-count mentions
 * (guarded by the UNIQUE(entity_id, source_type, source_id) constraint).
 */

import { db, query, queryOne, mutate } from "@/lib/db/client";
import { extractEntities } from "./extractor";
import {
  buildCoOccurrencePairs,
  pickCanonicalName,
  assessMerge,
  normalizeEntityKeyStrict,
  normalizeEntityType,
  type MergeSubject,
} from "./resolve";
import {
  writeEntityMetadata,
  isNameLocked,
  getResolution,
} from "@/lib/crm/metadata";
import type { ExtractedEntity } from "./extractor";

async function findEntityIdByKey(
  userId: string,
  key: string
): Promise<string | null> {
  const direct = await queryOne<{ id: string }>(
    `SELECT id FROM entities WHERE user_id = ? AND normalized_key = ?`,
    [userId, key]
  );
  if (direct) return direct.id;

  const alias = await queryOne<{ entity_id: string }>(
    `SELECT entity_id FROM entity_aliases WHERE user_id = ? AND normalized_key = ?`,
    [userId, key]
  );
  return alias?.entity_id ?? null;
}

/** Verified email channels for an entity, used by the merge gate's rule 2. */
async function verifiedEmailsFor(entityId: string): Promise<string[]> {
  try {
    const rows = await query<{ normalized_value: string }>(
      `SELECT normalized_value FROM contact_channels
       WHERE entity_id = ? AND kind = 'email' AND verified = 1`,
      [entityId]
    );
    return rows.map((r) => r.normalized_value);
  } catch {
    // contact_channels arrives with the CRM migration. Before it exists there
    // are no verified channels, which is the correct answer, not an error.
    return [];
  }
}

/**
 * Create the entity if new, or update its canonical name/type if this mention
 * is more informative. Does NOT touch mention_count — that is bumped only when
 * a genuinely new mention row is inserted (see recordMention).
 *
 * A key match no longer implies a merge. `assessMerge` decides, because
 * `normalizeEntityKey` strips business suffixes and therefore collapses
 * "Northwind Farms", "Northwind Holdings" and "Northwind & Sons" onto one key.
 * Applying that collapse to a contact record is irreversible and silent, so a
 * manufactured match now produces a second row carrying `merge_candidate`
 * instead. Exact matches — the overwhelmingly common case — still merge with
 * no change in behavior.
 */
async function upsertEntity(
  userId: string,
  e: ExtractedEntity
): Promise<string | null> {
  const existingId = await findEntityIdByKey(userId, e.key);

  if (existingId) {
    const current = await queryOne<{
      canonical_name: string;
      entity_type: string;
      metadata: string;
    }>(
      `SELECT canonical_name, entity_type, metadata FROM entities WHERE id = ?`,
      [existingId]
    );

    if (current) {
      const existingSubject: MergeSubject = {
        id: existingId,
        name: current.canonical_name,
        entityType: normalizeEntityType(current.entity_type),
        resolution: getResolution(current.metadata),
        nameLocked: isNameLocked(current.metadata),
        verifiedEmails: await verifiedEmailsFor(existingId),
      };
      const incomingSubject: MergeSubject = {
        name: e.name,
        entityType: normalizeEntityType(e.type),
      };

      const verdict = assessMerge(existingSubject, incomingSubject);

      if (verdict.action !== "merge") {
        return createEntity(userId, e, {
          merge_candidate: {
            target_entity_id: existingId,
            confidence: verdict.confidence,
            reason: verdict.reason,
            flagged_at: new Date().toISOString(),
          },
        });
      }
    }

    // `name_locked` pins the canonical name. Without it an offhand note can
    // rename an entity whose name appears on an invoice.
    const locked = isNameLocked(current?.metadata);
    const canonical = current
      ? locked
        ? current.canonical_name
        : pickCanonicalName(current.canonical_name, e.name)
      : e.name;
    const type = locked
      ? current!.entity_type
      : current && current.entity_type !== "other"
        ? current.entity_type
        : e.type;

    await db.execute({
      sql: `UPDATE entities SET canonical_name = ?, entity_type = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [canonical, type, existingId],
    });
    return existingId;
  }

  return createEntity(userId, e);
}

/**
 * Insert a new entity row.
 *
 * A flagged entity cannot reuse the loose `normalized_key`, since that column
 * is UNIQUE per user and the existing row already holds it. It stores its
 * strict key instead, which is precisely the value that distinguishes it from
 * the row it was flagged against.
 */
async function createEntity(
  userId: string,
  e: ExtractedEntity,
  extraMetadata?: Record<string, unknown>
): Promise<string | null> {
  const flagged = Boolean(extraMetadata?.merge_candidate);
  const key = flagged ? normalizeEntityKeyStrict(e.name) || e.key : e.key;

  const metadata = writeEntityMetadata(
    JSON.stringify(e.aliases.length ? { aliases: e.aliases } : {}),
    extraMetadata ?? {}
  );

  const created = await mutate<{ id: string }>(
    `INSERT INTO entities (user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
     VALUES (?, ?, ?, ?, 0, ?)
     RETURNING id`,
    [userId, e.name, key, e.type, metadata]
  );
  return created?.id ?? null;
}

/**
 * Record a mention idempotently. Returns true if a new mention row was created
 * (in which case the caller should bump the entity's mention_count / seen dates).
 */
async function recordMention(
  userId: string,
  entityId: string,
  sourceType: string,
  sourceId: string,
  snippet: string | null,
  occurredAt: string | null
): Promise<boolean> {
  const res = await db.execute({
    sql: `INSERT OR IGNORE INTO entity_mentions
          (user_id, entity_id, source_type, source_id, snippet, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [userId, entityId, sourceType, sourceId, snippet, occurredAt],
  });
  return res.rowsAffected > 0;
}

/**
 * Create or strengthen `related` co-occurrence edges between all entities that
 * appeared together in one source. Returns the number of pairs processed.
 */
async function linkCoOccurrence(
  userId: string,
  entityIds: string[]
): Promise<number> {
  const pairs = buildCoOccurrencePairs(entityIds);
  for (const [a, b] of pairs) {
    await db.execute({
      sql: `INSERT INTO entity_edges
              (user_id, source_entity_id, target_entity_id, edge_type, strength, co_occurrence_count, discovery_method)
            VALUES (?, ?, ?, 'related', 0.4, 1, 'co_occurrence')
            ON CONFLICT(source_entity_id, target_entity_id, edge_type)
            DO UPDATE SET
              co_occurrence_count = co_occurrence_count + 1,
              strength = MIN(0.95, 0.3 + 0.1 * (co_occurrence_count + 1)),
              updated_at = datetime('now')`,
      args: [userId, a, b],
    });
  }
  return pairs.length;
}

export interface IngestResult {
  entitiesFound: number;
  mentionsAdded: number;
  edges: number;
}

/**
 * Full ingestion for a single source: extract → resolve/upsert → record
 * mentions → build co-occurrence edges.
 */
export async function ingestSourceEntities(params: {
  userId: string;
  sourceType: string;
  sourceId: string;
  text: string;
  title?: string;
  occurredAt?: string | null;
}): Promise<IngestResult> {
  const { userId, sourceType, sourceId, occurredAt = null } = params;
  const combined = `${params.title ?? ""}\n\n${params.text ?? ""}`;
  const extracted = await extractEntities(combined);
  if (extracted.length === 0) {
    return { entitiesFound: 0, mentionsAdded: 0, edges: 0 };
  }

  const entityIds: string[] = [];
  let mentionsAdded = 0;

  for (const e of extracted) {
    const entityId = await upsertEntity(userId, e);
    if (!entityId) continue;
    entityIds.push(entityId);

    const inserted = await recordMention(
      userId,
      entityId,
      sourceType,
      sourceId,
      e.name,
      occurredAt
    );
    if (inserted) {
      mentionsAdded++;
      await db.execute({
        sql: `UPDATE entities SET
                mention_count = mention_count + 1,
                first_seen_at = MIN(first_seen_at, COALESCE(?, datetime('now'))),
                last_seen_at = MAX(last_seen_at, COALESCE(?, datetime('now'))),
                updated_at = datetime('now')
              WHERE id = ?`,
        args: [occurredAt, occurredAt, entityId],
      });
    }
  }

  const edges = await linkCoOccurrence(userId, entityIds);
  return { entitiesFound: extracted.length, mentionsAdded, edges };
}
