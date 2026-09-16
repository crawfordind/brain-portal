/**
 * Entity merge, and the resolution of unresolved event captures.
 *
 * The merge gate (`assessMerge`) deliberately refuses to fuse two entities
 * automatically when the evidence is a manufactured key match or an unresolved
 * placeholder. That leaves a review queue, and a review queue is useless
 * without a way to act on it. This is that way.
 *
 * A merge moves everything the loser owns onto the winner and then records the
 * loser's name as an ALIAS on the winner. The alias is what makes the merge
 * both durable and undoable in principle: future extraction of the old surface
 * form resolves to the winner, and the alias row is a record that the merge
 * happened at all — which is precisely what the silent
 * UNIQUE(user_id, normalized_key) collision never left behind.
 */

import { db, query, queryOne } from "@/lib/db/client";
import type { Entity } from "@/lib/db/schema";
import { normalizeEntityKey } from "@/lib/entities/resolve";
import { isVenture, readEntityMetadata, writeEntityMetadata } from "./metadata";
import { StructureError } from "./structure";

export interface MergeReport {
  winnerId: string;
  loserId: string;
  moved: {
    mentions: number;
    interactions: number;
    channels: number;
    edges: number;
    aliases: number;
  };
}

async function getEntity(userId: string, id: string): Promise<Entity | null> {
  return queryOne<Entity>(
    `SELECT * FROM entities WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
}

/**
 * Merge `loserId` into `winnerId`.
 *
 * Refuses when either side is a venture: ventures are structural, and folding
 * one into another would silently reassign every role edge pointing at it. Use
 * the structure module to move members instead.
 */
export async function mergeEntities(
  userId: string,
  winnerId: string,
  loserId: string
): Promise<MergeReport> {
  if (winnerId === loserId) {
    throw new StructureError("An entity cannot be merged into itself", 400);
  }

  const winner = await getEntity(userId, winnerId);
  const loser = await getEntity(userId, loserId);
  if (!winner) throw new StructureError("Target contact not found", 404);
  if (!loser) throw new StructureError("Source contact not found", 404);

  if (isVenture(winner) || isVenture(loser)) {
    throw new StructureError(
      "Ventures cannot be merged. Move their products and projects instead.",
      400
    );
  }

  const report: MergeReport = {
    winnerId,
    loserId,
    moved: { mentions: 0, interactions: 0, channels: 0, edges: 0, aliases: 0 },
  };

  // Mentions. UNIQUE(entity_id, source_type, source_id) means the winner may
  // already have a mention from the same source; OR IGNORE keeps that one.
  const movedMentions = await db.execute({
    sql: `UPDATE OR IGNORE entity_mentions SET entity_id = ?
          WHERE entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  report.moved.mentions = movedMentions.rowsAffected;
  await db.execute({
    sql: `DELETE FROM entity_mentions WHERE entity_id = ? AND user_id = ?`,
    args: [loserId, userId],
  });

  // Interactions. venture_id is left exactly as written: a merge changes who
  // the counterparty is, never which venture the touch happened under.
  const movedInteractions = await db.execute({
    sql: `UPDATE interactions SET entity_id = ?, updated_at = datetime('now')
          WHERE entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  report.moved.interactions = movedInteractions.rowsAffected;

  // Channels move wholesale. There is deliberately no duplicate handling here:
  // UNIQUE(user_id, kind, normalized_value) does not include entity_id, so one
  // user can never hold the same address on two entities in the first place.
  // That constraint is what makes inbound resolution unambiguous, and it means
  // a collision at merge time is impossible rather than merely unlikely.
  const movedChannels = await db.execute({
    sql: `UPDATE contact_channels SET entity_id = ?, updated_at = datetime('now')
          WHERE entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  report.moved.channels = movedChannels.rowsAffected;

  // Edges, both directions. UNIQUE(source, target, edge_type) can collide, and
  // a self-edge is meaningless once both ends are the same entity.
  const outgoing = await db.execute({
    sql: `UPDATE OR IGNORE entity_edges SET source_entity_id = ?
          WHERE source_entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  const incoming = await db.execute({
    sql: `UPDATE OR IGNORE entity_edges SET target_entity_id = ?
          WHERE target_entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  report.moved.edges = outgoing.rowsAffected + incoming.rowsAffected;
  await db.execute({
    sql: `DELETE FROM entity_edges
          WHERE user_id = ? AND (source_entity_id = ? OR target_entity_id = ?)`,
    args: [userId, loserId, loserId],
  });
  await db.execute({
    sql: `DELETE FROM entity_edges
          WHERE user_id = ? AND source_entity_id = target_entity_id`,
    args: [userId],
  });

  // Existing aliases of the loser transfer to the winner.
  const movedAliases = await db.execute({
    sql: `UPDATE OR IGNORE entity_aliases SET entity_id = ?
          WHERE entity_id = ? AND user_id = ?`,
    args: [winnerId, loserId, userId],
  });
  report.moved.aliases = movedAliases.rowsAffected;
  await db.execute({
    sql: `DELETE FROM entity_aliases WHERE entity_id = ? AND user_id = ?`,
    args: [loserId, userId],
  });

  // Record the loser's own name as an alias. This is the record that the merge
  // happened, and what makes future extraction of that surface form resolve to
  // the winner instead of recreating the row.
  const loserKey = normalizeEntityKey(loser.canonical_name);
  if (loserKey && loserKey !== normalizeEntityKey(winner.canonical_name)) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO entity_aliases (user_id, entity_id, alias, normalized_key)
            VALUES (?, ?, ?, ?)`,
      args: [userId, winnerId, loser.canonical_name, loserKey],
    });
  }

  // Carry the loser's mention count and earliest sighting onto the winner, and
  // clear any merge_candidate flag now that a human has decided.
  const winnerMetadata = writeEntityMetadata(winner, { merge_candidate: null });
  await db.execute({
    sql: `UPDATE entities SET
            mention_count = mention_count + ?,
            first_seen_at = MIN(first_seen_at, ?),
            last_seen_at = MAX(last_seen_at, ?),
            metadata = ?,
            updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [
      loser.mention_count,
      loser.first_seen_at,
      loser.last_seen_at,
      winnerMetadata,
      winnerId,
      userId,
    ],
  });

  await db.execute({
    sql: `DELETE FROM entities WHERE id = ? AND user_id = ?`,
    args: [loserId, userId],
  });

  return report;
}

/**
 * Promote an unresolved capture to a real contact, either by merging it into an
 * existing one or by confirming it in place.
 *
 * This is the batch-cleanup path for event captures: "Rascal", "Matt in
 * Carlisle" and "Earthworm collective" all arrive as unresolved placeholders
 * and are named later, once the user works out who they were.
 */
export async function resolveContact(
  userId: string,
  unresolvedId: string,
  options: { mergeIntoId?: string | null; confirmedName?: string | null } = {}
): Promise<{ action: "merged" | "confirmed"; entityId: string; report?: MergeReport }> {
  const entity = await getEntity(userId, unresolvedId);
  if (!entity) throw new StructureError("Contact not found", 404);

  if (options.mergeIntoId) {
    const report = await mergeEntities(userId, options.mergeIntoId, unresolvedId);
    return { action: "merged", entityId: options.mergeIntoId, report };
  }

  // Confirm in place, optionally under a proper name now that one is known.
  const name = options.confirmedName?.trim();
  const metadata = writeEntityMetadata(entity, {
    resolution: "confirmed",
    resolution_hint: null,
  });

  if (name && name !== entity.canonical_name) {
    const key = normalizeEntityKey(name);
    if (!key) throw new StructureError("That name has no usable characters");

    const clash = await queryOne<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM entities
       WHERE user_id = ? AND normalized_key = ? AND id <> ?`,
      [userId, key, unresolvedId]
    );
    if (clash) {
      throw new StructureError(
        `"${clash.canonical_name}" already uses that name. Merge into it instead.`,
        409
      );
    }

    await db.execute({
      sql: `UPDATE entities SET canonical_name = ?, normalized_key = ?, metadata = ?,
              updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [name, key, metadata, unresolvedId, userId],
    });
  } else {
    await db.execute({
      sql: `UPDATE entities SET metadata = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?`,
      args: [metadata, unresolvedId, userId],
    });
  }

  return { action: "confirmed", entityId: unresolvedId };
}

/** Entities carrying a merge_candidate flag, with the row they were flagged against. */
export async function listMergeCandidates(userId: string): Promise<
  {
    entity: Entity;
    targetId: string;
    targetName: string | null;
    reason: string;
    confidence: number;
  }[]
> {
  const flagged = await query<Entity>(
    `SELECT * FROM entities
     WHERE user_id = ? AND metadata LIKE '%"merge_candidate"%'
     ORDER BY updated_at DESC`,
    [userId]
  );

  const results = [];
  for (const entity of flagged) {
    const candidate = readEntityMetadata(entity).merge_candidate;
    if (!candidate?.target_entity_id) continue;
    const target = await queryOne<{ canonical_name: string }>(
      `SELECT canonical_name FROM entities WHERE id = ? AND user_id = ?`,
      [candidate.target_entity_id, userId]
    );
    results.push({
      entity,
      targetId: candidate.target_entity_id,
      targetName: target?.canonical_name ?? null,
      reason: candidate.reason,
      confidence: candidate.confidence,
    });
  }
  return results;
}
