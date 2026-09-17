/**
 * Notification Email Templates
 *
 * Beautiful, responsive HTML emails for:
 * - Individual alerts (reminders, overdue tasks)
 * - Daily digest (AI-powered summary)
 * - Weekly intelligence report (AI-powered deep analysis)
 *
 * Uses inline styles for maximum email client compatibility.
 * Leverages existing SMTP infrastructure from src/lib/email.
 */

import { sendEmail, isEmailConfigured } from "@/lib/email";
import type { NotificationType } from "@/lib/db/schema";

// ─── Types ───────────────────────────────────────────

interface NotificationEmailInput {
  to: string;
  userName: string;
  notification: {
    type: NotificationType;
    title: string;
    body: string;
    priority?: string;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  };
}

interface DigestEmailInput {
  to: string;
  userName: string;
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
  overdueTasks: { title: string; dueDate: string; priority: string }[];
  dueSoonTasks: { title: string; dueDate: string; priority: string }[];
  aiDigest: string | null; // AI-generated summary
  topInsights: { title: string; content: string }[];
  streakInfo: { type: string; length: number } | null;
}

interface WeeklyReportEmailInput {
  to: string;
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

// ─── Base Layout ─────────────────────────────────────

function emailLayout(content: string, preheader: string = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brain Portal</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f10;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:10px 12px;border-radius:12px;margin-bottom:12px;">
                <span style="color:#fff;font-size:20px;">🧠</span>
              </div>
              <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-top:8px;">Brain Portal</div>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="background-color:#18181b;border-radius:16px;padding:32px;border:1px solid #27272a;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="color:#52525b;font-size:12px;margin:0;">
                Manage your notification preferences in Settings.
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

// ─── Priority Badge ──────────────────────────────────

function priorityBadge(priority: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    urgent: { bg: "#7f1d1d", text: "#fca5a5" },
    high: { bg: "#7c2d12", text: "#fdba74" },
    medium: { bg: "#1e3a5f", text: "#93c5fd" },
    low: { bg: "#1a2e05", text: "#a3e635" },
  };
  const c = colors[priority] || colors.medium;
  return `<span style="display:inline-block;background:${c.bg};color:${c.text};font-size:11px;font-weight:600;padding:2px 8px;border-radius:9999px;text-transform:uppercase;">${priority}</span>`;
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

// ─── Send: Individual Notification Email ─────────────

export async function sendNotificationEmail(
  input: NotificationEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const { to, userName, notification } = input;
  const icon = typeIcon(notification.type);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const content = `
    <h1 style="color:#f4f4f5;font-size:20px;margin:0 0 8px;">
      ${icon} ${notification.title}
    </h1>
    ${notification.priority ? `<div style="margin-bottom:16px;">${priorityBadge(notification.priority)}</div>` : ""}
    <p style="color:#a1a1aa;font-size:15px;line-height:1.6;margin:0 0 24px;">
      ${notification.body}
    </p>
    ${notification.actionUrl ? `
    <a href="${appUrl}${notification.actionUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
      View Details →
    </a>` : ""}
  `;

  return sendEmail({
    to,
    subject: `${icon} ${notification.title}`,
    html: emailLayout(content, notification.body.substring(0, 100)),
    text: `${notification.title}\n\n${notification.body}`,
  });
}

// ─── Send: Daily Digest Email ────────────────────────

export async function sendDailyDigestEmail(
  input: DigestEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const { to, userName, date, stats, overdueTasks, dueSoonTasks, aiDigest, topInsights, streakInfo } = input;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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
    .map(
      (row) => `<tr>${row.join('<td style="width:8px;"></td>')}</tr>`
    )
    .join('<tr><td colspan="5" style="height:8px;"></td></tr>');

  // Overdue tasks section
  const overdueSection =
    overdueTasks.length > 0
      ? `
    <div style="margin-top:24px;padding:16px;background:#1c1917;border-left:3px solid #ef4444;border-radius:8px;">
      <h3 style="color:#fca5a5;font-size:14px;margin:0 0 12px;">⚠️ Overdue Tasks (${overdueTasks.length})</h3>
      ${overdueTasks
        .map(
          (t) => `
        <div style="padding:6px 0;border-bottom:1px solid #292524;">
          <div style="color:#e7e5e4;font-size:13px;">${t.title}</div>
          <div style="color:#78716c;font-size:11px;">Due: ${t.dueDate} ${priorityBadge(t.priority)}</div>
        </div>`
        )
        .join("")}
    </div>`
      : "";

  // Due soon section
  const dueSoonSection =
    dueSoonTasks.length > 0
      ? `
    <div style="margin-top:16px;padding:16px;background:#1a1a2e;border-left:3px solid #f59e0b;border-radius:8px;">
      <h3 style="color:#fcd34d;font-size:14px;margin:0 0 12px;">⏰ Due Soon (${dueSoonTasks.length})</h3>
      ${dueSoonTasks
        .map(
          (t) => `
        <div style="padding:6px 0;border-bottom:1px solid #27272a;">
          <div style="color:#e4e4e7;font-size:13px;">${t.title}</div>
          <div style="color:#71717a;font-size:11px;">Due: ${t.dueDate}</div>
        </div>`
        )
        .join("")}
    </div>`
      : "";

  // AI digest section
  const aiSection = aiDigest
    ? `
    <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#1e1b4b,#172554);border-radius:12px;border:1px solid #312e81;">
      <h3 style="color:#c4b5fd;font-size:14px;margin:0 0 12px;">✨ AI Intelligence Brief</h3>
      <div style="color:#d4d4d8;font-size:14px;line-height:1.7;">${aiDigest.replace(/\n/g, "<br>")}</div>
    </div>`
    : "";

  // Insights section
  const insightsSection =
    topInsights.length > 0
      ? `
    <div style="margin-top:24px;">
      <h3 style="color:#e4e4e7;font-size:14px;margin:0 0 12px;">💡 Recent Insights</h3>
      ${topInsights
        .map(
          (i) => `
        <div style="padding:12px;background:#1f1f23;border-radius:8px;margin-bottom:8px;">
          <div style="color:#f4f4f5;font-size:13px;font-weight:600;">${i.title}</div>
          <div style="color:#a1a1aa;font-size:12px;margin-top:4px;">${i.content.substring(0, 150)}...</div>
        </div>`
        )
        .join("")}
    </div>`
      : "";

  // Streak section
  const streakSection = streakInfo
    ? `
    <div style="margin-top:16px;text-align:center;padding:16px;background:#1a2e05;border-radius:8px;">
      <span style="font-size:24px;">🔥</span>
      <div style="color:#a3e635;font-size:14px;font-weight:600;margin-top:4px;">${streakInfo.length}-day streak!</div>
    </div>`
    : "";

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#f4f4f5;font-size:22px;margin:0;">Good ${getTimeOfDay()}, ${userName}</h1>
      <p style="color:#71717a;font-size:13px;margin:4px 0 0;">${date} — Daily Digest</p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${statsGrid}
    </table>

    ${streakSection}
    ${overdueSection}
    ${dueSoonSection}
    ${aiSection}
    ${insightsSection}

    ${stats.aiTasksAwaitingReview > 0 ? `
    <div style="margin-top:24px;padding:16px;background:#1e1b4b;border-radius:8px;text-align:center;">
      <p style="color:#c4b5fd;font-size:14px;margin:0 0 12px;">
        🤖 ${stats.aiTasksAwaitingReview} AI task${stats.aiTasksAwaitingReview > 1 ? "s" : ""} awaiting your review
      </p>
      <a href="${appUrl}/tasks" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:13px;">
        Review Now
      </a>
    </div>` : ""}

    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;">
        Open Brain Portal
      </a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `📊 Daily Digest — ${stats.tasksCompleted} done, ${stats.tasksOverdue} overdue${streakInfo ? ` 🔥${streakInfo.length}` : ""}`,
    html: emailLayout(content, `${stats.tasksCompleted} tasks done today. ${stats.tasksOverdue} overdue.`),
    text: `Daily Digest for ${date}\n\nTasks: ${stats.tasksCompleted} completed, ${stats.tasksOverdue} overdue\nNotes: ${stats.notesCreated}\n\n${aiDigest || ""}`,
  });
}

