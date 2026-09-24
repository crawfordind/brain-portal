/**
 * AI-Powered Digest & Report Generation
 *
 * Daily Digest: Uses fast_llm tier for a quick, smart summary of the day.
 * Weekly Report: Uses full_llm tier for deep analysis and recommendations.
 *
 * Both are cached to avoid redundant AI calls and keep costs minimal.
 */

import { queryAll, queryOne, db } from "@/lib/db/client";
import { complete, completeJSON } from "@/lib/ai/client";

import { getCached, setCache, generateCacheKey } from "@/lib/processing/cache";
import { createNotification, getNotificationPreferences } from "./engine";
import { sendDailyDigestEmail, sendWeeklyReportEmail } from "./emails";
import { dueSoonClause, overdueClause } from "./due-queries";
import { safeTimeZone, todayInTimeZone } from "@/lib/email/when";

// ─── Daily Digest Generation ────────────────────────

interface DailyDigestData {
  tasksCompleted: { title: string; project?: string }[];
  tasksOverdue: { id: string; title: string; dueDate: string; priority: string }[];
  tasksDueSoon: { id: string; title: string; dueDate: string; priority: string }[];
  notesCreated: { title: string; type: string; wordCount: number }[];
  captures: { content: string; type: string }[];
  aiTasksCompleted: number;
  aiTasksAwaitingReview: number;
  activeReminders: number;
  insights: { title: string; content: string }[];
  streak: { type: string; length: number } | null;
}

