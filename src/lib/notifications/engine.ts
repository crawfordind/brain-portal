/**
 * Notification Engine - The brain of the notification system
 *
 * Scans for events that need attention:
 * - Reminders that have reached their remind_at time
 * - Tasks that are overdue or due soon
 * - AI agent tasks that completed or failed
 * - Projects that have gone stale
 * - Streaks and milestones
 *
 * Generates notifications + sends emails based on user preferences.
 * Designed to run via cron endpoint (e.g., every 5-15 minutes).
 */

import { db, queryAll, queryOne } from "@/lib/db/client";
import type {
  Notification,
  NotificationPreferences,
  NotificationType,
} from "@/lib/db/schema";
import { sendNotificationEmail } from "./emails";
import { dueSoonClause, overdueClause } from "./due-queries";
import { reminderQuickActions, taskQuickActions, type EmailActionLink } from "@/lib/email/links";
import { formatDueLabel, hourInTimeZone, isDateOnly, safeTimeZone, todayInTimeZone } from "@/lib/email/when";
import { getSystemHealth } from "@/lib/system-health";
import { diagnoseError } from "@/lib/system-health/diagnose";

// ─── Types ───────────────────────────────────────────

interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  priority?: "low" | "medium" | "high" | "urgent";
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

interface ScanResult {
  notificationsCreated: number;
  emailsSent: number;
  errors: string[];
}

// ─── Type-Aware Deduplication Windows ──────────────

/**
 * Returns the SQLite datetime offset for deduplication per notification type.
 *
 * One-time events (reminders, agent completions) use a short 1-hour window
 * since the underlying state changes after triggering.
 *
 * Persistent conditions (overdue tasks, stalled projects) use longer windows
 * to avoid repeatedly notifying about the same unchanged state.
 */
function getDeduplicationWindow(type: NotificationType): string {
  switch (type) {
    case "task_overdue":
      return "-24 hours"; // Overdue state persists — remind at most daily
    case "task_due_soon":
      return "-12 hours"; // Approaching deadline — at most twice per day
    case "project_stalled":
      return "-7 days"; // Stalled state persists — weekly nudge at most
    case "streak_milestone":
      return "-7 days"; // Same milestone — celebrate once per week
    case "insight_generated":
      return "-4 hours"; // Same insight — no need to repeat often
    // Agent outcomes are per-task, so a wide window can't cause repeats for the
    // same task — it only stops a second notification if the task is touched
    // again. The width is what lets a failure that happened while the user was
    // away still be scanned into existence when they come back.
    case "agent_complete":
    case "agent_failed":
      return "-12 hours";
    // A broken background system stays broken. Nag at most every 6 hours rather
    // than on every 5-minute scan.
    case "system":
      return "-6 hours";
    // One-time events where the source state changes after triggering:
    case "reminder_due": // Reminder status → 'triggered'
    default:
      return "-1 hour"; // Safety dedup for transient events
  }
}

/**
 * Returns the email-specific cooldown window per notification type.
 * This is a second layer of protection against email spam, checked
 * independently of notification deduplication before sending any email.
 */
function getEmailCooldownWindow(type: NotificationType): string {
  switch (type) {
    case "task_overdue":
      return "-24 hours"; // One overdue email per task per day
    case "task_due_soon":
      return "-12 hours"; // One due-soon email per task per 12h
    case "project_stalled":
      return "-7 days"; // One stalled-project email per week
    case "streak_milestone":
      return "-7 days"; // One milestone email per week
    case "insight_generated":
      return "-4 hours";
    case "system":
      return "-6 hours";
    default:
      return "-1 hour";
  }
}

// ─── Core: Create Notification ──────────────────────

