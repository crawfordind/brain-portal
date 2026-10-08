/**
 * Relationships and follow-through.
 *
 * The Rolodex at `/crm` answers "who do I know?". This answers "who am I in
 * the middle of something with?": for each person or org, what the user owes
 * them, what they owe the user, where the relationship stands and when they
 * last actually spoke.
 *
 * Who appears is decided by open work, not by mention count: a contact is
 * listed when an open item names them, when their CRM follow-up date has
 * arrived, or when there was a real touch in the last 30 days. A counterparty
 * typed as a name that matches no contact is listed too, marked as such,
 * rather than dropped.
 */

import { query } from "@/lib/db/client";
import { ENTITY_ROLE_EDGE_TYPES } from "@/lib/db/schema";
import { compareItems } from "./classify";
import { getToday, loadOpenItems } from "./queries";
import { contactHref, type OpsItem } from "./types";

const RECENT_TOUCH_DAYS = 30;

export interface RelationshipRow {
  /** Entity id, or `name:<lowercased>` for a counterparty not in contacts. */
  key: string;
  entityId: string | null;
  name: string;
  entityType: string | null;
  href: string | null;
  stage: string | null;
  ventures: string[];
  lastTouch: { at: string; subject: string | null; channel: string } | null;
  followUpDue: string | null;
  youOwe: OpsItem[];
  theyOwe: OpsItem[];
  mentionCount: number;
}

export interface RelationshipsView {
  today: string;
  rows: RelationshipRow[];
}

/** Which side of the ledger an item belongs on. Pure. */
export function ledgerSide(item: OpsItem): "you" | "they" {
  if (item.ops.kind === "waiting") return "they";
  if (item.ops.kind === "commitment" && item.ops.direction === "they_owe") return "they";
  return item.ops.owner === "me" ? "you" : "they";
}

interface EntityRow {
  id: string;
  canonical_name: string;
  entity_type: string;
  mention_count: number | null;
  metadata: string | null;
}

function readCrm(metadata: string | null): { stage: string | null; nextAt: string | null } {
  try {
    const parsed = JSON.parse(metadata || "{}");
    const crm = parsed?.crm ?? {};
    return {
      stage: typeof crm.relationship_stage === "string" ? crm.relationship_stage : null,
      nextAt: typeof crm.next_action_at === "string" ? crm.next_action_at : null,
    };
  } catch {
    return { stage: null, nextAt: null };
  }
}

async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    // CRM tables are optional (Phase 0 migration); degrade to nothing.
    return [];
  }
}