async function gatherDailyData(userId: string, timeZone: string): Promise<DailyDigestData> {
  const today = new Date().toISOString().split("T")[0];
  const overdue = overdueClause(timeZone);
  const dueSoon = dueSoonClause(timeZone, 24);

  const [
    tasksCompleted,
    tasksOverdue,
    tasksDueSoon,
    notesCreated,
    captures,
    aiStats,
    activeReminders,
    insights,
  ] = await Promise.all([
    // Tasks completed today
    queryAll<{ title: string | null; content: string; project_name?: string }>(
      `SELECT t.title, t.content, p.name as project_name FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.user_id = ? AND t.status = 'completed'
         AND t.completed_at >= datetime('now', '-24 hours')`,
      [userId]
    ),
    // Overdue tasks
    queryAll<{ id: string; title: string | null; content: string; due_date: string; priority: string }>(
      `SELECT id, title, content, due_date, priority FROM tasks
       WHERE user_id = ? AND status IN ('pending', 'in_progress')
         AND ${overdue.sql}
       ORDER BY due_date ASC`,
      [userId, ...overdue.args]
    ),
    // Due soon (next 24h)
    queryAll<{ id: string; title: string | null; content: string; due_date: string; priority: string }>(
      `SELECT id, title, content, due_date, priority FROM tasks
       WHERE user_id = ? AND status IN ('pending', 'in_progress')
         AND ${dueSoon.sql}
       ORDER BY due_date ASC`,
      [userId, ...dueSoon.args]
    ),
    // Notes created today
    queryAll<{ title: string; note_type: string; word_count: number }>(
      `SELECT title, note_type, word_count FROM notes
       WHERE user_id = ? AND created_at >= ? AND is_archived = 0`,
      [userId, today]
    ),
    // Captures today
    queryAll<{ content: string; capture_type: string }>(
      `SELECT content, capture_type FROM captures
       WHERE user_id = ? AND captured_at >= ?`,
      [userId, today]
    ),
    // AI task stats
    queryOne<{ completed: number; review: number }>(
      `SELECT
        COUNT(CASE WHEN status = 'approved' AND updated_at >= datetime('now', '-24 hours') THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'awaiting_review' THEN 1 END) as review
       FROM agent_tasks WHERE user_id = ?`,
      [userId]
    ),
    // Active reminders
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM reminders
       WHERE user_id = ? AND status = 'pending'`,
      [userId]
    ),
    // Recent insights
    queryAll<{ title: string; content: string }>(
      `SELECT title, content FROM insights
       WHERE user_id = ? AND is_dismissed = 0
       ORDER BY generated_at DESC LIMIT 3`,
      [userId]
    ),
  ]);

  // Calculate streak
  const recentDailyNotes = await queryAll<{ date: string }>(
    `SELECT DISTINCT date FROM daily_notes
     WHERE user_id = ? AND date >= date('now', '-30 days')
     ORDER BY date DESC`,
    [userId]
  );

  let streak: { type: string; length: number } | null = null;
  if (recentDailyNotes.length > 0) {
    let count = 0;
    const dates = recentDailyNotes.map((d) => d.date);
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(Date.now() - i * 86400000)
        .toISOString()
        .split("T")[0];
      if (dates.includes(checkDate)) {
        count++;
      } else if (i > 0) break;
    }
    if (count >= 2) {
      streak = { type: "daily_note", length: count };
    }
  }

  return {
    tasksCompleted: tasksCompleted.map((t) => ({
      title: t.title || t.content,
      project: t.project_name,
    })),
    tasksOverdue: tasksOverdue.map((t) => ({
      id: t.id,
      title: t.title || t.content,
      dueDate: t.due_date,
      priority: t.priority,
    })),
    tasksDueSoon: tasksDueSoon.map((t) => ({
      id: t.id,
      title: t.title || t.content,
      dueDate: t.due_date,
      priority: t.priority,
    })),
    notesCreated: notesCreated.map((n) => ({
      title: n.title,
      type: n.note_type,
      wordCount: n.word_count,
    })),
    captures: captures.map((c) => ({
      content: c.content,
      type: c.capture_type,
    })),
    aiTasksCompleted: aiStats?.completed || 0,
    aiTasksAwaitingReview: aiStats?.review || 0,
    activeReminders: activeReminders?.count || 0,
    insights,
    streak,
  };
}

async function generateAIDailyDigest(
  userId: string,
  data: DailyDigestData
): Promise<string | null> {
  const prefs = await getNotificationPreferences(userId);
  if (!prefs.ai_digest_enabled) return null;

  // Check cache (one digest per day)
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = generateCacheKey("daily_digest", { userId, date: today });
  const cached = await getCached<string>(userId, cacheKey);
  if (cached) return cached;

  const context = `
Today's activity:
- ${data.tasksCompleted.length} tasks completed${data.tasksCompleted.length > 0 ? `: ${data.tasksCompleted.map((t) => t.title).join(", ")}` : ""}
- ${data.tasksOverdue.length} overdue tasks${data.tasksOverdue.length > 0 ? `: ${data.tasksOverdue.map((t) => `${t.title} (${t.priority})`).join(", ")}` : ""}
- ${data.tasksDueSoon.length} tasks due soon
- ${data.notesCreated.length} notes created (${data.notesCreated.reduce((s, n) => s + n.wordCount, 0)} words)
- ${data.captures.length} captures
- ${data.aiTasksCompleted} AI tasks completed, ${data.aiTasksAwaitingReview} awaiting review
- ${data.activeReminders} active reminders
${data.streak ? `- ${data.streak.length}-day daily note streak` : ""}
${data.insights.length > 0 ? `\nRecent insights:\n${data.insights.map((i) => `- ${i.title}: ${i.content.substring(0, 100)}`).join("\n")}` : ""}`.trim();

  try {
    const digest = await complete(context, {
      system: `You are an executive assistant providing a brief daily intelligence brief. Be warm but concise.
Analyze the user's day in 3-4 sentences:
1. Highlight productivity wins and momentum
2. Flag urgent items needing attention (overdue tasks, important deadlines)
3. One actionable suggestion for tomorrow
Keep it conversational and motivating. No headers, no bullet points. Just flowing text.`,
      slot: "fast", // fast_llm tier - cheap
      userId,
      maxTokens: 300,
      temperature: 0.5,
    });

    const result = digest.trim();

    // Cache for 24h
    await setCache(userId, cacheKey, result, {
      operation: "daily_digest",
      tier: "fast_llm",
      ttlHours: 24,
    });

    return result;
  } catch (error) {
    console.error("[DIGEST] AI daily digest failed:", error);
    return null;
  }
}

export async function generateAndSendDailyDigest(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const prefs = await getNotificationPreferences(userId);
    const timeZone = safeTimeZone(prefs.timezone);

    // Check if already sent today — "today" in the user's zone.
    if (prefs.last_daily_digest) {
      const lastDigest = parseSqliteTimestamp(prefs.last_daily_digest);
      const now = new Date();
      if (
        lastDigest &&
        todayInTimeZone(lastDigest, timeZone) === todayInTimeZone(now, timeZone)
      ) {
        return { success: true }; // Already sent today
      }
    }

    const data = await gatherDailyData(userId, timeZone);
    const aiDigest = await generateAIDailyDigest(userId, data);

    // Create in-app notification
    await createNotification({
      userId,
      type: "daily_digest",
      title: "Daily Digest",
      body: aiDigest || `${data.tasksCompleted.length} tasks done, ${data.tasksOverdue.length} overdue, ${data.notesCreated.length} notes created.`,
      priority: data.tasksOverdue.length > 0 ? "high" : "low",
      actionUrl: "/",
      metadata: {
        stats: {
          tasksCompleted: data.tasksCompleted.length,
          tasksOverdue: data.tasksOverdue.length,
        },
      },
    });

    // Send email if enabled
    if (prefs.email_enabled && prefs.email_daily_digest) {
      const user = await queryOne<{ email: string; display_name: string | null }>(
        "SELECT email, display_name FROM users WHERE id = ?",
        [userId]
      );
      if (user) {
        await sendDailyDigestEmail({
          to: user.email,
          userId,
          userName: user.display_name || "there",
          timeZone,
          date: new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone,
          }),
          stats: {
            tasksCompleted: data.tasksCompleted.length,
            tasksOverdue: data.tasksOverdue.length,
            tasksDueSoon: data.tasksDueSoon.length,
            notesCreated: data.notesCreated.length,
            capturesCount: data.captures.length,
            aiTasksCompleted: data.aiTasksCompleted,
            aiTasksAwaitingReview: data.aiTasksAwaitingReview,
            activeReminders: data.activeReminders,
          },
          overdueTasks: data.tasksOverdue,
          dueSoonTasks: data.tasksDueSoon,
          aiDigest,
          topInsights: data.insights,
          streakInfo: data.streak,
        });
      }
    }

    // Update last digest timestamp
    await db.execute({
      sql: `UPDATE notification_preferences
            SET last_daily_digest = datetime('now'), updated_at = datetime('now')
            WHERE user_id = ?`,
      args: [userId],
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[DIGEST] Daily digest failed:", msg);
    return { success: false, error: msg };
  }
}

// ─── Weekly Intelligence Report ─────────────────────

interface WeeklyData {
  tasksCompleted: number;
  tasksCreated: number;
  notesWritten: number;
  wordsWritten: number;
  capturesCount: number;
  aiTasksProcessed: number;
  projectsActive: number;
  completedTaskTitles: string[];
  notesTitles: string[];
  capturesSample: string[];
  projectNames: string[];
}

async function gatherWeeklyData(userId: string): Promise<WeeklyData> {
  const [
    taskStats,
    noteStats,
    captures,
    aiTasks,
    projects,
    completedTasks,
    notes,
  ] = await Promise.all([
    queryOne<{ completed: number; created: number }>(
      `SELECT
        COUNT(CASE WHEN status = 'completed' AND completed_at >= datetime('now', '-7 days') THEN 1 END) as completed,
        COUNT(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 END) as created
       FROM tasks WHERE user_id = ?`,
      [userId]
    ),
    queryOne<{ count: number; words: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(word_count), 0) as words
       FROM notes WHERE user_id = ? AND created_at >= datetime('now', '-7 days') AND is_archived = 0`,
      [userId]
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM captures
       WHERE user_id = ? AND captured_at >= datetime('now', '-7 days')`,
      [userId]
    ),
    queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM agent_tasks
       WHERE user_id = ? AND status IN ('approved', 'rejected')
         AND updated_at >= datetime('now', '-7 days')`,
      [userId]
    ),
    queryAll<{ name: string }>(
      `SELECT name FROM projects WHERE user_id = ? AND status = 'active'`,
      [userId]
    ),
    queryAll<{ title: string | null; content: string }>(
      `SELECT title, content FROM tasks
       WHERE user_id = ? AND status = 'completed'
         AND completed_at >= datetime('now', '-7 days')
       LIMIT 20`,
      [userId]
    ),
    queryAll<{ title: string }>(
      `SELECT title FROM notes
       WHERE user_id = ? AND created_at >= datetime('now', '-7 days') AND is_archived = 0
       LIMIT 15`,
      [userId]
    ),
  ]);

  const capturesSample = await queryAll<{ content: string }>(
    `SELECT content FROM captures
     WHERE user_id = ? AND captured_at >= datetime('now', '-7 days')
     LIMIT 10`,
    [userId]
  );

  return {
    tasksCompleted: taskStats?.completed || 0,
    tasksCreated: taskStats?.created || 0,
    notesWritten: noteStats?.count || 0,
    wordsWritten: noteStats?.words || 0,
    capturesCount: captures?.count || 0,
    aiTasksProcessed: aiTasks?.count || 0,
    projectsActive: projects.length,
    completedTaskTitles: completedTasks.map((t) => t.title || t.content),
    notesTitles: notes.map((n) => n.title),
    capturesSample: capturesSample.map((c) => c.content.substring(0, 100)),
    projectNames: projects.map((p) => p.name),
  };
}

