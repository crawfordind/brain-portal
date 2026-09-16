/**
 * Creating a contact by hand, through the same gate that background extraction
 * uses.
 *
 * `ingestSourceEntities` handles entities pulled out of a note by the LLM. This
 * is the equivalent for a name a human or an agent supplies directly: it must
 * run `assessMerge` too, or the CRM would grow a second, looser write path and
 * the gate would only be as good as whichever caller remembered it.
 */

import { db, queryOne, mutate } from "@/lib/db/client";
import type { Entity } from "@/lib/db/schema";
import {
  assessMerge,
  cleanEntityName,
  normalizeEntityKey,
  normalizeEntityKeyStrict,
  normalizeEntityType,
  type EntityType,
  type MergeSubject,
} from "@/lib/entities/resolve";
import {
  getResolution,
  isNameLocked,
  writeEntityMetadata,
  type EntityMetadataPatch,
} from "./metadata";
import { StructureError } from "./structure";

export interface IngestContactInput {
  name: string;
  type?: EntityType | string;
  /** True for an event capture whose real identity is not yet known. */
  unresolved?: boolean;
  metAt?: string;
  note?: string;
  compartments?: string[];
}

export interface IngestContactResult {
  entity: Entity;
  action: "created" | "matched" | "flagged";
  /** Present when the gate refused to merge and explains why. */
  reason?: string;
}

/** Verified email channels, used by the merge gate's rule 2. */
async function verifiedEmailsFor(entityId: string): Promise<string[]> {
  const rows = await db.execute({
    sql: `SELECT normalized_value FROM contact_channels
          WHERE entity_id = ? AND kind = 'email' AND verified = 1`,
    args: [entityId],
  });
  return rows.rows.map((r) => String(r.normalized_value));
}

export async function ingestSingleEntity(
  userId: string,
  input: IngestContactInput
): Promise<IngestContactResult> {
  const name = cleanEntityName(input.name);
  if (!name) throw new StructureError("A contact needs a name");

  const key = normalizeEntityKey(name);
  if (!key) throw new StructureError("That name has no usable characters");

  const type = normalizeEntityType(
    typeof input.type === "string" ? input.type : undefined
  );

  const metadataPatch: EntityMetadataPatch = {};
  if (input.unresolved) {
    metadataPatch.resolution = "unresolved";
    if (input.metAt || input.note) {
      metadataPatch.resolution_hint = {
        ...(input.metAt ? { met_at: input.metAt } : {}),
        ...(input.note ? { said: input.note } : {}),
      };
    }
  }
  if (input.compartments?.length) {
    metadataPatch.compartments = input.compartments;
  }

  const existing =
    (await queryOne<Entity>(
      `SELECT * FROM entities WHERE user_id = ? AND normalized_key = ?`,
      [userId, key]
    )) ??
    (await queryOne<Entity>(
      `SELECT e.* FROM entities e
       JOIN entity_aliases a ON a.entity_id = e.id
       WHERE a.user_id = ? AND a.normalized_key = ?`,
      [userId, key]
    ));

  if (existing) {
    const verdict = assessMerge(
      {
        id: existing.id,
        name: existing.canonical_name,
        entityType: normalizeEntityType(existing.entity_type),
        resolution: getResolution(existing),
        nameLocked: isNameLocked(existing),
        verifiedEmails: await verifiedEmailsFor(existing.id),
      } satisfies MergeSubject,
      {
        name,
        entityType: type,
        resolution: input.unresolved ? "unresolved" : "confirmed",
      } satisfies MergeSubject
    );

    if (verdict.action === "merge") {
      // Same entity. Apply any new metadata but never rename it.
      if (Object.keys(metadataPatch).length > 0) {
        await db.execute({
          sql: `UPDATE entities SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
          args: [writeEntityMetadata(existing, metadataPatch), existing.id],
        });
      }
      const refreshed = await queryOne<Entity>(
        `SELECT * FROM entities WHERE id = ?`,
        [existing.id]
      );
      return { entity: refreshed ?? existing, action: "matched" };
    }

    // The gate refused. Create a separate row carrying the flag, keyed on the
    // strict key since the loose one is already taken by the existing row.
    const flagged = await insertEntity(userId, {
      name,
      key: normalizeEntityKeyStrict(name) || key,
      type,
      metadata: writeEntityMetadata("{}", {
        ...metadataPatch,
        merge_candidate: {
          target_entity_id: existing.id,
          confidence: verdict.confidence,
          reason: verdict.reason,
          flagged_at: new Date().toISOString(),
        },
      }),
    });
    return { entity: flagged, action: "flagged", reason: verdict.reason };
  }

  const created = await insertEntity(userId, {
    name,
    key,
    type,
    metadata: writeEntityMetadata("{}", metadataPatch),
  });
  return { entity: created, action: "created" };
}

async function insertEntity(
  userId: string,
  row: { name: string; key: string; type: EntityType; metadata: string }
): Promise<Entity> {
  const created = await mutate<Entity>(
    `INSERT INTO entities (user_id, canonical_name, normalized_key, entity_type, mention_count, metadata)
     VALUES (?, ?, ?, ?, 0, ?)
     RETURNING *`,
    [userId, row.name, row.key, row.type, row.metadata]
  );
  if (!created) throw new StructureError("Could not create the contact", 500);
  return created;
}
