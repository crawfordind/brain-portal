/**
 * Project manager's dashboard: the portfolio computed from rows the app
 * already has.
 *
 * Pure. The route (`/api/projects/dashboard`) loads projects and their tasks;
 * everything a PM reads off the page (progress, health, schedule forecast,
 * look-ahead, throughput, burn-up) is derived here, so the same rows always
 * give the same picture and every figure is testable without a database.
 *
 * Three rules keep it honest:
 *
 * - **No invented dates.** A project's plan ends at its latest task due date.
 *   A project with no due dates has no plan end, and says so; it is never
 *   given one.
 * - **Forecasts come from evidence.** Pace is tasks completed over the last
 *   four weeks. No completions means no forecast ("no recent pace"), not a
 *   projection from zero or from a guess.
 * - **Every health call carries its reason**, in words, so a red badge can be
 *   argued with.
 */

import { readOps } from "@/lib/operations/fields";

// ─── Inputs ─────────────────────────────────────────────────────────────

export interface DashboardProjectRow {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  color: string | null;
  parent_id: string | null;
  priority: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface DashboardTaskRow {
  id: string;
  project_id: string;
  title: string | null;
  content: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: string | null;
}

// ─── Outputs ────────────────────────────────────────────────────────────

export type PmHealth = "at_risk" | "attention" | "on_track" | "quiet";

export interface PmMilestone {
  taskId: string;
  title: string;
  date: string;
  overdue: boolean;
  priority: string;
}

export interface PmProject {
  id: string;
  name: string;
  slug: string;
  status: string;
  color: string | null;
  pinned: boolean;
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  overdue: number;
  blocked: number;
  urgent: number;
  /** 0..100, of non-cancelled tasks. */
  percentDone: number;
  /** Day the work began: the project's creation or its first task, whichever is earlier. */
  start: string | null;
  /** Latest due date among open tasks; null when nothing open has a date. */
  planEnd: string | null;
  /** Projected finish at the current pace; null without pace or open work. */
  forecastEnd: string | null;
  /** forecastEnd - planEnd in days. Positive = behind plan. */
  slipDays: number | null;
  /** Tasks completed per week, averaged over the last four weeks. */
  weeklyPace: number;
  completedLast28: number;
  lastActivity: string | null;
  health: PmHealth;
  healthReason: string;
  nextDue: PmMilestone | null;
  /** Open dated tasks, earliest first, for timeline markers. Capped. */
  milestones: PmMilestone[];
}

export interface PmUpcomingTask {
  taskId: string;
  title: string;
  date: string;
  priority: string;
  status: string;
  overdue: boolean;
  blocked: boolean;
  projectId: string;
  projectName: string;
  projectSlug: string;
}

export interface PmWeek {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  created: number;
  completed: number;
  /** Cumulative tasks in scope at the end of the week (non-cancelled). */
  scope: number;
  /** Cumulative tasks done at the end of the week. */
  doneTotal: number;
}

export interface PmWorkloadRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  /** Open tasks due in each look-ahead week, aligned with `workloadWeeks`. */
  counts: number[];
}

export interface PmKpis {
  activeProjects: number;
  openTasks: number;
  overdue: number;
  dueNext7: number;
  completedLast30: number;
  atRisk: number;
  blocked: number;
  /** Share of tasks with a due date completed in the last 30 days that finished on time. Null without any. */
  onTimeRate: number | null;
  onTimeSample: number;
}

export interface ProjectDashboard {
  today: string;
  kpis: PmKpis;
  projects: PmProject[];
  upcoming: PmUpcomingTask[];
  history: PmWeek[];
  workloadWeeks: string[];
  workload: PmWorkloadRow[];
  /** Open tasks due beyond the look-ahead or with no date, so the heatmap's silence is explained. */
  undated: number;
}

// ─── Tunables ───────────────────────────────────────────────────────────