async function generateAIWeeklyReport(
  userId: string,
  data: WeeklyData
): Promise<{
  report: string;
  achievements: string[];
  focusAreas: string[];
  recommendations: string[];
}> {
  // Check cache
  const weekKey = getWeekKey();
  const cacheKey = generateCacheKey("weekly_report", { userId, week: weekKey });
  const cached = await getCached<{
    report: string;
    achievements: string[];
    focusAreas: string[];
    recommendations: string[];
  }>(userId, cacheKey);
  if (cached) return cached;

  const context = `
Weekly productivity data:
- Tasks: ${data.tasksCompleted} completed, ${data.tasksCreated} created
- Notes: ${data.notesWritten} written (${data.wordsWritten.toLocaleString()} words)
- Captures: ${data.capturesCount}
- AI tasks processed: ${data.aiTasksProcessed}
- Active projects: ${data.projectNames.join(", ") || "None"}

Completed tasks: ${data.completedTaskTitles.slice(0, 10).join(", ") || "None"}
Notes written: ${data.notesTitles.slice(0, 10).join(", ") || "None"}
Sample thoughts/captures: ${data.capturesSample.slice(0, 5).join("; ") || "None"}`.trim();

  try {
    const result = await completeJSON<{
      analysis: string;
      achievements: string[];
      focus_areas: string[];
      recommendations: string[];
    }>(context, {
      system: `You are an executive intelligence analyst reviewing a user's weekly productivity in their knowledge management system.

Return a JSON object with:
- "analysis": 3-4 sentence narrative analysis. Identify patterns, momentum shifts, and notable accomplishments. Be specific about what they worked on. Warm but insightful tone.
- "achievements": Array of 2-4 top achievements this week (short phrases)
- "focus_areas": Array of 2-3 suggested focus areas for next week based on patterns
- "recommendations": Array of 2-3 actionable recommendations to improve productivity

Be specific, reference actual task/note names when possible. No generic advice.`,
      slot: "deep", // full_llm tier for deep analysis
      userId,
      maxTokens: 800,
    });

    const output = {
      report: result.analysis || "Weekly report generated.",
      achievements: result.achievements || [],
      focusAreas: result.focus_areas || [],
      recommendations: result.recommendations || [],
    };

    // Cache for 48h
    await setCache(userId, cacheKey, output, {
      operation: "weekly_report",
      tier: "full_llm",
      ttlHours: 48,
    });

    return output;
  } catch (error) {
    console.error("[DIGEST] AI weekly report failed:", error);
    return fallbackWeeklyReport(data);
  }
}

