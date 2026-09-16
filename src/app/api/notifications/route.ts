import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne, db } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { Notification } from "@/lib/db/schema";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";

// GET /api/notifications - List notifications with filtering
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const unreadOnly = searchParams.get("unread") === "true";
    const countOnly = searchParams.get("countOnly") === "true";
    const type = searchParams.get("type");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Fast path: return only the unread count without fetching rows
    if (countOnly) {
      const countResult = await queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0 AND is_archived = 0",
        [user.id]
      );
      return NextResponse.json({ unreadCount: countResult?.count || 0 });
    }

    let sql = `
      SELECT * FROM notifications
      WHERE user_id = ? AND is_archived = 0
    `;
    const args: (string | number)[] = [user.id];

    if (unreadOnly) {
      sql += " AND is_read = 0";
    }

    if (type) {
      sql += " AND type = ?";
      args.push(type);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const [listResult, countResult] = await db.batch([
      { sql, args },
      {
        sql: "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0 AND is_archived = 0",
        args: [user.id],
      },
    ]);

    const notifications = listResult.rows as unknown as Notification[];
    const unreadCount = (countResult.rows[0] as Record<string, number> | undefined)?.count || 0;

    return NextResponse.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

// PATCH /api/notifications - Bulk operations (mark read, archive)
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const { action, ids } = body as {
    action: "mark_read" | "mark_all_read" | "archive" | "archive_all_read";
    ids?: string[];
  };

  const validActions = ["mark_read", "mark_all_read", "archive", "archive_all_read"];
  if (!action || !validActions.includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if ((action === "mark_read" || action === "archive") && ids !== undefined && !Array.isArray(ids)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  try {
    switch (action) {
      case "mark_read":
        if (ids?.length) {
          const placeholders = ids.map(() => "?").join(",");
          await db.execute({
            sql: `UPDATE notifications SET is_read = 1, read_at = datetime('now')
                  WHERE user_id = ? AND id IN (${placeholders})`,
            args: [user.id, ...ids],
          });
        }
        break;

      case "mark_all_read":
        await db.execute({
          sql: `UPDATE notifications SET is_read = 1, read_at = datetime('now')
                WHERE user_id = ? AND is_read = 0`,
          args: [user.id],
        });
        break;

      case "archive":
        if (ids?.length) {
          const placeholders = ids.map(() => "?").join(",");
          await db.execute({
            sql: `UPDATE notifications SET is_archived = 1, archived_at = datetime('now')
                  WHERE user_id = ? AND id IN (${placeholders})`,
            args: [user.id, ...ids],
          });
        }
        break;

      case "archive_all_read":
        await db.execute({
          sql: `UPDATE notifications SET is_archived = 1, archived_at = datetime('now')
                WHERE user_id = ? AND is_read = 1 AND is_archived = 0`,
          args: [user.id],
        });
        break;
    }

    const countResult = await queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0 AND is_archived = 0",
      [user.id]
    );

    return NextResponse.json({
      success: true,
      unreadCount: countResult?.count || 0,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
