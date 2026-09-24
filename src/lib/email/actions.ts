/**
 * What happens when someone taps a button in an email.
 *
 * Every action here is written to be safe to repeat, because the link that
 * triggers it can be followed more than once — a double tap, a refresh, a mail
 * provider's link scanner, a forwarded email — and there is no table recording
 * which tokens were used:
 *
 * - Complete is conditional on the task not already being complete, so a
 *   recurring task cannot spawn two next occurrences.
 * - Extend carries the absolute target date computed when the email was sent,
 *   so a second click lands on the same date instead of adding another day.
 * - Snooze is relative to the click, so a replay just re-sets the same window.
 * - Unsubscribe sets a flag to false.
 *
 * Every write is scoped to the user named in the signed token.
 */

import { db, queryOne } from "@/lib/db/client";
import type { Reminder, Task } from "@/lib/db/schema";
import { completeTask } from "@/lib/tasks/complete";
import { absoluteUrl } from "@/lib/app-url";
import {
  createEmailActionToken,
  UNDO_TOKEN_TTL_SECONDS,
  UNSUBSCRIBE_CATEGORIES,
  type EmailActionPayload,
  type UnsubscribeCategory,
} from "./action-tokens";
import { taskUrl } from "./links";
import {
  extendDueDate,
  formatDueLabel,
  isDateOnly,
  safeTimeZone,
  todayInTimeZone,
  tomorrowMorning,
  toSqliteDateTime,
} from "./when";

export interface ActionPreview {
  /** Question shown on the confirmation page, e.g. "Mark this task done?" */
  question: string;
  /** The thing being acted on, e.g. the task title. */
  subject: string | null;
  confirmLabel: string;
}

export interface ActionOutcome {
  ok: boolean;
  headline: string;
  detail?: string;
  subject?: string | null;
  openUrl?: string;
  openLabel?: string;
  undo?: { label: string; token: string };
}

const UNSUBSCRIBE_COLUMNS: Record<UnsubscribeCategory, { column: string; label: string }> = {
  reminders: { column: "email_reminders", label: "reminder emails" },
  tasks: { column: "email_overdue_tasks", label: "overdue and due-soon task emails" },
  daily_digest: { column: "email_daily_digest", label: "the daily digest" },
  weekly_report: { column: "email_weekly_report", label: "the weekly report" },
  agent_updates: { column: "email_agent_updates", label: "AI agent and system emails" },
  all: { column: "email_enabled", label: "all Brain Portal notification emails" },
};

function taskTitle(task: Pick<Task, "title" | "content">): string {
  return (task.title || task.content || "Untitled task").split("\n")[0].slice(0, 140);
}

function unsubscribeCategory(payload: EmailActionPayload): UnsubscribeCategory | null {
  const c = payload.p?.c;
  return typeof c === "string" && (UNSUBSCRIBE_CATEGORIES as readonly string[]).includes(c)
    ? (c as UnsubscribeCategory)
    : null;
}

async function getUserTimeZone(userId: string): Promise<string> {
  const row = await queryOne<{ timezone: string | null }>(
    "SELECT timezone FROM notification_preferences WHERE user_id = ?",
    [userId]
  );
  return safeTimeZone(row?.timezone);
}

function undoToken(payload: Omit<EmailActionPayload, "exp">): string | null {
  return createEmailActionToken(payload, UNDO_TOKEN_TTL_SECONDS);
}

function withUndo(outcome: ActionOutcome, label: string, token: string | null): ActionOutcome {
  return token ? { ...outcome, undo: { label, token } } : outcome;
}

// ─── Preview (GET: nothing is changed) ─────────────────

