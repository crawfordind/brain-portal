import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Insight } from "@/lib/db/schema";

// GET /api/insights - List all insights
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const status = searchParams.get("status"); // "new", "dismissed", "actioned"
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    let query = `
      SELECT i.*
      FROM insights i
      WHERE i.user_id = ?
    `;
    const args: (string | number)[] = [user.id];

    if (type) {
      query += " AND i.insight_type = ?";
      args.push(type);
    }

    // Map status filter to boolean columns
    if (status === "new") {
      query += " AND i.is_dismissed = FALSE AND i.is_actioned = FALSE";
    } else if (status === "dismissed") {
      query += " AND i.is_dismissed = TRUE";
    } else if (status === "actioned") {
      query += " AND i.is_actioned = TRUE";
    }

    // Feedback-aware ordering: downvoted insights sink, upvoted float,
    // otherwise most-recent first.
    query +=
      " ORDER BY (i.feedback = 'down') ASC, (i.feedback = 'up') DESC, i.generated_at DESC LIMIT ?";
    args.push(limit);

    const insights = await queryAll<Insight>(query, args);

    return NextResponse.json({ insights });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}

// PUT /api/insights - Update insight (dismiss/action)
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, action } = body; // action: "dismiss", "action", "restore", "upvote", "downvote", "clear_feedback"

    if (!id || !action) {
      return NextResponse.json({ error: "ID and action are required" }, { status: 400 });
    }

    const validActions = [
      "dismiss",
      "action",
      "restore",
      "upvote",
      "downvote",
      "clear_feedback",
    ];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const existing = await queryOne<Insight>(
      "SELECT * FROM insights WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    if (!existing) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    if (action === "dismiss") {
      await db.execute({
        sql: "UPDATE insights SET is_dismissed = TRUE WHERE id = ? AND user_id = ?",
        args: [id, user.id],
      });
    } else if (action === "action") {
      await db.execute({
        sql: "UPDATE insights SET is_actioned = TRUE, actioned_at = datetime('now') WHERE id = ? AND user_id = ?",
        args: [id, user.id],
      });
    } else if (action === "restore") {
      await db.execute({
        sql: "UPDATE insights SET is_dismissed = FALSE, is_actioned = FALSE, actioned_at = NULL WHERE id = ? AND user_id = ?",
        args: [id, user.id],
      });
    } else if (action === "upvote" || action === "downvote") {
      // Explicit taste signal — feeds computeTypeFeedbackBias() in generation.
      await db.execute({
        sql: "UPDATE insights SET feedback = ? WHERE id = ? AND user_id = ?",
        args: [action === "upvote" ? "up" : "down", id, user.id],
      });
    } else if (action === "clear_feedback") {
      await db.execute({
        sql: "UPDATE insights SET feedback = NULL WHERE id = ? AND user_id = ?",
        args: [id, user.id],
      });
    }

    const insight = await queryOne<Insight>(
      "SELECT * FROM insights WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    return NextResponse.json({ insight });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update insight" }, { status: 500 });
  }
}