export async function createNotification(
  input: NotificationInput
): Promise<string | null> {
  try {
    // Deduplicate: don't create same notification within type-specific window
    if (input.entityType && input.entityId) {
      const dedupWindow = getDeduplicationWindow(input.type);
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM notifications
         WHERE user_id = ? AND type = ? AND entity_type = ? AND entity_id = ?
           AND created_at > datetime('now', ?)
         LIMIT 1`,
        [input.userId, input.type, input.entityType, input.entityId, dedupWindow]
      );
      if (existing) return null;
    }

    // RETURNING, not "the newest row for this user": two notifications
    // created in the same second made that lookup return the wrong id, and the
    // wrong row then got marked as emailed.
    const inserted = await db.execute({
      sql: `INSERT INTO notifications (user_id, type, title, body, priority, entity_type, entity_id, action_url, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        input.userId,
        input.type,
        input.title,
        input.body,
        input.priority || "medium",
        input.entityType || null,
        input.entityId || null,
        input.actionUrl || null,
        JSON.stringify(input.metadata || {}),
      ],
    });

    const id = inserted.rows[0]?.id;
    return typeof id === "string" ? id : id != null ? String(id) : null;
  } catch (error) {
    console.error("[NOTIF] Failed to create notification:", error);
    return null;
  }
}

// ─── Get User Preferences (with defaults) ───────────

export async function getNotificationPreferences(
  userId: string
): Promise<NotificationPreferences> {
  const prefs = await queryOne<NotificationPreferences>(
    "SELECT * FROM notification_preferences WHERE user_id = ?",
    [userId]
  );

  if (prefs) return prefs;

  // Create default preferences
  await db.execute({
    sql: "INSERT OR IGNORE INTO notification_preferences (user_id) VALUES (?)",
    args: [userId],
  });

  return (
    (await queryOne<NotificationPreferences>(
      "SELECT * FROM notification_preferences WHERE user_id = ?",
      [userId]
    )) || ({
      user_id: userId,
      email_enabled: true,
      email_reminders: true,
      email_overdue_tasks: true,
      email_daily_digest: true,
      email_weekly_report: true,
      email_agent_updates: true,
      daily_digest_hour: 8,
      weekly_report_day: 1,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      timezone: "UTC",
      overdue_reminder_hours: 2,
      due_soon_hours: 24,
      ai_digest_enabled: true,
      ai_weekly_enabled: true,
    } as NotificationPreferences)
  );
}

// ─── Check Quiet Hours ──────────────────────────────

export function isQuietHours(prefs: NotificationPreferences, now: Date = new Date()): boolean {
  // Quiet hours are the user's own night, not UTC's.
  const hour = hourInTimeZone(now, safeTimeZone(prefs.timezone));
  const { quiet_hours_start, quiet_hours_end } = prefs;
  if (quiet_hours_start == null || quiet_hours_end == null || quiet_hours_start === quiet_hours_end) {
    return false;
  }

  if (quiet_hours_start > quiet_hours_end) {
    // Wraps midnight (e.g., 22-7)
    return hour >= quiet_hours_start || hour < quiet_hours_end;
  }
  return hour >= quiet_hours_start && hour < quiet_hours_end;
}

// ─── Scan: Triggered Reminders ──────────────────────

async function scanReminders(userId: string): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];

  // Atomically claim due reminders by marking them triggered FIRST.
  // This prevents concurrent scans from picking up the same reminders.
  // The WHERE status = 'pending' ensures only one scan can claim each reminder.
  await db.execute({
    // A snoozed reminder has status 'snoozed', so matching only 'pending'
    // meant snoozing anything silenced it for good. datetime() normalises ISO
    // timestamps ("…T…Z"), which compare wrongly against datetime('now') as text.
    sql: `UPDATE reminders SET status = 'triggered', triggered_at = datetime('now'), updated_at = datetime('now')
          WHERE user_id = ?
            AND (
              (status = 'pending' AND datetime(remind_at) <= datetime('now')
                AND (snoozed_until IS NULL OR datetime(snoozed_until) <= datetime('now')))
              OR (status = 'snoozed' AND snoozed_until IS NOT NULL
                AND datetime(snoozed_until) <= datetime('now'))
            )`,
    args: [userId],
  });

  // Fetch the reminders we just claimed (triggered within the last minute)
  const dueReminders = await queryAll<{
    id: string;
    title: string;
    content: string | null;
    priority: string;
    remind_at: string;
    project_id: string | null;
  }>(
    `SELECT id, title, content, priority, remind_at, project_id FROM reminders
     WHERE user_id = ? AND status = 'triggered'
       AND triggered_at > datetime('now', '-1 minute')`,
    [userId]
  );

  for (const reminder of dueReminders) {
    notifications.push({
      userId,
      type: "reminder_due",
      title: `Reminder: ${reminder.title}`,
      body: reminder.content || reminder.title,
      priority: reminder.priority as NotificationInput["priority"],
      entityType: "reminder",
      entityId: reminder.id,
      // Reminders live in the stream, not the task list.
      actionUrl: "/",
      metadata: { remind_at: reminder.remind_at },
    });
  }

  return notifications;
}

