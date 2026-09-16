import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { runNotificationScan } from "@/lib/notifications/engine";

/**
 * POST /api/notifications/scan
 *
 * Client-triggered notification scan for the current user.
 * Runs all notification scanners (reminders, overdue tasks, agent updates, etc.)
 * Called on app load and periodically from the client to ensure notifications
 * are generated without relying on an external cron service.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotificationScan(user.id);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[NOTIF SCAN] Error:", error);
    return NextResponse.json(
      { error: "Scan failed" },
      { status: 500 }
    );
  }
}
