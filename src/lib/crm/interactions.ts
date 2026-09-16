/**
 * Interaction logging.
 *
 * An interaction is a touch: something that actually passed between the user
 * and a counterparty. `entity_mentions` is a citation, this is a conversation.
 *
 * Writes are idempotent through `dedup_key`, so the same email can be delivered
 * twice by a mail poller, or the same meeting captured four times, without
 * producing four rows.
 */

import { db, query, queryOne } from "@/lib/db/client";
import type {
  Interaction,
  InteractionChannel,
  InteractionDirection,
} from "@/lib/db/schema";
import { buildInteractionDedupKey } from "./dedup";

export const INTERACTION_CHANNELS: InteractionChannel[] = [
  "email",
  "call",
  "sms",
  "dm",
  "meeting",
  "event",
  "note",
  "other",
];

export const INTERACTION_DIRECTIONS: InteractionDirection[] = [
  "in",
  "out",
  "internal",
];

export interface LogInteractionInput {
  entityId?: string | null;
  /**
   * The venture this happened under. Stored as written and never recomputed —
   * a product moving to another venture must not rewrite past touches.
   */
  ventureId?: string | null;
  dealId?: string | null;
  direction?: InteractionDirection;
  channel?: InteractionChannel;
  occurredAt?: string;
  subject?: string | null;
  body?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LogInteractionResult {
  interaction: Interaction;
  /** True when an interaction with this key already existed. */
  deduped: boolean;
}

export async function logInteraction(
  userId: string,
  input: LogInteractionInput
): Promise<LogInteractionResult> {
  const direction = INTERACTION_DIRECTIONS.includes(
    input.direction as InteractionDirection
  )
    ? (input.direction as InteractionDirection)
    : "in";

  const channel = INTERACTION_CHANNELS.includes(
    input.channel as InteractionChannel
  )
    ? (input.channel as InteractionChannel)
    : "note";

  const occurredAt = input.occurredAt?.trim() || new Date().toISOString();

  const dedupKey = buildInteractionDedupKey({
    channel,
    occurredAt,
    entityId: input.entityId ?? null,
    subject: input.subject ?? null,
    externalId: input.externalId ?? null,
  });

  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO interactions
            (user_id, entity_id, venture_id, deal_id, direction, channel,
             occurred_at, subject, body, source_type, source_id, dedup_key, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      input.entityId ?? null,
      input.ventureId ?? null,
      input.dealId ?? null,
      direction,
      channel,
      occurredAt,
      input.subject ?? null,
      input.body ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      dedupKey,
      JSON.stringify(input.metadata ?? {}),
    ],
  });

  const interaction = await queryOne<Interaction>(
    `SELECT * FROM interactions WHERE user_id = ? AND dedup_key = ?`,
    [userId, dedupKey]
  );
  if (!interaction) {
    throw new Error("Interaction could not be stored");
  }

  return { interaction, deduped: result.rowsAffected === 0 };
}

export async function listInteractionsForEntity(
  userId: string,
  entityId: string,
  limit = 100
): Promise<Interaction[]> {
  return query<Interaction>(
    `SELECT * FROM interactions
     WHERE user_id = ? AND entity_id = ?
     ORDER BY occurred_at DESC
     LIMIT ?`,
    [userId, entityId, Math.min(Math.max(1, limit), 500)]
  );
}

/**
 * Resolve an inbound channel value to the entity that owns it.
 * `contact_channels` is UNIQUE per (user, kind, normalized_value), so this is
 * unambiguous by construction.
 */
export async function resolveEntityByChannel(
  userId: string,
  kind: string,
  normalizedValue: string
): Promise<string | null> {
  if (!normalizedValue) return null;
  const row = await queryOne<{ entity_id: string }>(
    `SELECT entity_id FROM contact_channels
     WHERE user_id = ? AND kind = ? AND normalized_value = ?`,
    [userId, kind, normalizedValue]
  );
  return row?.entity_id ?? null;
}
