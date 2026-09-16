import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

// GET /api/insights/status — Liveness/health of the insight generation job.
//
// Surfaces "last insight generated N days ago" so a silently-dead generation
// job is visible instead of the section simply going empty. Also powers the
// dead-man's-switch heartbeat (`stale_insights` rule).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const STALE_DAYS = 7;

  try {
    const stats = await queryOne<{
      last_generated_at: string | null;
      total: number;
      recent_notes: number;
    }>(
      `SELECT
         (SELECT MAX(generated_at) FROM insights WHERE user_id = ?) AS last_generated_at,
         (SELECT COUNT(*) FROM insights WHERE user_id = ?) AS total,
         (SELECT COUNT(*) FROM notes
           WHERE user_id = ? AND is_archived = 0
             AND datetime(updated_at) >= datetime('now', '-7 days')) AS recent_notes`,
      [user.id, user.id, user.id]
    );

    const lastGeneratedAt = stats?.last_generated_at || null;
    const totalInsights = Number(stats?.total || 0);
    const recentNotes = Number(stats?.recent_notes || 0);

    const daysSinceLastInsight = lastGeneratedAt
      ? Math.floor(
          (Date.now() - new Date(lastGeneratedAt + "Z").getTime()) /
            (24 * 60 * 60 * 1000)
        )
      : null;

    // Stale only matters when there is fresh material insights should cover.
    const hasFreshMaterial = recentNotes >= 3;
    const isStale =
      hasFreshMaterial &&
      (daysSinceLastInsight === null || daysSinceLastInsight >= STALE_DAYS);

    return NextResponse.json({
      lastGeneratedAt,
      daysSinceLastInsight,
      totalInsights,
      isStale,
      staleThresholdDays: STALE_DAYS,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch insight status" },
      { status: 500 }
    );
  }
}