export async function getRelationships(
  userId: string,
  options: { ventureId?: string | null } = {},
  now: Date = new Date()
): Promise<RelationshipsView> {
  const [{ today }, items] = await Promise.all([getToday(userId, now), loadOpenItems(userId)]);

  const withParty = items.filter(
    (i) => i.ops.state === "confirmed" && (i.ops.counterparty_entity_id || i.ops.counterparty)
  );
  const linkedIds = new Set(
    withParty.map((i) => i.ops.counterparty_entity_id).filter((id): id is string => !!id)
  );

  const [dueRows, touchRows] = await Promise.all([
    safe(() =>
      query<{ id: string }>(
        `SELECT id FROM entities
         WHERE user_id = ? AND entity_type IN ('person', 'org')
           AND CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.crm.next_action_at') END <= datetime('now')`,
        [userId]
      )
    ),
    safe(() =>
      query<{ entity_id: string }>(
        `SELECT DISTINCT entity_id FROM interactions
         WHERE user_id = ? AND entity_id IS NOT NULL
           AND occurred_at >= datetime('now', '-${RECENT_TOUCH_DAYS} days')`,
        [userId]
      )
    ),
  ]);
  dueRows.forEach((r) => linkedIds.add(String(r.id)));
  touchRows.forEach((r) => linkedIds.add(String(r.entity_id)));

  const ids = [...linkedIds];
  const placeholders = ids.map(() => "?").join(",");
  const rolePlaceholders = ENTITY_ROLE_EDGE_TYPES.map(() => "?").join(",");

  const [entities, lastTouches, roles] = ids.length
    ? await Promise.all([
        safe(() =>
          query<EntityRow>(
            `SELECT id, canonical_name, entity_type, mention_count, metadata FROM entities
             WHERE user_id = ? AND id IN (${placeholders})`,
            [userId, ...ids]
          )
        ),
        safe(() =>
          query<{ entity_id: string; occurred_at: string; subject: string | null; channel: string }>(
            `SELECT i.entity_id, i.occurred_at, i.subject, i.channel FROM interactions i
             WHERE i.user_id = ? AND i.entity_id IN (${placeholders})
               AND i.occurred_at = (SELECT MAX(occurred_at) FROM interactions j
                                    WHERE j.entity_id = i.entity_id AND j.user_id = i.user_id)`,
            [userId, ...ids]
          )
        ),
        safe(() =>
          query<{ source_entity_id: string; venture_id: string; venture_name: string }>(
            `SELECT e.source_entity_id, v.id AS venture_id, v.canonical_name AS venture_name
             FROM entity_edges e JOIN entities v ON v.id = e.target_entity_id
             WHERE e.user_id = ? AND e.edge_type IN (${rolePlaceholders})
               AND e.source_entity_id IN (${placeholders})`,
            [userId, ...ENTITY_ROLE_EDGE_TYPES, ...ids]
          )
        ),
      ])
    : [[], [], []];

  const rows = new Map<string, RelationshipRow>();
  const ventureIdsByEntity = new Map<string, Set<string>>();

  for (const entity of entities) {
    const id = String(entity.id);
    const crm = readCrm(entity.metadata);
    const touch = lastTouches.find((t) => String(t.entity_id) === id);
    const ventureRoles = roles.filter((r) => String(r.source_entity_id) === id);
    ventureIdsByEntity.set(id, new Set(ventureRoles.map((r) => String(r.venture_id))));
    rows.set(id, {
      key: id,
      entityId: id,
      name: entity.canonical_name,
      entityType: entity.entity_type,
      href: contactHref(id),
      stage: crm.stage,
      ventures: [...new Set(ventureRoles.map((r) => r.venture_name))],
      lastTouch: touch
        ? { at: touch.occurred_at, subject: touch.subject, channel: touch.channel }
        : null,
      followUpDue: crm.nextAt && crm.nextAt.slice(0, 10) <= today ? crm.nextAt.slice(0, 10) : null,
      youOwe: [],
      theyOwe: [],
      mentionCount: Number(entity.mention_count) || 0,
    });
  }

  for (const item of withParty) {
    const entityId = item.ops.counterparty_entity_id;
    let row = entityId ? rows.get(entityId) : undefined;
    if (!row) {
      const name = item.ops.counterparty ?? "Unknown";
      const key = `name:${name.toLowerCase()}`;
      row = rows.get(key);
      if (!row) {
        row = {
          key,
          entityId: null,
          name,
          entityType: null,
          href: null,
          stage: null,
          ventures: [],
          lastTouch: null,
          followUpDue: null,
          youOwe: [],
          theyOwe: [],
          mentionCount: 0,
        };
        rows.set(key, row);
      }
    }
    if (item.ventureName && !row.ventures.includes(item.ventureName)) {
      row.ventures.push(item.ventureName);
    }
    (ledgerSide(item) === "you" ? row.youOwe : row.theyOwe).push(item);
  }

  let list = [...rows.values()];
  if (options.ventureId) {
    const ventureId = options.ventureId;
    list = list.filter(
      (row) =>
        (row.entityId && ventureIdsByEntity.get(row.entityId)?.has(ventureId)) ||
        [...row.youOwe, ...row.theyOwe].some((i) => i.ventureId === ventureId)
    );
  }

  for (const row of list) {
    row.youOwe.sort(compareItems);
    row.theyOwe.sort(compareItems);
  }

  // Most pressing first: something owed with a date, then a due follow-up,
  // then anything owed, then the merely recent.
  const urgency = (row: RelationshipRow) => {
    const dated = [...row.youOwe, ...row.theyOwe].map((i) => i.nextDate).filter(Boolean).sort()[0];
    if (dated) return `0${dated}`;
    if (row.followUpDue) return `1${row.followUpDue}`;
    if (row.youOwe.length || row.theyOwe.length) return "2";
    return `3${row.lastTouch ? `~${row.lastTouch.at}` : "~"}`;
  };
  list.sort((a, b) => urgency(a).localeCompare(urgency(b)) || a.name.localeCompare(b.name));

  return { today, rows: list };
}