// ─── Send: Weekly Intelligence Report ────────────────

export async function sendWeeklyReportEmail(
  input: WeeklyReportEmailInput
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const { to, userName, weekRange, stats, aiReport, topAchievements, focusAreas, recommendations } = input;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const statsRow = [
    { label: "Tasks Done", value: stats.tasksCompleted, icon: "✅" },
    { label: "Notes Written", value: stats.notesWritten, icon: "📝" },
    { label: "Words", value: stats.wordsWritten.toLocaleString(), icon: "✍️" },
    { label: "AI Tasks", value: stats.aiTasksProcessed, icon: "🤖" },
  ];

  const content = `
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#f4f4f5;font-size:22px;margin:0;">Weekly Intelligence Report</h1>
      <p style="color:#71717a;font-size:13px;margin:4px 0 0;">${weekRange}</p>
    </div>

    <!-- Stats -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${statsRow.map(s => `
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
      <div style="color:#d4d4d8;font-size:14px;line-height:1.8;">${aiReport.replace(/\n/g, "<br>")}</div>
    </div>

    <!-- Achievements -->
    ${topAchievements.length > 0 ? `
    <div style="margin-top:24px;">
      <h3 style="color:#a3e635;font-size:14px;margin:0 0 12px;">🏆 Top Achievements</h3>
      ${topAchievements.map(a => `
      <div style="padding:8px 12px;background:#1a2e05;border-radius:6px;margin-bottom:6px;color:#d9f99d;font-size:13px;">
        ${a}
      </div>`).join("")}
    </div>` : ""}

    <!-- Focus Areas -->
    ${focusAreas.length > 0 ? `
    <div style="margin-top:20px;">
      <h3 style="color:#fcd34d;font-size:14px;margin:0 0 12px;">🎯 Focus Areas for Next Week</h3>
      ${focusAreas.map(f => `
      <div style="padding:8px 12px;background:#1c1917;border-radius:6px;margin-bottom:6px;color:#fef3c7;font-size:13px;">
        ${f}
      </div>`).join("")}
    </div>` : ""}

    <!-- AI Recommendations -->
    ${recommendations.length > 0 ? `
    <div style="margin-top:20px;">
      <h3 style="color:#93c5fd;font-size:14px;margin:0 0 12px;">💡 Recommendations</h3>
      ${recommendations.map(r => `
      <div style="padding:8px 12px;background:#172554;border-radius:6px;margin-bottom:6px;color:#bfdbfe;font-size:13px;">
        ${r}
      </div>`).join("")}
    </div>` : ""}

    <div style="text-align:center;margin-top:28px;">
      <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;">
        Open Brain Portal
      </a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `📈 Weekly Report — ${stats.tasksCompleted} tasks, ${stats.notesWritten} notes, ${stats.wordsWritten.toLocaleString()} words`,
    html: emailLayout(content, `Your week: ${stats.tasksCompleted} tasks completed, ${stats.notesWritten} notes written.`),
    text: `Weekly Intelligence Report — ${weekRange}\n\nTasks: ${stats.tasksCompleted}\nNotes: ${stats.notesWritten}\nWords: ${stats.wordsWritten}\n\n${aiReport}`,
  });
}

// ─── Helper ──────────────────────────────────────────

function getTimeOfDay(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
