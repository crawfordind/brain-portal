/**
 * Building the links an email carries: deep links into the app, one-tap quick
 * actions, and the unsubscribe link.
 *
 * Every URL is absolute and resolved through `getAppUrl()`, never through a
 * per-template `process.env` fallback — that fallback is how an overdue-task
 * email ended up linking to localhost.
 */

import { absoluteUrl } from "@/lib/app-url";
import {
  createEmailActionToken,
  UNSUBSCRIBE_TOKEN_TTL_SECONDS,
  type EmailAction,
  type UnsubscribeCategory,
} from "./action-tokens";
import { extendDueDate } from "./when";

export const EMAIL_ACTION_PATH = "/api/email/action";

export interface EmailActionLink {
  label: string;
  url: string;
  /** `primary` renders as the filled button; the rest as outlined. */
  tone: "primary" | "secondary";
}

export function actionUrlForToken(token: string): string {
  return absoluteUrl(`${EMAIL_ACTION_PATH}?token=${encodeURIComponent(token)}`);
}

function link(
  label: string,
  tone: EmailActionLink["tone"],
  input: { u: string; a: EmailAction; id?: string; p?: Record<string, string | number | null> }
): EmailActionLink | null {
  const token = createEmailActionToken(input);
  return token ? { label, tone, url: actionUrlForToken(token) } : null;
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}

/** Deep link that opens one task in the task panel. */
export function taskUrl(taskId: string): string {
  return absoluteUrl(`/tasks?task=${encodeURIComponent(taskId)}`);
}

/**
 * Complete / Tomorrow / Next week.
 *
 * The extended date is computed *now* and signed into the link, so following
 * the link twice (or a mail scanner following it first) lands on the same
 * date instead of pushing the task out a day per click.
 */
export function taskQuickActions(
  userId: string,
  task: { id: string; dueDate?: string | null },
  timeZone: string,
  now: Date = new Date()
): EmailActionLink[] {
  const extend = (days: number) => ({
    days,
    due: extendDueDate(task.dueDate ?? null, days, now, timeZone),
  });
  return compact([
    link("✓ Mark done", "primary", { u: userId, a: "task_complete", id: task.id }),
    link("Tomorrow", "secondary", { u: userId, a: "task_extend", id: task.id, p: extend(1) }),
    link("Next week", "secondary", { u: userId, a: "task_extend", id: task.id, p: extend(7) }),
  ]);
}

/** Done / Snooze 1h / Tomorrow morning. Snoozes are relative to the click. */
export function reminderQuickActions(userId: string, reminderId: string): EmailActionLink[] {
  return compact([
    link("✓ Done", "primary", { u: userId, a: "reminder_dismiss", id: reminderId }),
    link("Snooze 1 hour", "secondary", { u: userId, a: "reminder_snooze", id: reminderId, p: { minutes: 60 } }),
    link("Tomorrow 9am", "secondary", { u: userId, a: "reminder_snooze", id: reminderId, p: { until: "tomorrow" } }),
  ]);
}

export function unsubscribeUrl(userId: string, category: UnsubscribeCategory): string | null {
  const token = createEmailActionToken(
    { u: userId, a: "unsubscribe", p: { c: category } },
    UNSUBSCRIBE_TOKEN_TTL_SECONDS
  );
  return token ? actionUrlForToken(token) : null;
}

export function settingsUrl(): string {
  return absoluteUrl("/settings#notifications");
}
