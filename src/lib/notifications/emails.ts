/**
 * Notification Email Templates
 *
 * Responsive HTML emails for:
 * - Individual alerts (reminders, overdue tasks), with one-tap quick actions
 * - Daily digest (AI-powered summary), with per-task quick actions
 * - Weekly intelligence report (AI-powered deep analysis)
 *
 * Rules every template here follows:
 * - Links are absolute and come from `getAppUrl()` via `src/lib/email/links.ts`.
 *   A per-template `NEXT_PUBLIC_APP_URL || "http://localhost:3000"` is how an
 *   overdue-task email came to link to localhost.
 * - Anything user- or model-authored is escaped (`escapeHtml`).
 * - Every email carries a working unsubscribe link for its own category, plus
 *   `List-Unsubscribe` headers so the mail client's own button works.
 *
 * Uses inline styles for maximum email client compatibility.
 */

import { sendEmail, isEmailConfigured } from "@/lib/email";
import type { NotificationType } from "@/lib/db/schema";
import { absoluteUrl } from "@/lib/app-url";
import { escapeHtml, escapeMultiline, safeHref, truncate } from "@/lib/email/html";
import {
  settingsUrl,
  taskQuickActions,
  taskUrl,
  unsubscribeUrl,
  type EmailActionLink,
} from "@/lib/email/links";
import type { UnsubscribeCategory } from "@/lib/email/action-tokens";
import { formatDueLabel, hourInTimeZone, safeTimeZone } from "@/lib/email/when";

// ─── Types ───────────────────────────────────────────

interface NotificationEmailInput {
  to: string;
  userId: string;
  userName: string;
  notification: {
    type: NotificationType;
    title: string;
    body: string;
    priority?: string;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  };
  /** One-tap buttons, e.g. Mark done / Tomorrow / Next week. */
  actions?: EmailActionLink[];
}

interface DigestTask {
  id: string;
  title: string;
  dueDate: string;
  priority: string;
}

interface DigestEmailInput {
  to: string;
  userId: string;
  userName: string;
  timeZone?: string;
  date: string;
  stats: {
    tasksCompleted: number;
    tasksOverdue: number;
    tasksDueSoon: number;
    notesCreated: number;
    capturesCount: number;
    aiTasksCompleted: number;
    aiTasksAwaitingReview: number;
    activeReminders: number;
  };
  overdueTasks: DigestTask[];
  dueSoonTasks: DigestTask[];
  aiDigest: string | null; // AI-generated summary
  topInsights: { title: string; content: string }[];
  streakInfo: { type: string; length: number } | null;
}

interface WeeklyReportEmailInput {
  to: string;
  userId: string;
  userName: string;
  weekRange: string;
  stats: {
    tasksCompleted: number;
    tasksCreated: number;
    notesWritten: number;
    wordsWritten: number;
    capturesCount: number;
    aiTasksProcessed: number;
    projectsActive: number;
  };
  aiReport: string; // AI-generated weekly intelligence
  topAchievements: string[];
  focusAreas: string[];
  recommendations: string[];
}

/** How many tasks a digest lists per section before "+N more". */
const DIGEST_TASK_LIMIT = 8;

// ─── Unsubscribe plumbing ────────────────────────────

export function unsubscribeCategoryFor(type: NotificationType): UnsubscribeCategory {
  switch (type) {
    case "reminder_due":
      return "reminders";
    case "task_overdue":
    case "task_due_soon":
      return "tasks";
    case "daily_digest":
      return "daily_digest";
    case "weekly_report":
      return "weekly_report";
    default:
      return "agent_updates";
  }
}

const CATEGORY_LABELS: Record<UnsubscribeCategory, string> = {
  reminders: "reminder emails",
  tasks: "task alerts",
  daily_digest: "the daily digest",
  weekly_report: "the weekly report",
  agent_updates: "AI and system alerts",
  all: "all notification emails",
};

