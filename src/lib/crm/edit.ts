/**
 * Editing a contact by hand: its full name, its type, and a few lines about
 * who they are.
 *
 * Contacts are created by extraction from notes, so most start as whatever the
 * note said ("Justin"). Renaming one must not cut it off from those notes, so
 * the old name stays behind as an alias and later mentions of "Justin" still
 * find "Justin Smith". A hand-edited name is also locked: an offhand note can
 * no longer rename the contact back.
 *
 * Contact details (email, phone, ...) are channels and have their own route,
 * because an address belongs to exactly one contact. See `channels.ts`.
 */

import { db, queryOne } from "@/lib/db/client";
import type { Entity } from "@/lib/db/schema";
import {
  ENTITY_TYPES,
  cleanEntityName,
  isScopedMentionKey,
  normalizeEntityKey,
  type EntityType,
} from "@/lib/entities/resolve";
import { writeEntityMetadata, type EntityMetadataPatch } from "./metadata";
import { StructureError } from "./structure";

export const MAX_ABOUT_LENGTH = 4000;

export interface ContactEdit {
  name?: string;
  type?: string;
  /** Empty string clears it. */
  about?: string | null;
}

/** Thrown when the new name already belongs to another contact. */
export class ContactNameTakenError extends StructureError {
  constructor(
    readonly existingId: string,
    readonly existingName: string
  ) {
    super(
      `"${existingName}" already has that name. If they are the same person, combine them instead.`,
      409
    );
  }
}

export async function updateContact(
  userId: string,
  entityId: string,
  edit: ContactEdit
): Promise<Entity> {
  const entity = await queryOne<Entity>(
    `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
    [entityId, userId]
  );
  if (!entity) throw new StructureError("Contact not found", 404);

  let name = entity.canonical_name;
  let key = entity.normalized_key;
  const metadataPatch: EntityMetadataPatch = {};

  if (edit.name !== undefined) {
    const cleaned = cleanEntityName(edit.name);
    if (!cleaned) throw new StructureError("A contact needs a name");
    if (cleaned.length > 200) throw new StructureError("That name is too long");
    const newKey = normalizeEntityKey(cleaned);
    if (!newKey) throw new StructureError("That name has no usable characters");

    if (cleaned !== entity.canonical_name) {
      name = cleaned;
      metadataPatch.name_locked = true;
    }

    // A placeholder still waiting on "which Justin?" keeps its per-note key
    // until that question is answered; renaming it is not an answer.
    if (newKey !== entity.normalized_key && !isScopedMentionKey(entity.normalized_key)) {
      const clash = await queryOne<{ id: string; canonical_name: string }>(
        `SELECT id, canonical_name FROM entities
         WHERE user_id = ? AND normalized_key = ? AND id <> ?`,
        [userId, newKey, entityId]
      );
      if (clash) throw new ContactNameTakenError(clash.id, clash.canonical_name);

      const aliasClash = await queryOne<{ entity_id: string; canonical_name: string }>(
        `SELECT a.entity_id, e.canonical_name FROM entity_aliases a
         JOIN entities e ON e.id = a.entity_id
         WHERE a.user_id = ? AND a.normalized_key = ? AND a.entity_id <> ?`,
        [userId, newKey, entityId]
      );
      if (aliasClash) {
        throw new ContactNameTakenError(aliasClash.entity_id, aliasClash.canonical_name);
      }
      key = newKey;
    }
  }

  let type = entity.entity_type;
  if (edit.type !== undefined) {
    if (!(ENTITY_TYPES as readonly string[]).includes(edit.type)) {
      throw new StructureError(`Type must be one of: ${ENTITY_TYPES.join(", ")}`);
    }
    type = edit.type as EntityType;
  }

  if (edit.about !== undefined) {
    const about = (edit.about ?? "").trim();
    if (about.length > MAX_ABOUT_LENGTH) {
      throw new StructureError(`Keep it under ${MAX_ABOUT_LENGTH} characters`);
    }
    metadataPatch.about = about || null;
  }

  const statements = [
    {
      sql: `UPDATE entities SET canonical_name = ?, normalized_key = ?, entity_type = ?,
              metadata = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [name, key, type, writeEntityMetadata(entity, metadataPatch), entityId, userId],
    },
  ];

  if (key !== entity.normalized_key) {
    // The new name may have been one of this contact's aliases already; it is
    // the canonical key now. The old name becomes an alias, so notes that say
    // "Justin" keep finding "Justin Smith".
    statements.push({
      sql: `DELETE FROM entity_aliases WHERE user_id = ? AND entity_id = ? AND normalized_key = ?`,
      args: [userId, entityId, key],
    });
    statements.push({
      sql: `INSERT OR IGNORE INTO entity_aliases (user_id, entity_id, alias, normalized_key)
            VALUES (?, ?, ?, ?)`,
      args: [userId, entityId, entity.canonical_name, entity.normalized_key],
    });
  }

  await db.batch(statements, "write");

  const updated = await queryOne<Entity>(
    `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
    [entityId, userId]
  );
  return updated ?? entity;
}