export const HISTORY_WEEKS = 12;
export const LOOKAHEAD_WEEKS = 8;
export const UPCOMING_DAYS = 30;
export const MAX_UPCOMING = 150;
export const MAX_MILESTONES = 40;
export const PACE_WINDOW_DAYS = 28;
export const STALE_AFTER_DAYS = 14;

const CLOSED_PROJECT = new Set(["completed", "archived"]);

// ─── Date helpers (calendar days, UTC arithmetic on YYYY-MM-DD) ─────────

/** The calendar day of a stored value: date-only, ISO, or SQLite `YYYY-MM-DD HH:MM:SS`. */
export function toDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : null;
}

function dayNumber(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

export function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function minDay(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

// ─── Task classification ────────────────────────────────────────────────

type TaskState = "done" | "in_progress" | "todo" | "cancelled";

function taskState(status: string | null): TaskState {
  switch (status) {
    case "completed":
      return "done";
    case "in_progress":
      return "in_progress";
    case "cancelled":
      return "cancelled";
    default:
      return "todo";
  }
}

function taskTitle(task: DashboardTaskRow): string {
  const raw = (task.title?.trim() || task.content?.trim() || "Untitled task").split("\n")[0];
  return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
}

function isBlocked(task: DashboardTaskRow): boolean {
  return !!readOps(task.metadata).blocked_by;
}

// ─── Health ─────────────────────────────────────────────────────────────

export interface HealthInput {
  open: number;
  overdue: number;
  blocked: number;
  urgent: number;
  slipDays: number | null;
  weeklyPace: number;
  daysSinceActivity: number | null;
}

/**
 * One call per project, worst condition first. Thresholds are the ones a PM
 * would argue for in a status meeting: any blocker or a quarter of open work
 * overdue is red; a week's projected slip is red; anything late is amber.
 */
export function assessPmHealth(input: HealthInput): { health: PmHealth; reason: string } {
  const { open, overdue, blocked, urgent, slipDays, weeklyPace, daysSinceActivity } = input;
  if (open === 0) return { health: "quiet", reason: "Nothing open" };

  const red: string[] = [];
  if (blocked > 0) red.push(`${blocked} blocked`);
  if (overdue >= 3 || (overdue > 0 && overdue / open >= 0.25)) red.push(`${overdue} overdue`);
  if (slipDays !== null && slipDays > 7) red.push(`forecast ${slipDays}d past plan`);
  if (red.length) return { health: "at_risk", reason: red.join(", ") };

  const amber: string[] = [];
  if (overdue > 0) amber.push(`${overdue} overdue`);
  if (slipDays !== null && slipDays > 0) amber.push(`forecast ${slipDays}d past plan`);
  if (urgent >= 3) amber.push(`${urgent} urgent/high open`);
  if (daysSinceActivity !== null && daysSinceActivity >= STALE_AFTER_DAYS) {
    amber.push(`no activity in ${daysSinceActivity}d`);
  } else if (weeklyPace === 0) {
    amber.push("no completions in 4 weeks");
  }
  if (amber.length) return { health: "attention", reason: amber.join(", ") };

  return { health: "on_track", reason: `${open} open, nothing late` };
}

/** Projected finish at `weeklyPace`, or null when there is no pace to project from. */
export function forecastFinish(today: string, open: number, weeklyPace: number): string | null {
  if (open <= 0 || weeklyPace <= 0) return null;
  return addDays(today, Math.ceil((open / weeklyPace) * 7));
}

const HEALTH_RANK: Record<PmHealth, number> = { at_risk: 0, attention: 1, on_track: 2, quiet: 3 };

// ─── Build ──────────────────────────────────────────────────────────────

export function buildProjectDashboard(
  projectRows: DashboardProjectRow[],
  taskRows: DashboardTaskRow[],
  today: string
): ProjectDashboard {
  const live = projectRows.filter((p) => !CLOSED_PROJECT.has(p.status ?? "active"));
  const liveIds = new Set(live.map((p) => p.id));
  const byProject = new Map<string, DashboardTaskRow[]>();
  for (const t of taskRows) {
    if (!liveIds.has(t.project_id)) continue;
    const list = byProject.get(t.project_id);
    if (list) list.push(t);
    else byProject.set(t.project_id, [t]);
  }

  const paceFrom = addDays(today, -PACE_WINDOW_DAYS);
  const next7 = addDays(today, 7);
  const upcomingTo = addDays(today, UPCOMING_DAYS);
  const last30 = addDays(today, -30);

  const projects: PmProject[] = [];
  const upcoming: PmUpcomingTask[] = [];
  const kpis: PmKpis = {
    activeProjects: live.length,
    openTasks: 0,
    overdue: 0,
    dueNext7: 0,
    completedLast30: 0,
    atRisk: 0,
    blocked: 0,
    onTimeRate: null,
    onTimeSample: 0,
  };
  let onTime = 0;

  for (const p of live) {
    const tasks = byProject.get(p.id) ?? [];
    let done = 0;
    let inProgress = 0;
    let todo = 0;
    let overdue = 0;
    let blocked = 0;
    let urgent = 0;
    let completedLast28 = 0;
    let planEnd: string | null = null;
    let start = toDay(p.created_at);
    let lastActivity = toDay(p.updated_at);
    const milestones: PmMilestone[] = [];

    for (const t of tasks) {
      const state = taskState(t.status);
      start = minDay(start, toDay(t.created_at));
      const touched = toDay(t.updated_at) ?? toDay(t.created_at);
      if (touched && (!lastActivity || touched > lastActivity)) lastActivity = touched;
      if (state === "cancelled") continue;

      const due = toDay(t.due_date);
      if (state === "done") {
        done++;
        const finished = toDay(t.completed_at) ?? toDay(t.updated_at);
        if (finished && finished > paceFrom && finished <= today) completedLast28++;
        if (finished && finished > last30 && finished <= today) {
          kpis.completedLast30++;
          if (due) {
            kpis.onTimeSample++;
            if (finished <= due) onTime++;
          }
        }
        continue;
      }

      if (state === "in_progress") inProgress++;
      else todo++;
      kpis.openTasks++;

      const isLate = !!due && due < today;
      const taskBlocked = isBlocked(t);
      if (isLate) overdue++;
      if (taskBlocked) blocked++;
      if (t.priority === "urgent" || t.priority === "high") urgent++;
      if (due && (!planEnd || due > planEnd)) planEnd = due;
      if (due && due >= today && due <= next7) kpis.dueNext7++;

      if (due) {
        const m: PmMilestone = {
          taskId: t.id,
          title: taskTitle(t),
          date: due,
          overdue: isLate,
          priority: t.priority ?? "medium",
        };
        milestones.push(m);
        if (due <= upcomingTo) {
          upcoming.push({
            ...m,
            status: t.status ?? "pending",
            blocked: taskBlocked,
            projectId: p.id,
            projectName: p.name,
            projectSlug: p.slug,
          });
        }
      }
    }

    const open = inProgress + todo;
    const weeklyPace = Math.round((completedLast28 / (PACE_WINDOW_DAYS / 7)) * 10) / 10;
    const forecastEnd = forecastFinish(today, open, weeklyPace);
    // A plan end already in the past still counts: late is late.
    const slipDays = forecastEnd && planEnd ? diffDays(planEnd, forecastEnd) : null;
    const { health, reason } = assessPmHealth({
      open,
      overdue,
      blocked,
      urgent,
      slipDays,
      weeklyPace,
      daysSinceActivity: lastActivity ? diffDays(lastActivity, today) : null,
    });

    milestones.sort((a, b) => a.date.localeCompare(b.date));
    const total = done + open;
    kpis.overdue += overdue;
    kpis.blocked += blocked;
    if (health === "at_risk") kpis.atRisk++;

    projects.push({
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status ?? "active",
      color: p.color,
      pinned: (p.priority ?? 0) > 0,
      total,
      done,
      inProgress,
      todo,
      overdue,
      blocked,
      urgent,
      percentDone: total ? Math.round((done / total) * 100) : 0,
      start,
      planEnd,
      forecastEnd,
      slipDays,
      weeklyPace,
      completedLast28,
      lastActivity,
      health,
      healthReason: reason,
      nextDue: milestones.find((m) => !m.overdue) ?? milestones[0] ?? null,
      milestones: milestones.slice(0, MAX_MILESTONES),
    });
  }

  kpis.onTimeRate = kpis.onTimeSample ? Math.round((onTime / kpis.onTimeSample) * 100) : null;

  // Worst first; inside a health band, pinned, then the soonest deadline.
  projects.sort(
    (a, b) =>
      HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
      Number(b.pinned) - Number(a.pinned) ||
      (a.planEnd ?? "9999").localeCompare(b.planEnd ?? "9999") ||
      a.name.localeCompare(b.name)
  );

  upcoming.sort(
    (a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName)
  );

  // ── History: weekly created vs completed, and a burn-up ──
  const firstWeek = addDays(weekStart(today), -7 * (HISTORY_WEEKS - 1));
  const weekIndex = (day: string) => Math.floor(diffDays(firstWeek, day) / 7);
  const history: PmWeek[] = Array.from({ length: HISTORY_WEEKS }, (_, i) => ({
    weekStart: addDays(firstWeek, i * 7),
    created: 0,
    completed: 0,
    scope: 0,
    doneTotal: 0,
  }));
  let scopeBefore = 0;
  let doneBefore = 0;
  for (const t of taskRows) {
    if (!liveIds.has(t.project_id) || taskState(t.status) === "cancelled") continue;
    const created = toDay(t.created_at);
    if (created && created <= today) {
      const i = weekIndex(created);
      if (i < 0) scopeBefore++;
      else history[i].created++;
    }
    if (taskState(t.status) === "done") {
      const finished = toDay(t.completed_at) ?? toDay(t.updated_at);
      if (finished && finished <= today) {
        const i = weekIndex(finished);
        if (i < 0) doneBefore++;
        else history[i].completed++;
      }
    }
  }
  let scope = scopeBefore;
  let doneTotal = doneBefore;
  for (const w of history) {
    scope += w.created;
    doneTotal += w.completed;
    w.scope = scope;
    w.doneTotal = doneTotal;
  }

  // ── Look-ahead workload: open tasks due per week, per project ──
  const thisWeek = weekStart(today);
  const workloadWeeks = Array.from({ length: LOOKAHEAD_WEEKS }, (_, i) => addDays(thisWeek, i * 7));
  const horizon = addDays(thisWeek, LOOKAHEAD_WEEKS * 7);
  let undated = 0;
  const workload: PmWorkloadRow[] = [];
  for (const p of projects) {
    const counts = new Array<number>(LOOKAHEAD_WEEKS).fill(0);
    for (const t of byProject.get(p.id) ?? []) {
      const state = taskState(t.status);
      if (state === "done" || state === "cancelled") continue;
      const due = toDay(t.due_date);
      if (!due || due >= horizon) {
        undated++;
        continue;
      }
      // Overdue work lands in this week: it is due now.
      const i = Math.max(0, Math.floor(diffDays(thisWeek, due) / 7));
      counts[i]++;
    }
    if (counts.some((c) => c > 0)) {
      workload.push({ projectId: p.id, projectName: p.name, projectSlug: p.slug, counts });
    }
  }

  return {
    today,
    kpis,
    projects,
    upcoming: upcoming.slice(0, MAX_UPCOMING),
    history,
    workloadWeeks,
    workload,
    undated,
  };
}
