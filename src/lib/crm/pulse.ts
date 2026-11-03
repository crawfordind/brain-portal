/**
 * The dashboard's view of the CRM.
 *
 * The Rolodex at `/crm` answers "who do I know?". The dashboard has to answer a
 * narrower question — *does the CRM need me right now?* — so this module returns
 * only the two numbers that represent a pending human decision (contacts that
 * are unresolved or flagged as possible duplicates, and follow-ups whose date
 * has arrived) plus a handful of recent touches for context.
 *
 * Three properties matter here:
 *
 * - **It never throws.** The dashboard is the app's front door. `interactions`
 *   and `contact_channels` only exist after the Phase 0 migration, so on a
 *   database that has not run it every probe is wrapped and degrades to zero
 *   rather than 500ing the home page.
 * - **Absent metadata means "fine".** Same rule as `src/lib/crm/metadata.ts`:
 *   entities written before the CRM existed carry none of these keys, and
 *   reading an absent key as "needs attention" would flag the whole graph on
 *   day one. Every predicate here tests for the *presence* of a problem.
 * - **`json_valid` guards every `json_extract`.** SQLite raises on malformed
 *   JSON; one bad `metadata` row must not take the dashboard down.
 */

import { db } from "@/lib/db/client";
import { stillAContactSql } from "./metadata";

export interface RecentTouch {
  id: string;
  entityId: string | null;
  contactName: string | null;
  ventureName: string | null;
  channel: string;
  direction: string;
  subject: string | null;
  occurredAt: string;
}

/**
 * A contact the Mind map draws as a person in the user's brain.
 *
 * Only people with a reason to be there: a follow-up whose date has arrived,
 * a capture that needs sorting, or someone the user was in touch with lately.
 */
export interface PulsePerson {
  id: string;
  name: string;
  entityType: "person" | "org";
  reason: "follow_up" | "review" | "recent";
  /** Follow-up date for `follow_up`, last touch for `recent`, else the row's update. */
  at: string | null;
  ventureName: string | null;
}

export interface CrmPulse {
  /** Whether the user has any contacts at all. Decides if the CRM renders. */
  hasContacts: boolean;
  contactCount: number;
  /** Unresolved captures + flagged possible duplicates. A human decision. */
  needsReview: number;
  /** Contacts whose `crm.next_action_at` has arrived. */
  followUpsDue: number;
  recentTouches: RecentTouch[];
  /** Up to `MAX_PULSE_PEOPLE` people worth a place on the Mind map. */
  people: PulsePerson[];
}

export const MAX_PULSE_PEOPLE = 8;

export const EMPTY_CRM_PULSE: CrmPulse = {
  hasContacts: false,
  contactCount: 0,
  needsReview: 0,
  followUpsDue: 0,
  recentTouches: [],
  people: [],
};

/** A venture is an org entity, not a contact, and is excluded everywhere here. */
const NOT_A_VENTURE = `COALESCE(
  CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.is_venture') END,
  0
) <> 1`;

const META = (path: string) =>
  `CASE WHEN json_valid(metadata) THEN json_extract(metadata, '${path}') END`;

export async function getCrmPulse(userId: string): Promise<CrmPulse> {
  const [counts, touches, people] = await Promise.all([
    getContactCounts(userId),
    getRecentTouches(userId),
    getPulsePeople(userId),
  ]);

  return {
    ...counts,
    hasContacts: counts.contactCount > 0,
    recentTouches: touches,
    people,
  };
}

/**
 * The people the Mind map draws: follow-ups due first (oldest date first),
 * then contacts to sort, then whoever the user was in touch with most
 * recently. Each person appears once, under their most pressing reason.
 */