function fallbackWeeklyReport(data: WeeklyData) {
  return {
    report: `This week: ${data.tasksCompleted} tasks completed, ${data.notesWritten} notes written, ${data.wordsWritten.toLocaleString()} words.`,
    achievements: data.tasksCompleted > 0 ? [`Completed ${data.tasksCompleted} tasks`] : [],
    focusAreas: [] as string[],
    recommendations: [] as string[],
  };
}

export async function generateAndSendWeeklyReport(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const prefs = await getNotificationPreferences(userId);

    // Check if already sent this week
    if (prefs.last_weekly_report) {
      const lastReport = parseSqliteTimestamp(prefs.last_weekly_report);
      const now = new Date();
      const daysSince = lastReport ? (now.getTime() - lastReport.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
      if (daysSince < 6) {
        return { success: true }; // Already sent this week
      }
    }

    const data = await gatherWeeklyData(userId);
    const aiReport = prefs.ai_weekly_enabled
      ? await generateAIWeeklyReport(userId, data)
      : fallbackWeeklyReport(data);

    // Create in-app notification
    await createNotification({
      userId,
      type: "weekly_report",
      title: "Weekly Intelligence Report",
      body: aiReport.report,
      priority: "low",
      actionUrl: "/",
      metadata: {
        stats: {
          tasksCompleted: data.tasksCompleted,
          notesWritten: data.notesWritten,
          wordsWritten: data.wordsWritten,
        },
      },
    });

    // Send email if enabled
    if (prefs.email_enabled && prefs.email_weekly_report) {
      const user = await queryOne<{ email: string; display_name: string | null }>(
        "SELECT email, display_name FROM users WHERE id = ?",
        [userId]
      );
      if (user) {
        const now = new Date();
        const weekStart = new Date(now.getTime() - 7 * 86400000);
        const timeZone = safeTimeZone(prefs.timezone);
        const weekRange = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone })}`;

        await sendWeeklyReportEmail({
          to: user.email,
          userId,
          userName: user.display_name || "there",
          weekRange,
          stats: {
            tasksCompleted: data.tasksCompleted,
            tasksCreated: data.tasksCreated,
            notesWritten: data.notesWritten,
            wordsWritten: data.wordsWritten,
            capturesCount: data.capturesCount,
            aiTasksProcessed: data.aiTasksProcessed,
            projectsActive: data.projectsActive,
          },
          aiReport: aiReport.report,
          topAchievements: aiReport.achievements,
          focusAreas: aiReport.focusAreas,
          recommendations: aiReport.recommendations,
        });
      }
    }

    // Update last report timestamp
    await db.execute({
      sql: `UPDATE notification_preferences
            SET last_weekly_report = datetime('now'), updated_at = datetime('now')
            WHERE user_id = ?`,
      args: [userId],
    });

    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[DIGEST] Weekly report failed:", msg);
    return { success: false, error: msg };
  }
}

// ─── Helper ──────────────────────────────────────────

/**
 * `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` with no zone, which is UTC;
 * `new Date()` would read it as local time.
 */
function parseSqliteTimestamp(value: string): Date | null {
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekKey(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7
  );
  return `${now.getFullYear()}-W${weekNum}`;
}
