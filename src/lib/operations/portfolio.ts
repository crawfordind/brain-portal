/**
 * Portfolio: a truthful map of active work.
 *
 * Many projects are `status = 'active'` because they were imported that way or
 * simply never closed. Rewriting their status would be a bulk reclassification
 * the user never asked for, so this module does not. It reads a *lane state*:
 *
 *   1. the one the user chose, stored in `projects.metadata.ops.lane_state`;
 *   2. otherwise one derived from `projects.status` — and labelled derived.
 *
 * On top of that it *suggests* — never applies — "looks dormant" for an active
 * project with nothing open and nothing touched in 90 days. Acting on the
 * suggestion is one explicit tap that writes metadata on that one project.
 */

import { db, query, queryOne } from "@/lib/db/client";
import { compareItems, isOverdue, isLate } from "./classify";
import { getToday, loadOpenItems, OpsError } from "./queries";
import {
  LANE_STATES,
  projectHref,
  type LaneState,
  type OpsItem,
  type OpsOwner,
} from "./types";

export const DORMANT_AFTER_DAYS = 90;

export type ProjectHealth = "at_risk" | "attention" | "on_track" | "quiet";

export interface PortfolioProject {
  id: string;
  name: string;
  slug: string;
  href: string;
  status: string;
  laneState: LaneState;
  /** False when the state was derived from `status`, not chosen. */
  laneStateChosen: boolean;
  looksDormant: boolean;
  health: ProjectHealth;
  healthReason: string;
  nextMove: {
    title: string;
    href: string;
    owner: OpsOwner;
    counterparty: string | null;
    kind: OpsItem["ops"]["kind"];
  } | null;
  nextDate: string | null;
  openCount: number;
  noteCount: number;
  contactCount: number;
  lastActivityAt: string | null;
  ventureId: string | null;
  ventureName: string | null;
}

export interface PortfolioLane {
  id: string;
  name: string;
  isVenture: boolean;
  href: string | null;
  projects: PortfolioProject[];
}

export interface Portfolio {
  today: string;
  lanes: PortfolioLane[];
  counts: Record<LaneState, number> & { dormant: number };
}

// ─── Pure core ──────────────────────────────────────────────────────────

export function readLaneState(metadata: unknown): LaneState | null {
  let parsed: unknown = metadata;
  if (typeof metadata === "string") {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  const ops = (parsed as { ops?: { lane_state?: unknown } } | null)?.ops;
  const value = ops?.lane_state;
  return typeof value === "string" && (LANE_STATES as readonly string[]).includes(value)
    ? (value as LaneState)
    : null;
}

/**
 * The lane a project's existing status implies. `stalled` reads as blocked
 * because the app has used it for "not moving"; the UI marks every derived
 * state as such, so the guess is visible, not asserted.
 */
export function laneFromStatus(status: string | null): LaneState {
  switch (status) {
    case "planning":
      return "future";
    case "stalled":
      return "blocked";
    case "completed":
    case "archived":
      return "reference";
    default:
      return "active";
  }
}

export function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toDay.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** The one item that best answers "what is the next move here?". */
export function pickNextMove(items: OpsItem[], today: string): OpsItem | null {
  if (items.length === 0) return null;
  const rank = (item: OpsItem) => {
    if (item.ops.owner === "me" && isOverdue(item, today)) return 0;
    if (item.ops.blocked) return 1;
    if (item.ops.kind === "decision") return 2;
    if (item.nextDate) return 3;
    return 4;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || compareItems(a, b))[0];
}

export function assessHealth(
  items: OpsItem[],
  today: string
): { health: ProjectHealth; reason: string } {
  const confirmed = items.filter((i) => i.ops.state === "confirmed");
  if (confirmed.length === 0) {
    return { health: "quiet", reason: "Nothing open" };
  }
  const overdue = confirmed.filter((i) => i.ops.owner === "me" && isOverdue(i, today)).length;
  const blocked = confirmed.filter((i) => i.ops.blocked).length;
  if (overdue || blocked) {
    const parts = [
      overdue ? `${overdue} overdue` : "",
      blocked ? `${blocked} blocked` : "",
    ].filter(Boolean);
    return { health: "at_risk", reason: parts.join(", ") };
  }
  const decisions = confirmed.filter((i) => i.ops.kind === "decision").length;
  const late = confirmed.filter((i) => i.ops.kind === "waiting" && isLate(i, today)).length;
  if (decisions || late) {
    const parts = [
      decisions ? `${decisions} decision${decisions === 1 ? "" : "s"} waiting on you` : "",
      late ? `${late} overdue from others` : "",
    ].filter(Boolean);
    return { health: "attention", reason: parts.join(", ") };
  }
  return { health: "on_track", reason: `${confirmed.length} open, nothing late` };
}

// ─── Reads ──────────────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  metadata: string | null;
  updated_at: string | null;
  venture_id: string | null;
  venture_name: string | null;
}

async function loadProjects(userId: string): Promise<ProjectRow[]> {
  const base = `SELECT p.id, p.name, p.slug, p.status, p.metadata, p.updated_at`;
  try {
    return await query<ProjectRow>(
      `${base}, p.venture_id, v.canonical_name AS venture_name
       FROM projects p LEFT JOIN entities v ON v.id = p.venture_id
       WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE`,
      [userId]
    );
  } catch {
    return query<ProjectRow>(
      `${base}, NULL AS venture_id, NULL AS venture_name
       FROM projects p WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE`,
      [userId]
    );
  }
}

