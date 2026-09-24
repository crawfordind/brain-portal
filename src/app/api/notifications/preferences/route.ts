import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationPreferences } from "@/lib/notifications/engine";
import { safeTimeZone } from "@/lib/email/when";

// GET /api/notifications/preferences
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prefs = await getNotificationPreferences(user.id);
  return NextResponse.json({ preferences: prefs });
}

// PATCH /api/notifications/preferences
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Ensure preferences exist
  await getNotificationPreferences(user.id);

  // Build update dynamically from allowed fields
  const allowedFields = [
    "email_enabled",
    "email_reminders",
    "email_overdue_tasks",
    "email_daily_digest",
    "email_weekly_report",
    "email_agent_updates",
    "daily_digest_hour",
    "weekly_report_day",
    "quiet_hours_start",
    "quiet_hours_end",
    "timezone",
    "overdue_reminder_hours",
    "due_soon_hours",
    "ai_digest_enabled",
    "ai_weekly_enabled",
  ];

  const updates: string[] = [];
  const args: (string | number | boolean)[] = [];

  // An invalid zone would make every date an email computes fall back to
  // UTC silently, so reject it here where the user can see the error.
  if (body.timezone !== undefined && (typeof body.timezone !== "string" || safeTimeZone(body.timezone) !== body.timezone)) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      args.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  args.push(user.id);

  await db.execute({
    sql: `UPDATE notification_preferences SET ${updates.join(", ")} WHERE user_id = ?`,
    args,
  });

  const prefs = await getNotificationPreferences(user.id);
  return NextResponse.json({ preferences: prefs });
}
