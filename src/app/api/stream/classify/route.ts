/**
 * Stream Classification API
 *
 * POST: Classify raw user input into intent + suggested actions
 * Used by the Brain Bar for real-time classification as user types.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { classifyIntent } from "@/lib/stream/classifier";
import { query } from "@/lib/db/client";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { input } = await req.json();

    if (!input || typeof input !== "string" || input.trim().length === 0) {
      return NextResponse.json({ error: "Input required" }, { status: 400 });
    }

    // Get context for better classification
    const [activeProjects, recentTasks, recentNotes] = await Promise.all([
      query<{ slug: string; name: string }>(
        "SELECT slug, name FROM projects WHERE user_id = ? AND status = 'active' LIMIT 10",
        [user.id]
      ),
      query<{ type: string; title: string }>(
        "SELECT 'task' as type, COALESCE(title, content) as title FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
        [user.id]
      ),
      query<{ type: string; title: string }>(
        "SELECT 'note' as type, title FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5",
        [user.id]
      ),
    ]);
    const recentItems = [...recentTasks, ...recentNotes];

    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";

    const classification = await classifyIntent(input.trim(), {
      activeProjects,
      recentItems,
      timeOfDay,
    });

    return NextResponse.json(classification);
  } catch (error) {
    console.error("[Classify API] Error:", error);
    return NextResponse.json(
      { error: "Classification failed" },
      { status: 500 }
    );
  }
}