// ─── Scan: Overdue & Due-Soon Tasks ─────────────────

async function scanTasks(
  userId: string,
  prefs: NotificationPreferences
): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];
  const tz = safeTimeZone(prefs.timezone);
  const overdue = overdueClause(tz);
  const dueSoon = dueSoonClause(tz, prefs.due_soon_hours);

  // Overdue tasks (past due_date, not completed)
  const overdueTasks = await queryAll<{
    id: string;
    title: string | null;
    content: string;
    due_date: string;
    priority: string;
    project_id: string | null;
  }>(
    `SELECT id, title, content, due_date, priority, project_id FROM tasks
     WHERE user_id = ? AND status IN ('pending', 'in_progress')
       AND ${overdue.sql}`,
    [userId, ...overdue.args]
  );

  for (const task of overdueTasks) {
    const hoursOverdue = hoursSinceDue(task.due_date, tz);
    notifications.push({
      userId,
      type: "task_overdue",
      title: `Overdue: ${taskLabel(task)}`,
      body: `Was due ${formatDueLabel(task.due_date, tz)} (${describeOverdue(hoursOverdue)}).`,
      priority: hoursOverdue > 48 ? "urgent" : "high",
      entityType: "task",
      entityId: task.id,
      actionUrl: taskPath(task.id),
      metadata: { due_date: task.due_date, hours_overdue: hoursOverdue },
    });
  }

  // Due soon tasks (within due_soon_hours threshold)
  const dueSoonTasks = await queryAll<{
    id: string;
    title: string | null;
    content: string;
    due_date: string;
    priority: string;
  }>(
    `SELECT id, title, content, due_date, priority FROM tasks
     WHERE user_id = ? AND status IN ('pending', 'in_progress')
       AND ${dueSoon.sql}`,
    [userId, ...dueSoon.args]
  );

  for (const task of dueSoonTasks) {
    const dueToday = isDateOnly(task.due_date) && task.due_date.trim() === todayInTimeZone(new Date(), tz);
    const hoursUntil = isDateOnly(task.due_date)
      ? null
      : Math.max(0, Math.round((new Date(task.due_date).getTime() - Date.now()) / 3_600_000));
    notifications.push({
      userId,
      type: "task_due_soon",
      title: `${dueToday ? "Due today" : "Due soon"}: ${taskLabel(task)}`,
      body:
        hoursUntil === null
          ? `Due ${dueToday ? "today" : formatDueLabel(task.due_date, tz)}.`
          : `Due ${formatDueLabel(task.due_date, tz)} (in about ${hoursUntil}h).`,
      priority: dueToday || (hoursUntil !== null && hoursUntil <= 4) ? "high" : "medium",
      entityType: "task",
      entityId: task.id,
      actionUrl: taskPath(task.id),
      metadata: { due_date: task.due_date, hours_until: hoursUntil },
    });
  }

  return notifications;
}

// ─── Scan: Agent Task Updates ───────────────────────

