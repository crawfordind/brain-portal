import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import {
  runNotificationScanAllUsers,
  getNotificationPreferences,
} from "@/lib/notifications/engine";
import {
  generateAndSendDailyDigest,
  generateAndSendWeeklyReport,
} from "@/lib/notifications/digest";
import { verifyCronSecret } from "@/lib/api/validation";
import { hourInTimeZone, safeTimeZone } from "@/lib/email/when";

/** Day of week (0 = Sunday) as seen from `timeZone`. */
function dayInTimeZone(now: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * Cron endpoint for processing notifications
 *
 * Run every 5-15 minutes. Handles:
 * 1. Notification scan (reminders, overdue tasks, agent updates, etc.)
 * 2. Daily digest generation (at user's preferred hour)
 * 3. Weekly report generation (on user's preferred day)
 *
 * Secured via CRON_SECRET environment variable.
 * Deploy with Vercel Cron, external cron service, or call manually.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    scan: { usersScanned: 0, totalNotifications: 0, totalEmails: 0, errors: [] as string[] },
    digests: { sent: 0, errors: [] as string[] },
    weeklyReports: { sent: 0, errors: [] as string[] },
  };

  try {
    // 1. Run notification scan for all users
    results.scan = await runNotificationScanAllUsers();

    // 2. Check if any users need their daily digest
    const users = await queryAll<{ id: string }>("SELECT id FROM users");
    const now = new Date();

    for (const user of users) {
      try {
        const prefs = await getNotificationPreferences(user.id);
        // Digest hour and report day are the user's wall clock, not UTC's.
        const timeZone = safeTimeZone(prefs.timezone);
        const currentHour = hourInTimeZone(now, timeZone);
        const currentDay = dayInTimeZone(now, timeZone);

        // Daily digest check. "At or after" the chosen hour, not "during" it:
        // a single missed cron run used to skip that day's digest entirely.
        // generateAndSendDailyDigest() is once-per-day on its own. Turning the
        // AI summary off no longer turns the whole digest off with it.
        if (prefs.email_daily_digest) {
          if (currentHour >= prefs.daily_digest_hour) {
            const digestResult = await generateAndSendDailyDigest(user.id);
            if (digestResult.success) {
              results.digests.sent++;
            } else if (digestResult.error) {
              results.digests.errors.push(digestResult.error);
            }
          }
        }

        // Weekly report check (default: Monday)
        if (prefs.email_weekly_report) {
          if (
            prefs.weekly_report_day === currentDay &&
            currentHour >= prefs.daily_digest_hour
          ) {
            const reportResult = await generateAndSendWeeklyReport(user.id);
            if (reportResult.success) {
              results.weeklyReports.sent++;
            } else if (reportResult.error) {
              results.weeklyReports.errors.push(reportResult.error);
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results.digests.errors.push(`User ${user.id}: ${msg}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.scan.errors.push(msg);
  }

  const duration = Date.now() - startTime;

  console.log(
    `[CRON] Notifications processed in ${duration}ms:`,
    `${results.scan.totalNotifications} notifications,`,
    `${results.scan.totalEmails} emails,`,
    `${results.digests.sent} digests,`,
    `${results.weeklyReports.sent} weekly reports`
  );

  return NextResponse.json({
    success: true,
    duration_ms: duration,
    ...results,
  });
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
