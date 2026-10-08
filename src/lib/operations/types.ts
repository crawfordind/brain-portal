/**
 * Operations Control Center — shared vocabulary.
 *
 * Imports nothing, for the same reason `chat/item-types.ts` and
 * `provenance/types.ts` import nothing: the browser, the API routes and the MCP
 * tools (which run outside Next.js) all read these, and none of them may drag
 * the DB client in with a type.
 *
 * The control center is a *view* over records Brain Portal already owns. It
 * adds no tables. The operational facts that the existing columns cannot
 * express live in the JSON `metadata` columns that every row already has:
 *
 *   tasks.metadata.ops      kind / who owns the next move / waiting on whom /
 *                           blocked by what / why a decision matters
 *   projects.metadata.ops   the lane state the user chose for a project
 *
 * Every default is chosen so that a row written before this existed reads as
 * the ordinary case. A task with no `ops` key is a confirmed action that the
 * user owns — which is what every existing task already is. Nothing is
 * backfilled and nothing existing is rewritten.
 */

/** What sort of operational fact a task records. Absent = `action`. */
export const OPS_KINDS = ["action", "decision", "waiting", "commitment"] as const;
export type OpsKind = (typeof OPS_KINDS)[number];

/** Who has to move next. Absent = derived from the kind. */
export const OPS_OWNERS = ["me", "other", "system"] as const;
export type OpsOwner = (typeof OPS_OWNERS)[number];

/**
 * Captured → proposed → confirmed → completed.
 *
 * Only `proposed` and `confirmed` are stored on a task. "Captured" is a capture
 * nobody has triaged yet, and "completed" is the task's own `status`. A task
 * with no state is confirmed: every task that exists today was created on
 * purpose by someone.
 */
export const OPS_STATES = ["proposed", "confirmed"] as const;
export type OpsState = (typeof OPS_STATES)[number];

/** For commitments: which way the promise points. */
export const OPS_DIRECTIONS = ["i_owe", "they_owe"] as const;
export type OpsDirection = (typeof OPS_DIRECTIONS)[number];

/** The `metadata.ops` object on a task. Every key is optional. */
export interface OpsFields {
  kind?: OpsKind;
  state?: OpsState;
  owner?: OpsOwner;
  /** Free-text name of the person/org/system involved ("Will", "USDA"). */
  counterparty?: string;
  /** CRM entity id, when the counterparty is a known contact. */
  counterparty_entity_id?: string;
  /** When a waited-on thing was promised or is expected (YYYY-MM-DD). */
  expected_at?: string;
  /** Present = blocked. "me" means only the user can unblock it. */
  blocked_by?: string;
  direction?: OpsDirection;
  /** Decisions: why it matters. */
  why?: string;
  /** Decisions: the options, if known. */
  options?: string[];
  /** Decisions: what happens if it is not made in time. */
  consequence?: string;
  /** Where the item came from, when it was promoted out of intake. */
  source?: { type: "capture" | "note"; id: string };
  updated_at?: string;
}

/** Fully-resolved view of `OpsFields`, with defaults applied. */
export interface ResolvedOps extends OpsFields {
  kind: OpsKind;
  state: OpsState;
  owner: OpsOwner;
  blocked: boolean;
}

/** The project-level lane state. */
export const LANE_STATES = ["active", "waiting", "blocked", "future", "reference"] as const;
export type LaneState = (typeof LANE_STATES)[number];

export const LANE_STATE_LABELS: Record<LaneState, string> = {
  active: "Active",
  waiting: "Waiting",
  blocked: "Blocked",
  future: "Future",
  reference: "Reference",
};

export const KIND_LABELS: Record<OpsKind, string> = {
  action: "Action",
  decision: "Decision",
  waiting: "Waiting on",
  commitment: "Commitment",
};

/** An operational item as every surface (UI, API, MCP) sees it. */
export interface OpsItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  ventureId: string | null;
  ventureName: string | null;
  noteId: string | null;
  updatedAt: string | null;
  ops: ResolvedOps;
  /** The date that matters next: due date, else the expected date. */
  nextDate: string | null;
  /** Deep link to the source record. */
  href: string;
}

export interface OpsSection {
  key: string;
  title: string;
  /** One line under the heading saying what qualifies. */
  hint: string;
  items: OpsItem[];
  /** How many qualified before the section was capped. */
  total: number;
  /** Where "see all" goes. */
  moreHref?: string;
}

export type AutomationStatus =
  | "healthy"
  | "degraded"
  | "failing"
  | "paused"
  | "unknown"
  | "not_connected";

export interface AutomationHealth {
  id: string;
  name: string;
  /** What it is supposed to do, in one sentence. */
  purpose: string;
  status: AutomationStatus;
  /** Plain-language reason for the status; empty when healthy. */
  signal: string;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  /** Who or what depends on it. */
  owner: string;
  /** Recent failures within the window used to judge it. */
  recentFailures: number;
  href?: string;
}

export interface OperationsOverview {
  today: string;
  timeZone: string;
  sections: OpsSection[];
  /** Captures nobody has triaged yet. */
  intakeCount: number;
  /** Automations that need a human. Empty = quiet. */
  automationAlerts: AutomationHealth[];
  counts: {
    overdue: number;
    dueToday: number;
    decisions: number;
    blocked: number;
    waiting: number;
    commitments: number;
    proposed: number;
  };
}

/** Deep links, in one place so every surface points at the same record. */
export function taskHref(id: string): string {
  return `/tasks?task=${encodeURIComponent(id)}`;
}
export function projectHref(slug: string): string {
  return `/projects/${encodeURIComponent(slug)}`;
}
export function contactHref(entityId: string): string {
  return `/crm/${encodeURIComponent(entityId)}`;
}
export function noteHref(idOrSlug: string): string {
  return `/notes/${encodeURIComponent(idOrSlug)}`;
}