async function scanAgentTasks(
  userId: string
): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];

  // Recently completed agent tasks (awaiting review)
  const completedTasks = await queryAll<{
    id: string;
    title: string;
    assigned_agent: string;
    task_id: string | null;
  }>(
    `SELECT id, title, assigned_agent, task_id FROM agent_tasks
     WHERE user_id = ? AND status = 'awaiting_review'
       AND updated_at > datetime('now', '-12 hours')`,
    [userId]
  );

  for (const task of completedTasks) {
    notifications.push({
      userId,
      type: "agent_complete",
      title: `AI ${task.assigned_agent} finished: ${task.title}`,
      body: `Your ${task.assigned_agent} agent completed "${task.title}" and is ready for review.`,
      priority: "medium",
      entityType: "agent_task",
      entityId: task.id,
      actionUrl: "/review",
      metadata: { agent: task.assigned_agent, task_id: task.task_id },
    });
  }

  // Failed agent tasks
  const failedTasks = await queryAll<{
    id: string;
    title: string;
    assigned_agent: string;
    last_error: string | null;
  }>(
    `SELECT id, title, assigned_agent, last_error FROM agent_tasks
     WHERE user_id = ? AND status = 'failed'
       AND updated_at > datetime('now', '-12 hours')`,
    [userId]
  );

  for (const task of failedTasks) {
    // The raw provider error ("401 No auth credentials found") tells the user
    // nothing. Translate it, and keep the code so they can quote it to an admin.
    const diagnosis = diagnoseError(task.last_error);
    notifications.push({
      userId,
      type: "agent_failed",
      title: `AI ${task.assigned_agent} couldn't finish "${task.title}"`,
      body: `${diagnosis.title}. ${diagnosis.explanation}`,
      priority: "high",
      entityType: "agent_task",
      entityId: task.id,
      actionUrl: "/review",
      metadata: {
        agent: task.assigned_agent,
        diagnosis_code: diagnosis.code,
        admin_hint: diagnosis.adminHint,
      },
    });
  }

  return notifications;
}

// ─── Scan: Background System Health ─────────────────

/**
 * Notifies about background work that never ran at all.
 *
 * Every other scanner keys off a row that recorded a failure. The worst class of
 * problem produces no such row: a missing API key, a cron that is rejected, an
 * agent that was never seeded. The work just queues forever and the user sees
 * silence. `getSystemHealth` detects those states directly, and this turns the
 * blocking ones into a notification with a reason attached.
 *
 * Only issues the user cannot see anywhere else are emitted here — per-task
 * failures are already covered by `scanAgentTasks`, and re-reporting them would
 * double up.
 */
async function scanBackgroundHealth(
  userId: string
): Promise<NotificationInput[]> {
  let health;
  try {
    health = await getSystemHealth(userId);
  } catch (error) {
    console.error("[Notifications] system health scan failed:", error);
    return [];
  }

  return health.issues
    .filter(
      (issue) =>
        issue.diagnosis.severity === "error" &&
        (issue.kind === "configuration" ||
          issue.diagnosis.code === "WORKER_NOT_RUNNING")
    )
    .map((issue) => ({
      userId,
      type: "system" as NotificationType,
      title: issue.diagnosis.title,
      body: `${issue.diagnosis.explanation} What to tell your administrator: ${issue.diagnosis.adminHint}`,
      priority: "urgent" as const,
      // Deliberately not the issue signature — that carries a timestamp, which
      // would defeat deduplication and re-notify on every scan.
      entityType: "system_health",
      entityId: `${issue.kind}:${issue.diagnosis.code}`,
      metadata: {
        diagnosis_code: issue.diagnosis.code,
        subsystem: issue.subsystem,
        affected: issue.subject,
        admin_hint: issue.diagnosis.adminHint,
      },
    }));
}

// ─── Scan: Stalled Projects ─────────────────────────