async function loadActivity(userId: string) {
  const [notes, tasks] = await Promise.all([
    query<{ project_id: string; n: number; last: string | null }>(
      `SELECT project_id, COUNT(*) AS n, MAX(updated_at) AS last FROM notes
       WHERE user_id = ? AND project_id IS NOT NULL AND (is_archived = 0 OR is_archived IS NULL)
       GROUP BY project_id`,
      [userId]
    ),
    query<{ project_id: string; last: string | null }>(
      `SELECT project_id, MAX(updated_at) AS last FROM tasks
       WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id`,
      [userId]
    ),
  ]);
  const noteMap = new Map(notes.map((r) => [String(r.project_id), r]));
  const taskMap = new Map(tasks.map((r) => [String(r.project_id), r.last]));
  return { noteMap, taskMap };
}

function latest(...values: (string | null | undefined)[]): string | null {
  return values.filter((v): v is string => !!v).sort().pop() ?? null;
}

export async function getPortfolio(userId: string, now: Date = new Date()): Promise<Portfolio> {
  const [{ today }, projects, items, activity] = await Promise.all([
    getToday(userId, now),
    loadProjects(userId),
    loadOpenItems(userId),
    loadActivity(userId),
  ]);

  const byProject = new Map<string, OpsItem[]>();
  for (const item of items) {
    if (!item.projectId) continue;
    const list = byProject.get(item.projectId) ?? [];
    list.push(item);
    byProject.set(item.projectId, list);
  }

  const counts = { active: 0, waiting: 0, blocked: 0, future: 0, reference: 0, dormant: 0 };
  const lanes = new Map<string, PortfolioLane>();

  for (const row of projects) {
    const id = String(row.id);
    const open = byProject.get(id) ?? [];
    const chosen = readLaneState(row.metadata);
    const laneState = chosen ?? laneFromStatus(row.status);
    const note = activity.noteMap.get(id);
    const lastActivityAt = latest(row.updated_at, note?.last, activity.taskMap.get(id));
    const looksDormant =
      !chosen &&
      laneState === "active" &&
      open.length === 0 &&
      (!lastActivityAt || daysBetween(lastActivityAt, today) > DORMANT_AFTER_DAYS);

    const next = pickNextMove(open.filter((i) => i.ops.state === "confirmed"), today);
    const { health, reason } = assessHealth(open, today);
    const contacts = new Set(
      open.map((i) => i.ops.counterparty_entity_id).filter(Boolean)
    );

    const project: PortfolioProject = {
      id,
      name: row.name,
      slug: row.slug,
      href: projectHref(row.slug),
      status: row.status ?? "active",
      laneState,
      laneStateChosen: !!chosen,
      looksDormant,
      health,
      healthReason: reason,
      nextMove: next
        ? {
            title: next.title,
            href: next.href,
            owner: next.ops.owner,
            counterparty: next.ops.counterparty ?? null,
            kind: next.ops.kind,
          }
        : null,
      nextDate: open.map((i) => i.nextDate).filter((d): d is string => !!d).sort()[0] ?? null,
      openCount: open.length,
      noteCount: Number(note?.n) || 0,
      contactCount: contacts.size,
      lastActivityAt,
      ventureId: row.venture_id ?? null,
      ventureName: row.venture_name ?? null,
    };

    counts[laneState] += 1;
    if (looksDormant) counts.dormant += 1;

    const laneId = row.venture_id ?? "unassigned";
    if (!lanes.has(laneId)) {
      lanes.set(laneId, {
        id: laneId,
        name: row.venture_name ?? "Not under a venture",
        isVenture: !!row.venture_id,
        href: row.venture_id ? `/crm/ventures/${encodeURIComponent(row.venture_id)}` : null,
        projects: [],
      });
    }
    lanes.get(laneId)!.projects.push(project);
  }

  // Ventures first (alphabetical), the catch-all last.
  const ordered = [...lanes.values()].sort((a, b) => {
    if (a.isVenture !== b.isVenture) return a.isVenture ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { today, lanes: ordered, counts };
}

// ─── Write ──────────────────────────────────────────────────────────────

/**
 * Set (or clear, with `null`) the lane state the user chose for one project.
 * Writes only `metadata.ops.lane_state`; `projects.status`, which other
 * features read, is untouched. Returns the previous value for undo.
 */
export async function setLaneState(
  userId: string,
  projectId: string,
  state: LaneState | null
): Promise<{ previous: LaneState | null; next: LaneState | null }> {
  if (state !== null && !(LANE_STATES as readonly string[]).includes(state)) {
    throw new OpsError(`state must be one of ${LANE_STATES.join(", ")}`);
  }
  const row = await queryOne<{ metadata: string | null }>(
    "SELECT metadata FROM projects WHERE id = ? AND user_id = ?",
    [projectId, userId]
  );
  if (!row) throw new OpsError("Project not found", 404);

  let whole: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadata || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) whole = parsed;
  } catch {
    whole = {};
  }
  const previous = readLaneState(whole);
  const ops =
    whole.ops && typeof whole.ops === "object" && !Array.isArray(whole.ops)
      ? { ...(whole.ops as Record<string, unknown>) }
      : {};
  if (state === null) delete ops.lane_state;
  else ops.lane_state = state;
  whole.ops = ops;

  // `updated_at` is deliberately not bumped: a lane label is not an edit to
  // the project, and bumping it would hide the project's real last activity.
  await db.execute({
    sql: "UPDATE projects SET metadata = ? WHERE id = ? AND user_id = ?",
    args: [JSON.stringify(whole), projectId, userId],
  });
  return { previous, next: state };
}
