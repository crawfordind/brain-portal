/**
 * Which open tasks matter most right now, and why.
 *
 * The Tasks page leads with these as a swipeable deck, the way the stream
 * leads with its "moment". Rules, not a model: the same tasks always rank the
 * same way, and each carries the one reason that put it there.
 *
 * Only tasks with a real signal qualify (late, due today, urgent, started), so
 * a calm list gets no deck at all rather than five arbitrary "focus" cards.
 * Pure; imports nothing.
 */

export interface FocusTaskInput {
  id: string;
  status: string;
  priority: string;
  due_date: string | null;
  delegated_to?: string | null;
  updated_at?: string;
}

export interface FocusPick<T> {
  task: T;
  score: number;
  reason: string;
  tone: "late" | "now" | "accent";
}

/** `YYYY-MM-DD` for a due date: date-only stays as written, a timestamp is read in the viewer's zone. */
export function dueDay(due: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return due.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole calendar days from `a` to `b` (both `YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

export function scoreFocusTask(task: FocusTaskInput, today: string): Omit<FocusPick<FocusTaskInput>, "task"> | null {
  if (task.status === "completed" || task.status === "cancelled") return null;
  // Work handed to an agent is the agent's to do; it surfaces in Review.
  if (task.delegated_to) return null;

  let score = 0;
  let reason = "";
  let tone: FocusPick<FocusTaskInput>["tone"] = "accent";

  if (task.due_date) {
    const late = daysBetween(dueDay(task.due_date), today);
    if (late > 0) {
      score += 60 + Math.min(late, 14) * 2;
      reason = late === 1 ? "Overdue since yesterday" : `Overdue ${late} days`;
      tone = "late";
    } else if (late === 0) {
      score += 50;
      reason = "Due today";
      tone = "now";
    } else if (late === -1) {
      score += 20;
      reason = "Due tomorrow";
    }
  }

  if (task.priority === "urgent") {
    score += 35;
    reason ||= "Urgent";
    if (tone === "accent") tone = "late";
  } else if (task.priority === "high") {
    score += 18;
    reason ||= "High priority";
  }

  if (task.status === "in_progress") {
    score += 15;
    reason ||= "In progress";
  }

  // "Due tomorrow" alone is a heads-up, not a focus item.
  if (score < 30) return null;
  return { score, reason, tone };
}

export function rankFocusTasks<T extends FocusTaskInput>(tasks: T[], today: string, limit = 5): FocusPick<T>[] {
  const picks: FocusPick<T>[] = [];
  for (const task of tasks) {
    const s = scoreFocusTask(task, today);
    if (s) picks.push({ task, ...s });
  }
  picks.sort((a, b) => b.score - a.score || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999") || a.task.id.localeCompare(b.task.id));
  return picks.slice(0, limit);
}