export async function previewEmailAction(payload: EmailActionPayload): Promise<ActionPreview | null> {
  const { u: userId, a: action, id } = payload;

  if (action === "unsubscribe") {
    const category = unsubscribeCategory(payload);
    if (!category) return null;
    return {
      question: `Stop sending ${UNSUBSCRIBE_COLUMNS[category].label}?`,
      subject: null,
      confirmLabel: "Unsubscribe",
    };
  }

  if (!id) return null;

  if (action.startsWith("task_")) {
    const task = await queryOne<Task>("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [id, userId]);
    if (!task) return null;
    const subject = taskTitle(task);
    switch (action) {
      case "task_complete":
        return { question: "Mark this task done?", subject, confirmLabel: "Mark done" };
      case "task_extend": {
        const tz = await getUserTimeZone(userId);
        const target = resolveExtendTarget(task, payload, tz);
        return { question: `Move the due date to ${formatDueLabel(target, tz)}?`, subject, confirmLabel: "Move it" };
      }
      case "task_reopen":
        return { question: "Reopen this task?", subject, confirmLabel: "Reopen" };
      case "task_set_due":
        return { question: "Put the due date back?", subject, confirmLabel: "Undo" };
    }
  }

  if (action.startsWith("reminder_")) {
    const reminder = await queryOne<Reminder>("SELECT * FROM reminders WHERE id = ? AND user_id = ?", [id, userId]);
    if (!reminder) return null;
    const subject = reminder.title;
    switch (action) {
      case "reminder_dismiss":
        return { question: "Mark this reminder done?", subject, confirmLabel: "Done" };
      case "reminder_snooze":
        return {
          question: payload.p?.until === "tomorrow" ? "Snooze until tomorrow morning?" : "Snooze this reminder?",
          subject,
          confirmLabel: "Snooze",
        };
      case "reminder_reopen":
        return { question: "Bring this reminder back?", subject, confirmLabel: "Undo" };
    }
  }

  return null;
}

// ─── Execute (POST) ─────────────────────────────────────

/**
 * The date an extend link should land on. Normally the one signed into the
 * link; if that is already in the past (an old email), push from today instead
 * so the task is never "extended" to a date that is still overdue.
 */
function resolveExtendTarget(task: Pick<Task, "due_date">, payload: EmailActionPayload, tz: string): string {
  const days = Math.min(Math.max(Number(payload.p?.days) || 1, 1), 365);
  const signed = typeof payload.p?.due === "string" ? payload.p.due : null;
  const now = new Date();
  if (signed) {
    const stillAhead = isDateOnly(signed)
      ? signed > todayInTimeZone(now, tz)
      : new Date(signed).getTime() > now.getTime();
    if (stillAhead) return signed;
  }
  return extendDueDate(task.due_date, days, now, tz);
}

export async function executeEmailAction(payload: EmailActionPayload): Promise<ActionOutcome> {
  const { u: userId, a: action, id } = payload;

  if (action === "unsubscribe") {
    const category = unsubscribeCategory(payload);
    if (!category) return { ok: false, headline: "This link isn't valid." };
    const { column, label } = UNSUBSCRIBE_COLUMNS[category];
    await db.execute({
      sql: "INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)",
      args: [userId],
    });
    // `column` comes from the fixed map above, never from the token.
    await db.execute({
      sql: `UPDATE notification_preferences SET ${column} = 0, updated_at = datetime('now') WHERE user_id = ?`,
      args: [userId],
    });
    return {
      ok: true,
      headline: "You're unsubscribed.",
      detail: `You won't get ${label} anymore. You can turn them back on in Settings.`,
      openUrl: absoluteUrl("/settings#notifications"),
      openLabel: "Notification settings",
    };
  }

  if (!id) return { ok: false, headline: "This link isn't valid." };

  if (action.startsWith("task_")) return executeTaskAction(userId, id, payload);
  if (action.startsWith("reminder_")) return executeReminderAction(userId, id, payload);

  return { ok: false, headline: "This link isn't valid." };
}

async function executeTaskAction(userId: string, id: string, payload: EmailActionPayload): Promise<ActionOutcome> {
  const task = await queryOne<Task>("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [id, userId]);
  if (!task) {
    return { ok: false, headline: "That task no longer exists.", detail: "It may have been deleted.", openUrl: absoluteUrl("/tasks"), openLabel: "Open tasks" };
  }
  const subject = taskTitle(task);
  const openUrl = taskUrl(id);
  const base = { subject, openUrl, openLabel: "Open task" };

  switch (payload.a) {
    case "task_complete": {
      const result = await completeTask(userId, id);
      if (result.status === "not_found") return { ok: false, headline: "That task no longer exists." };
      if (result.status === "already_completed") {
        return { ok: true, headline: "Already done.", detail: "This task was already marked complete.", ...base };
      }
      const detail = task.recurrence_rule ? "Nice work. The next occurrence has been scheduled." : "Nice work.";
      return withUndo(
        { ok: true, headline: "Marked done.", detail, ...base },
        "Undo",
        undoToken({ u: userId, a: "task_reopen", id, p: { status: result.previousStatus } })
      );
    }

    case "task_extend": {
      if (task.status === "completed" || task.status === "cancelled") {
        return { ok: true, headline: "Nothing to move.", detail: `This task is already ${task.status}.`, ...base };
      }
      const tz = await getUserTimeZone(userId);
      const target = resolveExtendTarget(task, payload, tz);
      if (task.due_date === target) {
        return { ok: true, headline: `Due ${formatDueLabel(target, tz)}.`, detail: "The due date was already moved.", ...base };
      }
      await db.execute({
        sql: "UPDATE tasks SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        args: [target, id, userId],
      });
      return withUndo(
        { ok: true, headline: `Moved to ${formatDueLabel(target, tz)}.`, ...base },
        "Undo",
        undoToken({ u: userId, a: "task_set_due", id, p: { due: task.due_date } })
      );
    }

    case "task_reopen": {
      const previous = payload.p?.status === "in_progress" ? "in_progress" : "pending";
      if (task.status === "completed") {
        await db.execute({
          sql: `UPDATE tasks SET status = ?, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ? AND status = 'completed'`,
          args: [previous, id, userId],
        });
        // Completing a recurring task spawned its next occurrence. Undoing the
        // completion should not leave that duplicate behind.
        if (task.recurrence_rule) {
          await db.execute({
            sql: `DELETE FROM tasks WHERE parent_task_id = ? AND user_id = ? AND status = 'pending'
                    AND created_at > datetime('now', '-1 day')`,
            args: [id, userId],
          });
        }
      }
      return { ok: true, headline: "Reopened.", detail: "The task is back on your list.", ...base };
    }

    case "task_set_due": {
      const due = typeof payload.p?.due === "string" ? payload.p.due : null;
      await db.execute({
        sql: "UPDATE tasks SET due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        args: [due, id, userId],
      });
      const tz = await getUserTimeZone(userId);
      return { ok: true, headline: "Due date restored.", detail: due ? `Due ${formatDueLabel(due, tz)}.` : "No due date.", ...base };
    }
  }

  return { ok: false, headline: "This link isn't valid." };
}

async function executeReminderAction(userId: string, id: string, payload: EmailActionPayload): Promise<ActionOutcome> {
  const reminder = await queryOne<Reminder>("SELECT * FROM reminders WHERE id = ? AND user_id = ?", [id, userId]);
  if (!reminder) {
    return { ok: false, headline: "That reminder no longer exists.", detail: "It may have been deleted.", openUrl: absoluteUrl("/"), openLabel: "Open Brain Portal" };
  }
  const base = { subject: reminder.title, openUrl: absoluteUrl("/"), openLabel: "Open Brain Portal" };

  switch (payload.a) {
    case "reminder_dismiss": {
      if (reminder.status === "dismissed") {
        return { ok: true, headline: "Already done.", ...base };
      }
      await db.execute({
        sql: `UPDATE reminders SET status = 'dismissed', dismissed_at = datetime('now'), snoozed_until = NULL,
                updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });
      return withUndo(
        { ok: true, headline: "Marked done.", ...base },
        "Undo",
        undoToken({ u: userId, a: "reminder_reopen", id })
      );
    }

    case "reminder_snooze": {
      const tz = await getUserTimeZone(userId);
      const now = new Date();
      let until: Date;
      if (payload.p?.until === "tomorrow") {
        until = tomorrowMorning(now, tz);
      } else {
        const minutes = Math.min(Math.max(Number(payload.p?.minutes) || 60, 5), 7 * 24 * 60);
        until = new Date(now.getTime() + minutes * 60_000);
      }
      await db.execute({
        sql: `UPDATE reminders SET status = 'snoozed', snoozed_until = ?, dismissed_at = NULL,
                updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        args: [toSqliteDateTime(until), id, userId],
      });
      const when = until.toLocaleString("en-US", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      });
      return { ok: true, headline: `Snoozed until ${when}.`, detail: "We'll remind you again then.", ...base };
    }

    case "reminder_reopen": {
      await db.execute({
        sql: `UPDATE reminders SET status = 'triggered', dismissed_at = NULL, snoozed_until = NULL,
                updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
        args: [id, userId],
      });
      return { ok: true, headline: "Reminder restored.", ...base };
    }
  }

  return { ok: false, headline: "This link isn't valid." };
}
