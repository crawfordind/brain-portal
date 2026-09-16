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
    const currentHour = new Date().getUTCHours();
    const currentDay = new Date().getUTCDay(); // 0=Sunday, 1=Monday...

    for (const user of users) {
      try {
        const prefs = await getNotificationPreferences(user.id);

        // Daily digest check
        if (prefs.email_daily_digest && prefs.ai_digest_enabled) {
          if (prefs.daily_digest_hour === currentHour) {
            const digestResult = await generateAndSendDailyDigest(user.id);
            if (digestResult.success) {
              results.digests.sent++;
            } else if (digestResult.error) {
              results.digests.errors.push(digestResult.error);
            }
          }
        }

        // Weekly report check (default: Monday)
        if (prefs.email_weekly_report && prefs.ai_weekly_enabled) {
          if (
            prefs.weekly_report_day === currentDay &&
            prefs.daily_digest_hour === currentHour
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