interface Footer {
  unsubscribeUrl: string | null;
  category: UnsubscribeCategory;
}

function buildFooter(userId: string, category: UnsubscribeCategory): Footer {
  return { unsubscribeUrl: unsubscribeUrl(userId, category), category };
}

/** RFC 2369 + RFC 8058 headers: the mail client's own one-click unsubscribe. */
function listUnsubscribeHeaders(footer: Footer): Record<string, string> | undefined {
  if (!footer.unsubscribeUrl) return undefined;
  return {
    "List-Unsubscribe": `<${footer.unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function footerText(footer: Footer): string {
  const lines = [`Notification settings: ${settingsUrl()}`];
  if (footer.unsubscribeUrl) {
    lines.push(`Stop ${CATEGORY_LABELS[footer.category]}: ${footer.unsubscribeUrl}`);
  }
  return lines.join("\n");
}

// ─── Base Layout ─────────────────────────────────────

function emailLayout(content: string, footer: Footer, preheader: string = ""): string {
  const unsubscribe = footer.unsubscribeUrl
    ? ` · <a href="${safeHref(footer.unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Stop ${escapeHtml(CATEGORY_LABELS[footer.category])}</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Brain Portal</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f10;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <a href="${safeHref(absoluteUrl("/"))}" style="text-decoration:none;">
                <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:10px 12px;border-radius:12px;margin-bottom:12px;">
                  <span style="color:#fff;font-size:20px;">🧠</span>
                </div>
                <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:8px;">Brain Portal</div>
              </a>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="background-color:#18181b;border-radius:16px;padding:32px 24px;border:1px solid #27272a;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="color:#71717a;font-size:12px;margin:0;line-height:1.6;">
                <a href="${safeHref(settingsUrl())}" style="color:#71717a;text-decoration:underline;">Notification settings</a>${unsubscribe}
              </p>
              <p style="color:#3f3f46;font-size:11px;margin:8px 0 0;">
                Brain Portal — Your AI-powered second brain
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Buttons ─────────────────────────────────────────

function button(url: string, label: string, tone: "primary" | "secondary" = "primary", size: "md" | "sm" = "md"): string {
  const padding = size === "sm" ? "6px 12px" : "12px 20px";
  const fontSize = size === "sm" ? "12px" : "14px";
  const style =
    tone === "primary"
      ? `background:#6366f1;color:#ffffff;border:1px solid #6366f1;`
      : `background:transparent;color:#e4e4e7;border:1px solid #3f3f46;`;
  return `<a href="${safeHref(url)}" style="display:inline-block;${style}text-decoration:none;padding:${padding};border-radius:8px;font-weight:600;font-size:${fontSize};margin:0 6px 8px 0;">${escapeHtml(label)}</a>`;
}

function actionRow(actions: EmailActionLink[]): string {
  if (actions.length === 0) return "";
  return `<div style="margin:0 0 16px;">${actions.map((a) => button(a.url, a.label, a.tone)).join("")}</div>`;
}

// ─── Priority Badge ──────────────────────────────────

function priorityBadge(priority: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    urgent: { bg: "#7f1d1d", text: "#fca5a5" },
    high: { bg: "#7c2d12", text: "#fdba74" },
    medium: { bg: "#1e3a5f", text: "#93c5fd" },
    low: { bg: "#1a2e05", text: "#a3e635" },
  };
  const c = colors[priority] || colors.medium;
  return `<span style="display:inline-block;background:${c.bg};color:${c.text};font-size:11px;font-weight:600;padding:2px 8px;border-radius:9999px;text-transform:uppercase;">${escapeHtml(priority)}</span>`;
}

// ─── Notification Type Icon ──────────────────────────

function typeIcon(type: NotificationType): string {
  const icons: Record<string, string> = {
    reminder_due: "🔔",
    task_overdue: "⚠️",
    task_due_soon: "⏰",
    daily_digest: "📊",
    weekly_report: "📈",
    agent_complete: "✅",
    agent_failed: "❌",
    insight_generated: "💡",
    streak_milestone: "🔥",
    project_stalled: "🏗️",
    system: "ℹ️",
  };
  return icons[type] || "📬";
}

function viewLabel(type: NotificationType): string {
  switch (type) {
    case "task_overdue":
    case "task_due_soon":
      return "Open task";
    case "agent_complete":
      return "Review output";
    case "agent_failed":
    case "system":
      return "See what happened";
    case "project_stalled":
      return "Open project";
    default:
      return "Open in Brain Portal";
  }
}

// ─── Send: Individual Notification Email ─────────────

export function buildNotificationEmail(input: NotificationEmailInput): {
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
} {
  const { userId, notification } = input;
  const actions = input.actions ?? [];
  const icon = typeIcon(notification.type);
  const footer = buildFooter(userId, unsubscribeCategoryFor(notification.type));
  const viewUrl = absoluteUrl(notification.actionUrl || "/");
  const title = truncate(notification.title, 160);

  const content = `
    <h1 style="color:#f4f4f5;font-size:20px;line-height:1.35;margin:0 0 8px;">
      ${icon} ${escapeHtml(title)}
    </h1>
    ${notification.priority ? `<div style="margin-bottom:16px;">${priorityBadge(notification.priority)}</div>` : ""}
    <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 24px;">
      ${escapeMultiline(notification.body)}
    </p>
    ${actionRow(actions)}
    <div>
      ${button(viewUrl, `${viewLabel(notification.type)} →`, actions.length > 0 ? "secondary" : "primary")}
    </div>
  `;

  const text = [
    notification.title,
    "",
    notification.body,
    "",
    ...actions.map((a) => `${a.label.replace(/^✓\s*/, "")}: ${a.url}`),
    `${viewLabel(notification.type)}: ${viewUrl}`,
    "",
    "—",
    footerText(footer),
  ].join("\n");

  return {
    subject: `${icon} ${title}`,
    html: emailLayout(content, footer, truncate(notification.body, 100)),
    text,
    headers: listUnsubscribeHeaders(footer),
  };
}

export async function sendNotificationEmail(
  input: NotificationEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const email = buildNotificationEmail(input);
  return sendEmail({ to: input.to, ...email });
}

// ─── Send: Daily Digest Email ────────────────────────

function digestTaskList(
  tasks: DigestTask[],
  userId: string,
  timeZone: string,
  palette: { rowBorder: string; title: string; meta: string }
): string {
  const shown = tasks.slice(0, DIGEST_TASK_LIMIT);
  const rows = shown
    .map((t) => {
      const [done, tomorrow] = taskQuickActions(userId, { id: t.id, dueDate: t.dueDate }, timeZone);
      const actions = [done, tomorrow]
        .filter(Boolean)
        .map((a) => button(a.url, a.label, a.tone, "sm"))
        .join("");
      return `
        <div style="padding:10px 0;border-bottom:1px solid ${palette.rowBorder};">
          <a href="${safeHref(taskUrl(t.id))}" style="color:${palette.title};font-size:14px;text-decoration:none;font-weight:500;">${escapeHtml(truncate(t.title, 120))}</a>
          <div style="color:${palette.meta};font-size:12px;margin:4px 0 8px;">Due ${escapeHtml(formatDueLabel(t.dueDate, timeZone))} ${priorityBadge(t.priority)}</div>
          ${actions}
        </div>`;
    })
    .join("");
  const more =
    tasks.length > shown.length
      ? `<div style="padding-top:10px;"><a href="${safeHref(absoluteUrl("/tasks"))}" style="color:${palette.meta};font-size:12px;">+${tasks.length - shown.length} more in Brain Portal →</a></div>`
      : "";
  return rows + more;
}

function digestTaskText(tasks: DigestTask[], userId: string, timeZone: string): string {
  return tasks
    .slice(0, DIGEST_TASK_LIMIT)
    .map((t) => {
      const [done, tomorrow] = taskQuickActions(userId, { id: t.id, dueDate: t.dueDate }, timeZone);
      return [
        `- ${t.title} (due ${formatDueLabel(t.dueDate, timeZone)})`,
        `  Open: ${taskUrl(t.id)}`,
        done ? `  Mark done: ${done.url}` : null,
        tomorrow ? `  Move to tomorrow: ${tomorrow.url}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function buildDailyDigestEmail(input: DigestEmailInput): {
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
} {
  const { userId, userName, date, stats, overdueTasks, dueSoonTasks, aiDigest, topInsights, streakInfo } = input;
  const timeZone = safeTimeZone(input.timeZone);
  const footer = buildFooter(userId, "daily_digest");

  // Stats grid
  const statItems = [
    { label: "Tasks Done", value: stats.tasksCompleted, color: "#22c55e" },
    { label: "Overdue", value: stats.tasksOverdue, color: stats.tasksOverdue > 0 ? "#ef4444" : "#52525b" },
    { label: "Due Soon", value: stats.tasksDueSoon, color: stats.tasksDueSoon > 0 ? "#f59e0b" : "#52525b" },
    { label: "Notes", value: stats.notesCreated, color: "#3b82f6" },
    { label: "Captures", value: stats.capturesCount, color: "#8b5cf6" },
    { label: "AI Tasks", value: stats.aiTasksCompleted, color: "#06b6d4" },
  ];

  const statsGrid = statItems
    .map(
      (s) => `
    <td style="text-align:center;padding:12px 8px;background:#1f1f23;border-radius:8px;width:33%;">
      <div style="color:${s.color};font-size:24px;font-weight:700;">${s.value}</div>
      <div style="color:#71717a;font-size:11px;margin-top:2px;">${s.label}</div>
    </td>`
    )
    .reduce((rows, cell, i) => {
      if (i % 3 === 0) rows.push([]);
      rows[rows.length - 1].push(cell);
      return rows;
    }, [] as string[][])
    .map((row) => `<tr>${row.join('<td style="width:8px;"></td>')}</tr>`)
    .join('<tr><td colspan="5" style="height:8px;"></td></tr>');

  const overdueSection =
    overdueTasks.length > 0
      ? `
    <div style="margin-top:24px;padding:16px;background:#1c1917;border-left:3px solid #ef4444;border-radius:8px;">
      <h3 style="color:#fca5a5;font-size:14px;margin:0 0 4px;">⚠️ Overdue (${overdueTasks.length})</h3>
      ${digestTaskList(overdueTasks, userId, timeZone, { rowBorder: "#292524", title: "#e7e5e4", meta: "#a8a29e" })}
    </div>`
      : "";

  const dueSoonSection =
    dueSoonTasks.length > 0
      ? `
    <div style="margin-top:16px;padding:16px;background:#1a1a2e;border-left:3px solid #f59e0b;border-radius:8px;">
      <h3 style="color:#fcd34d;font-size:14px;margin:0 0 4px;">⏰ Due Soon (${dueSoonTasks.length})</h3>
      ${digestTaskList(dueSoonTasks, userId, timeZone, { rowBorder: "#27272a", title: "#e4e4e7", meta: "#a1a1aa" })}
    </div>`
      : "";

  const aiSection = aiDigest
    ? `
    <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#1e1b4b,#172554);border-radius:12px;border:1px solid #312e81;">
      <h3 style="color:#c4b5fd;font-size:14px;margin:0 0 12px;">✨ AI Intelligence Brief</h3>
      <div style="color:#d4d4d8;font-size:14px;line-height:1.7;">${escapeMultiline(aiDigest)}</div>
    </div>`
    : "";

  const insightsSection =
    topInsights.length > 0
      ? `
    <div style="margin-top:24px;">
      <h3 style="color:#e4e4e7;font-size:14px;margin:0 0 12px;">💡 Recent Insights</h3>
      ${topInsights
        .map(
          (i) => `
        <div style="padding:12px;background:#1f1f23;border-radius:8px;margin-bottom:8px;">
          <div style="color:#f4f4f5;font-size:13px;font-weight:600;">${escapeHtml(i.title)}</div>
          <div style="color:#a1a1aa;font-size:12px;margin-top:4px;">${escapeHtml(truncate(i.content, 150))}</div>
        </div>`
        )
        .join("")}
    </div>`
      : "";

  const streakSection = streakInfo
    ? `
    <div style="margin-top:16px;text-align:center;padding:16px;background:#1a2e05;border-radius:8px;">
      <span style="font-size:24px;">🔥</span>
      <div style="color:#a3e635;font-size:14px;font-weight:600;margin-top:4px;">${streakInfo.length}-day streak!</div>
    </div>`
    : "";

  const reviewSection =
    stats.aiTasksAwaitingReview > 0
      ? `
    <div style="margin-top:24px;padding:16px;background:#1e1b4b;border-radius:8px;text-align:center;">
      <p style="color:#c4b5fd;font-size:14px;margin:0 0 12px;">
        🤖 ${stats.aiTasksAwaitingReview} AI task${stats.aiTasksAwaitingReview > 1 ? "s" : ""} awaiting your review
      </p>
      ${button(absoluteUrl("/review"), "Review now")}
    </div>`
      : "";

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#f4f4f5;font-size:22px;margin:0;">Good ${getTimeOfDay(timeZone)}, ${escapeHtml(userName)}</h1>
      <p style="color:#71717a;font-size:13px;margin:4px 0 0;">${escapeHtml(date)} — Daily Digest</p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${statsGrid}
    </table>

    ${streakSection}
    ${overdueSection}
    ${dueSoonSection}
    ${aiSection}
    ${insightsSection}
    ${reviewSection}

    <div style="text-align:center;margin-top:24px;">
      ${button(absoluteUrl("/"), "Open Brain Portal")}
    </div>
  `;

  const text = [
    `Daily Digest for ${date}`,
    "",
    `Tasks: ${stats.tasksCompleted} completed, ${stats.tasksOverdue} overdue, ${stats.tasksDueSoon} due soon`,
    `Notes: ${stats.notesCreated}`,
    overdueTasks.length ? `\nOverdue:\n${digestTaskText(overdueTasks, userId, timeZone)}` : "",
    dueSoonTasks.length ? `\nDue soon:\n${digestTaskText(dueSoonTasks, userId, timeZone)}` : "",
    aiDigest ? `\n${aiDigest}` : "",
    stats.aiTasksAwaitingReview > 0 ? `\nReview AI output: ${absoluteUrl("/review")}` : "",
    `\nOpen Brain Portal: ${absoluteUrl("/")}`,
    "",
    "—",
    footerText(footer),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    subject: `📊 Daily Digest — ${stats.tasksCompleted} done, ${stats.tasksOverdue} overdue${streakInfo ? ` 🔥${streakInfo.length}` : ""}`,
    html: emailLayout(content, footer, `${stats.tasksCompleted} tasks done today. ${stats.tasksOverdue} overdue.`),
    text,
    headers: listUnsubscribeHeaders(footer),
  };
}

export async function sendDailyDigestEmail(
  input: DigestEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  return sendEmail({ to: input.to, ...buildDailyDigestEmail(input) });
}

// ─── Send: Weekly Intelligence Report ────────────────

export async function sendWeeklyReportEmail(
  input: WeeklyReportEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const { userId, weekRange, stats, aiReport, topAchievements, focusAreas, recommendations } = input;
  const footer = buildFooter(userId, "weekly_report");

  const statsRow = [
    { label: "Tasks Done", value: stats.tasksCompleted, icon: "✅" },
    { label: "Notes Written", value: stats.notesWritten, icon: "📝" },
    { label: "Words", value: stats.wordsWritten.toLocaleString(), icon: "✍️" },
    { label: "AI Tasks", value: stats.aiTasksProcessed, icon: "🤖" },
  ];

  const list = (items: string[], bg: string, color: string) =>
    items
      .map(
        (item) => `
      <div style="padding:8px 12px;background:${bg};border-radius:6px;margin-bottom:6px;color:${color};font-size:13px;">
        ${escapeHtml(item)}
      </div>`
      )
      .join("");

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#f4f4f5;font-size:22px;margin:0;">Weekly Intelligence Report</h1>
      <p style="color:#71717a;font-size:13px;margin:4px 0 0;">${escapeHtml(weekRange)}</p>
    </div>

    <!-- Stats -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${statsRow.map((s) => `
        <td style="text-align:center;padding:16px 4px;background:#1f1f23;border-radius:8px;">
          <div style="font-size:18px;">${s.icon}</div>
          <div style="color:#f4f4f5;font-size:20px;font-weight:700;margin-top:4px;">${s.value}</div>
          <div style="color:#71717a;font-size:10px;margin-top:2px;">${s.label}</div>
        </td>`).join('<td style="width:6px;"></td>')}
      </tr>
    </table>

    <!-- AI Report -->
    <div style="margin-top:24px;padding:24px;background:linear-gradient(135deg,#1e1b4b,#172554);border-radius:12px;border:1px solid #312e81;">
      <h2 style="color:#c4b5fd;font-size:16px;margin:0 0 16px;">✨ AI Analysis</h2>
      <div style="color:#d4d4d8;font-size:14px;line-height:1.8;">${escapeMultiline(aiReport)}</div>
    </div>

    ${topAchievements.length > 0 ? `
    <div style="margin-top:24px;">
      <h3 style="color:#a3e635;font-size:14px;margin:0 0 12px;">🏆 Top Achievements</h3>
      ${list(topAchievements, "#1a2e05", "#d9f99d")}
    </div>` : ""}

    ${focusAreas.length > 0 ? `
    <div style="margin-top:20px;">
      <h3 style="color:#fcd34d;font-size:14px;margin:0 0 12px;">🎯 Focus Areas for Next Week</h3>
      ${list(focusAreas, "#1c1917", "#fef3c7")}
    </div>` : ""}

    ${recommendations.length > 0 ? `
    <div style="margin-top:20px;">
      <h3 style="color:#93c5fd;font-size:14px;margin:0 0 12px;">💡 Recommendations</h3>
      ${list(recommendations, "#172554", "#bfdbfe")}
    </div>` : ""}

    <div style="text-align:center;margin-top:28px;">
      ${button(absoluteUrl("/"), "Open Brain Portal")}
    </div>
  `;

  const bullets = (title: string, items: string[]) =>
    items.length ? `\n${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : "";

  return sendEmail({
    to: input.to,
    subject: `📈 Weekly Report — ${stats.tasksCompleted} tasks, ${stats.notesWritten} notes, ${stats.wordsWritten.toLocaleString()} words`,
    html: emailLayout(content, footer, `Your week: ${stats.tasksCompleted} tasks completed, ${stats.notesWritten} notes written.`),
    text: [
      `Weekly Intelligence Report — ${weekRange}`,
      "",
      `Tasks: ${stats.tasksCompleted} · Notes: ${stats.notesWritten} · Words: ${stats.wordsWritten}`,
      "",
      aiReport,
      bullets("Top achievements", topAchievements),
      bullets("Focus areas", focusAreas),
      bullets("Recommendations", recommendations),
      "",
      `Open Brain Portal: ${absoluteUrl("/")}`,
      "",
      "—",
      footerText(footer),
    ].join("\n"),
    headers: listUnsubscribeHeaders(footer),
  });
}

// ─── Helper ──────────────────────────────────────────

function getTimeOfDay(timeZone: string): string {
  const hour = hourInTimeZone(new Date(), timeZone);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