async function scanStalledProjects(
  userId: string
): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];

  // Projects with no activity in 7+ days
  const stalledProjects = await queryAll<{
    id: string;
    name: string;
    updated_at: string;
  }>(
    `SELECT id, name, updated_at FROM projects
     WHERE user_id = ? AND status = 'active'
       AND updated_at < datetime('now', '-7 days')`,
    [userId]
  );

  for (const project of stalledProjects) {
    const daysSinceUpdate = Math.round(
      (Date.now() - new Date(project.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    notifications.push({
      userId,
      type: "project_stalled",
      title: `${project.name} needs attention`,
      body: `No activity in ${daysSinceUpdate} days. Consider updating or archiving this project.`,
      priority: "low",
      entityType: "project",
      entityId: project.id,
      actionUrl: `/projects/${project.id}`,
      metadata: { days_stalled: daysSinceUpdate },
    });
  }

  return notifications;
}

// ─── Scan: Streak Milestones ────────────────────────

async function scanStreaks(userId: string): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];

  // Check daily note streak
  const recentDailyNotes = await queryAll<{ date: string }>(
    `SELECT DISTINCT date FROM daily_notes
     WHERE user_id = ? AND date >= date('now', '-30 days')
     ORDER BY date DESC`,
    [userId]
  );

  if (recentDailyNotes.length > 0) {
    let streak = 0;
    const today = new Date().toISOString().split("T")[0];
    const dates = recentDailyNotes.map((d) => d.date);

    // Count consecutive days from today/yesterday
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(Date.now() - i * 86400000)
        .toISOString()
        .split("T")[0];
      if (dates.includes(checkDate)) {
        streak++;
      } else if (i > 0) {
        break; // Allow today to not exist yet
      }
    }

    // Milestone notifications at 3, 7, 14, 21, 30 days
    const milestones = [3, 7, 14, 21, 30];
    if (milestones.includes(streak)) {
      notifications.push({
        userId,
        type: "streak_milestone",
        title: `${streak}-day streak!`,
        body: `You've written daily notes for ${streak} consecutive days. Keep the momentum going!`,
        priority: "low",
        entityType: "streak",
        entityId: `daily_${streak}`,
        actionUrl: "/",
        metadata: { streak_length: streak, streak_type: "daily_note" },
      });
    }
  }

  return notifications;
}

// ─── Scan: Recent Insights ─────────────────────────

async function scanInsights(userId: string): Promise<NotificationInput[]> {
  const notifications: NotificationInput[] = [];

  // Find insights generated in the last 30 minutes that haven't been notified
  const recentInsights = await queryAll<{
    id: string;
    title: string;
    content: string;
    insight_type: string;
    note_id: string | null;
  }>(
    `SELECT id, title, content, insight_type, note_id FROM insights
     WHERE user_id = ? AND is_dismissed = 0 AND generated_at > datetime('now', '-30 minutes')`,
    [userId]
  );

  for (const insight of recentInsights) {
    const preview = insight.content.length > 120
      ? insight.content.slice(0, 120) + "..."
      : insight.content;
    notifications.push({
      userId,
      type: "insight_generated",
      title: insight.title || `New ${insight.insight_type} insight`,
      body: preview,
      priority: "low",
      entityType: "insight",
      entityId: insight.id,
      actionUrl: insight.note_id ? `/notes/${insight.note_id}` : "/",
      metadata: { insight_type: insight.insight_type },
    });
  }

  return notifications;
}

// ─── Main: Run Full Notification Scan ───────────────

