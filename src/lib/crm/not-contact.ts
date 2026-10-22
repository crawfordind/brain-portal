/**
 * "This isn't a contact": turning something extraction filed as a person or
 * org into a tag.
 *
 * The extractor reads every note for people and organizations, and some of
 * what it finds is neither ("Tuesday market", a product, a team name). The
 * user can say so, and the name becomes a tag on the notes and captures that
 * mention it instead.
 *
 * The entity row is kept, not deleted, and hidden from every contact list
 * (`stillAContactSql`, `isNotContact`). Deleting it would let the next note
 * that says the same name create it again; kept, the name keeps resolving
 * here, and ingestion tags the new note instead of recording a contact (see
 * `ingestExtractedEntities`). It also makes the decision reversible:
 * `restoreContact` puts it back with every mention it had.
 *
 * Something with contact details or a venture role is refused rather than
 * hidden: an address must keep resolving to a visible contact, and a role is a
 * deliberate statement that it is one.
 */

import { db, query, queryOne } from "@/lib/db/client";
import type { Entity } from "@/lib/db/schema";
import { getNotContact, isVenture, writeEntityMetadata } from "./metadata";
import { StructureError } from "./structure";

export const MAX_TAG_LENGTH = 60;

/** Trim and collapse whitespace; the tag reads as the user typed it. */
export function cleanTagName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The slug a tag is unique by. Falls back to the lower-cased name when
 * nothing ASCII survives, so "Café Zoë" or a name in another script still
 * gets a tag rather than an empty slug.
 */
export function tagSlug(name: string): string {
  const cleaned = cleanTagName(name);
  const slug = cleaned
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || cleaned.toLowerCase().replace(/\s+/g, "-");
}

/** Add `tag` to a capture's tag list unless it is already there (any case). */
export function withTag(existing: string | null | undefined, tag: string): string[] | null {
  let tags: unknown;
  try {
    tags = JSON.parse(existing || "[]");
  } catch {
    tags = [];
  }
  const list = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string")
    : [];
  if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return null;
  return [...list, tag];
}

async function ensureTag(userId: string, name: string): Promise<string | null> {
  const slug = tagSlug(name);
  await db.execute({
    sql: `INSERT INTO tags (user_id, name, slug) VALUES (?, ?, ?)
          ON CONFLICT(user_id, slug) DO NOTHING`,
    args: [userId, name, slug],
  });
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM tags WHERE user_id = ? AND slug = ?`,
    [userId, slug]
  );
  return row?.id ?? null;
}

/**
 * Put `tag` on one source. Notes use the `tags`/`note_tags` tables, captures
 * their own `tags` list. Returns true when the source gained the tag; other
 * source types, and sources that are gone or not the user's, are skipped.
 */
export async function fileUnderTag(
  userId: string,
  tag: string,
  sourceType: string,
  sourceId: string
): Promise<boolean> {
  if (sourceType === "note") {
    const tagId = await ensureTag(userId, tag);
    if (!tagId) return false;
    const res = await db.execute({
      sql: `INSERT OR IGNORE INTO note_tags (note_id, tag_id)
            SELECT id, ? FROM notes WHERE id = ? AND user_id = ?`,
      args: [tagId, sourceId, userId],
    });
    if (res.rowsAffected === 0) return false;
    await db.execute({
      sql: `UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?`,
      args: [tagId],
    });
    return true;
  }

  if (sourceType === "capture") {
    const capture = await queryOne<{ tags: string | null }>(
      `SELECT tags FROM captures WHERE id = ? AND user_id = ?`,
      [sourceId, userId]
    );
    if (!capture) return false;
    const next = withTag(capture.tags, tag);
    if (!next) return false;
    await db.execute({
      sql: `UPDATE captures SET tags = ? WHERE id = ? AND user_id = ?`,
      args: [JSON.stringify(next), sourceId, userId],
    });
    return true;
  }

  return false;
}

async function loadEntity(userId: string, entityId: string): Promise<Entity> {
  const entity = await queryOne<Entity>(
    `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
    [entityId, userId]
  );
  if (!entity) throw new StructureError("Contact not found", 404);
  return entity;
}

export interface NotContactResult {
  entity: Entity;
  tag: string;
  /** Notes and captures that gained the tag just now. */
  tagged: number;
}

export async function markNotContact(
  userId: string,
  entityId: string,
  options: { tag?: string | null } = {}
): Promise<NotContactResult> {
  const entity = await loadEntity(userId, entityId);

  if (isVenture(entity)) {
    throw new StructureError("This is one of your ventures, so it stays.", 409);
  }

  const tag = cleanTagName(options.tag ?? "") || cleanTagName(entity.canonical_name);
  if (!tag) throw new StructureError("The tag needs a name");
  if (tag.length > MAX_TAG_LENGTH) {
    throw new StructureError(`Keep the tag under ${MAX_TAG_LENGTH} characters`);
  }

  const channels = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contact_channels WHERE user_id = ? AND entity_id = ?`,
    [userId, entityId]
  ).catch(() => null);
  if (Number(channels?.n) > 0) {
    throw new StructureError(
      "It has contact details saved. Remove them first, so that address doesn't point at something hidden.",
      409
    );
  }

  const roles = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM entity_edges ed
     JOIN entities v ON v.id = ed.target_entity_id
     WHERE ed.user_id = ? AND ed.source_entity_id = ?
       AND ed.edge_type <> 'part_of' AND v.metadata LIKE '%"is_venture"%'`,
    [userId, entityId]
  );
  if (Number(roles?.n) > 0) {
    throw new StructureError(
      "It has a role at one of your ventures. Remove the role first.",
      409
    );
  }

  await db.execute({
    sql: `UPDATE entities SET metadata = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [
      writeEntityMetadata(entity, {
        not_contact: { tag, at: new Date().toISOString() },
        // A question about a non-contact is no longer one worth asking.
        merge_candidate: null,
      }),
      entityId,
      userId,
    ],
  });

  const mentions = await query<{ source_type: string; source_id: string }>(
    `SELECT DISTINCT source_type, source_id FROM entity_mentions
     WHERE user_id = ? AND entity_id = ?`,
    [userId, entityId]
  );
  let tagged = 0;
  for (const m of mentions) {
    if (await fileUnderTag(userId, tag, m.source_type, m.source_id)) tagged++;
  }

  return { entity: await loadEntity(userId, entityId), tag, tagged };
}

/**
 * Undo `markNotContact`. The tags it added stay: they are the user's now, and
 * a note may have been tagged that way for its own reasons since.
 */
export async function restoreContact(userId: string, entityId: string): Promise<Entity> {
  const entity = await loadEntity(userId, entityId);
  if (!getNotContact(entity)) return entity;

  await db.execute({
    sql: `UPDATE entities SET metadata = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [writeEntityMetadata(entity, { not_contact: null }), entityId, userId],
  });
  return loadEntity(userId, entityId);
}