async function getPulsePeople(userId: string): Promise<PulsePerson[]> {
  const people: PulsePerson[] = [];
  const seen = new Set<string>();
  const push = (row: Record<string, unknown>, reason: PulsePerson["reason"], at: unknown) => {
    const id = String(row.id);
    if (seen.has(id) || people.length >= MAX_PULSE_PEOPLE) return;
    seen.add(id);
    people.push({
      id,
      name: String(row.name ?? "Someone"),
      entityType: row.entity_type === "org" ? "org" : "person",
      reason,
      at: at == null ? null : String(at),
      ventureName: (row.venture_name as string | null) ?? null,
    });
  };

  try {
    const pending = await db.execute({
      sql: `SELECT id, canonical_name AS name, entity_type, updated_at,
                   ${META("$.crm.next_action_at")} AS next_at,
                   CASE
                     WHEN ${META("$.crm.next_action_at")} IS NOT NULL
                      AND ${META("$.crm.next_action_at")} <= datetime('now') THEN 0
                     ELSE 1
                   END AS bucket,
                   NULL AS venture_name
            FROM entities
            WHERE user_id = ?
              AND entity_type IN ('person', 'org')
              AND ${NOT_A_VENTURE}
              AND ${stillAContactSql()}
              AND (
                (${META("$.crm.next_action_at")} IS NOT NULL
                  AND ${META("$.crm.next_action_at")} <= datetime('now'))
                OR ${META("$.resolution")} = 'unresolved'
                OR ${META("$.merge_candidate.target_entity_id")} IS NOT NULL
              )
            ORDER BY bucket ASC, next_at ASC, updated_at DESC
            LIMIT ?`,
      args: [userId, MAX_PULSE_PEOPLE],
    });
    for (const raw of pending.rows) {
      const row = raw as unknown as Record<string, unknown>;
      if (Number(row.bucket) === 0) push(row, "follow_up", row.next_at);
      else push(row, "review", row.updated_at);
    }
  } catch (error) {
    console.error("[crm/pulse] pending people failed:", error);
  }

  if (people.length >= MAX_PULSE_PEOPLE) return people;

  try {
    const recent = await db.execute({
      sql: `SELECT e.id, e.canonical_name AS name, e.entity_type,
                   MAX(i.occurred_at) AS last_at,
                   NULL AS venture_name
            FROM interactions i
            JOIN entities e ON e.id = i.entity_id
            WHERE i.user_id = ?
              AND e.entity_type IN ('person', 'org')
              AND ${stillAContactSql("e")}
            GROUP BY e.id
            ORDER BY last_at DESC
            LIMIT ?`,
      args: [userId, MAX_PULSE_PEOPLE],
    });
    for (const raw of recent.rows) {
      const row = raw as unknown as Record<string, unknown>;
      push(row, "recent", row.last_at);
    }
  } catch {
    // `interactions` does not exist until the Phase 0 migration has run.
  }

  return people;
}

async function getContactCounts(
  userId: string
): Promise<Omit<CrmPulse, "hasContacts" | "recentTouches" | "people">> {
  try {
    const result = await db.execute({
      sql: `SELECT
              COUNT(*) AS contactCount,
              SUM(CASE
                WHEN ${META("$.resolution")} = 'unresolved'
                  OR ${META("$.merge_candidate.target_entity_id")} IS NOT NULL
                THEN 1 ELSE 0 END) AS needsReview,
              SUM(CASE
                WHEN ${META("$.crm.next_action_at")} IS NOT NULL
                 AND ${META("$.crm.next_action_at")} <= datetime('now')
                THEN 1 ELSE 0 END) AS followUpsDue
            FROM entities
            WHERE user_id = ?
              AND entity_type IN ('person', 'org')
              AND ${NOT_A_VENTURE}
              AND ${stillAContactSql()}`,
      args: [userId],
    });

    const row = result.rows[0] as Record<string, number> | undefined;
    return {
      contactCount: Number(row?.contactCount) || 0,
      needsReview: Number(row?.needsReview) || 0,
      followUpsDue: Number(row?.followUpsDue) || 0,
    };
  } catch (error) {
    console.error("[crm/pulse] contact counts failed:", error);
    return { contactCount: 0, needsReview: 0, followUpsDue: 0 };
  }
}

async function getRecentTouches(userId: string): Promise<RecentTouch[]> {
  try {
    const result = await db.execute({
      sql: `SELECT i.id, i.entity_id, i.channel, i.direction, i.subject,
                   i.occurred_at, e.canonical_name AS contact_name,
                   v.canonical_name AS venture_name
            FROM interactions i
            LEFT JOIN entities e ON e.id = i.entity_id
            LEFT JOIN entities v ON v.id = i.venture_id
            WHERE i.user_id = ?
              AND (e.id IS NULL OR ${stillAContactSql("e")})
            ORDER BY i.occurred_at DESC
            LIMIT 3`,
      args: [userId],
    });

    return result.rows.map((raw) => {
      const row = raw as unknown as Record<string, string | null>;
      return {
        id: String(row.id),
        entityId: row.entity_id ?? null,
        contactName: row.contact_name ?? null,
        ventureName: row.venture_name ?? null,
        channel: String(row.channel ?? "note"),
        direction: String(row.direction ?? "in"),
        subject: row.subject ?? null,
        occurredAt: String(row.occurred_at ?? ""),
      };
    });
  } catch {
    // `interactions` does not exist until the Phase 0 migration has run.
    return [];
  }
}