export async function runNotificationScan(userId: string): Promise<ScanResult> {
  const result: ScanResult = {
    notificationsCreated: 0,
    emailsSent: 0,
    errors: [],
  };

  try {
    const prefs = await getNotificationPreferences(userId);
    const quiet = isQuietHours(prefs);

    // Gather all pending notifications from all scanners
    const allNotifications: NotificationInput[] = [];

    const [
      reminders,
      tasks,
      agentTasks,
      stalledProjects,
      streaks,
      insights,
      backgroundHealth,
    ] = await Promise.all([
      scanReminders(userId),
      scanTasks(userId, prefs),
      scanAgentTasks(userId),
      scanStalledProjects(userId),
      scanStreaks(userId),
      scanInsights(userId),
      scanBackgroundHealth(userId),
    ]);

    allNotifications.push(
      ...reminders,
      ...tasks,
      ...agentTasks,
      ...stalledProjects,
      ...streaks,
      ...insights,
      ...backgroundHealth
    );

    // Create notifications + send emails
    for (const notif of allNotifications) {
      const notifId = await createNotification(notif);
      if (!notifId) continue; // Deduplicated

      result.notificationsCreated++;

      // Send email if appropriate
      if (prefs.email_enabled && !quiet && shouldEmail(notif.type, prefs)) {
        try {
          // Email cooldown: skip if we already emailed about this entity recently
          if (notif.entityType && notif.entityId) {
            const cooldown = getEmailCooldownWindow(notif.type);
            const recentEmail = await queryOne<{ id: string }>(
              `SELECT id FROM notifications
               WHERE user_id = ? AND type = ? AND entity_type = ? AND entity_id = ?
                 AND is_emailed = 1
                 AND created_at > datetime('now', ?)
               LIMIT 1`,
              [notif.userId, notif.type, notif.entityType, notif.entityId, cooldown]
            );
            if (recentEmail) continue; // Already emailed about this recently
          }

          const user = await queryOne<{ email: string; display_name: string | null }>(
            "SELECT email, display_name FROM users WHERE id = ?",
            [userId]
          );
          if (user) {
            const sent = await sendNotificationEmail({
              to: user.email,
              userId,
              userName: user.display_name || "there",
              notification: notif,
              actions: quickActionsFor(notif, prefs),
            });
            if (sent) {
              result.emailsSent++;
              await db.execute({
                sql: "UPDATE notifications SET is_emailed = 1 WHERE id = ?",
                args: [notifId],
              });
            }
          }
        } catch (err) {
          result.errors.push(
            `Email failed for ${notif.type}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // Update last check timestamp
    await db.execute({
      sql: `UPDATE notification_preferences
            SET last_notification_check = datetime('now'), updated_at = datetime('now')
            WHERE user_id = ?`,
      args: [userId],
    });
  } catch (error) {
    result.errors.push(
      `Scan failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

// ─── Helpers: task wording, links and quick actions ─

function taskLabel(task: { title: string | null; content: string }): string {
  return (task.title || task.content || "Untitled task").split("\n")[0].slice(0, 140);
}

function taskPath(taskId: string): string {
  return `/tasks?task=${encodeURIComponent(taskId)}`;
}

/** Hours since a task fell due; for a date-only task, whole days since that date. */
function hoursSinceDue(dueDate: string, tz: string): number {
  if (isDateOnly(dueDate)) {
    const today = todayInTimeZone(new Date(), tz);
    const [y1, m1, d1] = dueDate.trim().split("-").map(Number);
    const [y2, m2, d2] = today.split("-").map(Number);
    const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
    return Math.max(0, days) * 24;
  }
  const due = new Date(dueDate.includes("T") ? dueDate : `${dueDate.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(due) ? 0 : Math.max(0, Math.round((Date.now() - due) / 3_600_000));
}

function describeOverdue(hours: number): string {
  if (hours < 24) return hours <= 1 ? "just now" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The one-tap buttons an alert email should carry, if any. */
function quickActionsFor(notif: NotificationInput, prefs: NotificationPreferences): EmailActionLink[] {
  if (!notif.entityId) return [];
  switch (notif.type) {
    case "task_overdue":
    case "task_due_soon":
      return taskQuickActions(
        notif.userId,
        { id: notif.entityId, dueDate: (notif.metadata?.due_date as string | undefined) ?? null },
        safeTimeZone(prefs.timezone)
      );
    case "reminder_due":
      return reminderQuickActions(notif.userId, notif.entityId);
    default:
      return [];
  }
}

// ─── Helper: Should this type trigger email? ────────

function shouldEmail(
  type: NotificationType,
  prefs: NotificationPreferences
): boolean {
  switch (type) {
    case "reminder_due":
      return !!prefs.email_reminders;
    case "task_overdue":
    case "task_due_soon":
      return !!prefs.email_overdue_tasks;
    case "daily_digest":
      return !!prefs.email_daily_digest;
    case "weekly_report":
      return !!prefs.email_weekly_report;
    case "agent_complete":
    case "agent_failed":
    // Background-system failures are agent updates by another name — the whole
    // reason to email is that the user may not open the app for hours.
    case "system":
      return !!prefs.email_agent_updates;
    default:
      return false;
  }
}

// ─── Scan All Users ─────────────────────────────────

export async function runNotificationScanAllUsers(): Promise<{
  usersScanned: number;
  totalNotifications: number;
  totalEmails: number;
  errors: string[];
}> {
  const users = await queryAll<{ id: string }>("SELECT id FROM users");
  let totalNotifications = 0;
  let totalEmails = 0;
  const errors: string[] = [];

  for (const user of users) {
    const result = await runNotificationScan(user.id);
    totalNotifications += result.notificationsCreated;
    totalEmails += result.emailsSent;
    errors.push(...result.errors);
  }

  return {
    usersScanned: users.length,
    totalNotifications,
    totalEmails,
    errors,
  };
}
