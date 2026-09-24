/**
 * "Overdue" and "due soon" as SQL, in the user's timezone.
 *
 * The task panel stores due dates as `YYYY-MM-DD`. The scans used to compare
 * that string against `datetime('now')`, and `'2026-09-24' < '2026-09-24
 * 10:00:00'` is true — so a task due *today* was reported overdue from UTC
 * midnight onwards, which for anyone west of Greenwich is the previous
 * evening. A date-only task is overdue once its day has ended *for the user*;
 * a timed one once its instant has passed. `datetime(due_date)` also
 * normalises ISO strings (`…T…Z`), which compare wrongly as raw text.
 */

import { safeTimeZone, todayInTimeZone } from "@/lib/email/when";

export interface DueClause {
  sql: string;
  args: (string | number)[];
}

const DATE_ONLY = "length(trim(due_date)) = 10";

export function overdueClause(timeZone: string, now: Date = new Date()): DueClause {
  const today = todayInTimeZone(now, safeTimeZone(timeZone));
  return {
    sql: `(due_date IS NOT NULL AND due_date != '' AND (
            (${DATE_ONLY} AND due_date < ?) OR
            (NOT ${DATE_ONLY} AND datetime(due_date) < datetime('now'))
          ))`,
    args: [today],
  };
}

export function dueSoonClause(timeZone: string, hours: number, now: Date = new Date()): DueClause {
  const tz = safeTimeZone(timeZone);
  const safeHours = Math.min(Math.max(Math.round(Number(hours) || 24), 1), 24 * 14);
  const today = todayInTimeZone(now, tz);
  const horizon = todayInTimeZone(new Date(now.getTime() + safeHours * 3_600_000), tz);
  return {
    sql: `(due_date IS NOT NULL AND due_date != '' AND (
            (${DATE_ONLY} AND due_date >= ? AND due_date <= ?) OR
            (NOT ${DATE_ONLY} AND datetime(due_date) > datetime('now')
              AND datetime(due_date) <= datetime('now', ?))
          ))`,
    args: [today, horizon, `+${safeHours} hours`],
  };
}
