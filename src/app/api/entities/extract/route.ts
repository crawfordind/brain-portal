import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { ingestSourceEntities } from "@/lib/entities/store";

// POST /api/entities/extract — run entity extraction over recent notes,
// building the canonical entity graph (entities, mentions, co-occurrence edges).
// Body: { daysBack?: number, limit?: number }
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { daysBack?: number; limit?: number } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — use defaults
  }

  const daysBack = Math.max(1, Math.min(365, Math.floor(Number(body.daysBack)) || 30));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit)) || 40));

  try {
    const notes = await queryAll<{
      id: string;
      title: string;
      content_plain: string | null;
      content: string;
      created_at: string;
      daily_date: string | null;
    }>(
      `SELECT n.id, n.title, n.content_plain, n.content, n.created_at, dn.date AS daily_date
       FROM notes n
       LEFT JOIN daily_notes dn ON dn.note_id = n.id
       WHERE n.user_id = ? AND n.is_archived = 0
         AND n.updated_at >= datetime('now', '-${daysBack} days')
       ORDER BY n.updated_at DESC
       LIMIT ?`,
      [user.id, limit]
    );

    let processed = 0;
    let entitiesFound = 0;
    let mentionsAdded = 0;
    let edges = 0;

    for (const note of notes) {
      const text = note.content_plain?.trim() || note.content || "";
      if (text.trim().length < 20) continue;

      const occurredAt = note.daily_date || note.created_at?.slice(0, 10) || null;
      const result = await ingestSourceEntities({
        userId: user.id,
        sourceType: "note",
        sourceId: note.id,
        title: note.title,
        text,
        occurredAt,
      });

      processed++;
      entitiesFound += result.entitiesFound;
      mentionsAdded += result.mentionsAdded;
      edges += result.edges;
    }

    return NextResponse.json({
      message: `Processed ${processed} note(s)`,
      notesProcessed: processed,
      entitiesFound,
      mentionsAdded,
      edges,
    });
  } catch (error) {
    console.error("Entity extraction error:", error);
    return NextResponse.json(
      { error: "Failed to extract entities" },
      { status: 500 }
    );
  }
}
