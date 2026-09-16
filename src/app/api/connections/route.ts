import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import type { Note } from "@/lib/db/schema";

// POST /api/connections - Manually create a connection between two notes
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sourceNoteId, targetNoteId, connectionType = "related", reason } = body;

    if (!sourceNoteId || !targetNoteId) {
      return NextResponse.json(
        { error: "sourceNoteId and targetNoteId are required" },
        { status: 400 }
      );
    }

    if (sourceNoteId === targetNoteId) {
      return NextResponse.json(
        { error: "Cannot create connection to self" },
        { status: 400 }
      );
    }

    // Verify both notes exist and belong to user
    const sourceNote = await queryOne<Note>(
      "SELECT id FROM notes WHERE id = ? AND user_id = ?",
      [sourceNoteId, user.id]
    );

    const targetNote = await queryOne<Note>(
      "SELECT id FROM notes WHERE id = ? AND user_id = ?",
      [targetNoteId, user.id]
    );

    if (!sourceNote || !targetNote) {
      return NextResponse.json(
        { error: "One or both notes not found" },
        { status: 404 }
      );
    }

    // Validate connection type
    const validTypes = ["related", "references", "extends", "contradicts", "supports"];
    if (!validTypes.includes(connectionType)) {
      return NextResponse.json(
        { error: "Invalid connection type" },
        { status: 400 }
      );
    }

    // Create the connection
    const connectionId = uuidv4();
    await db.execute({
      sql: `INSERT INTO note_connections
            (id, user_id, source_note_id, target_note_id,
             connection_type, strength, reason, discovery_method, is_manual, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', TRUE, datetime('now'))`,
      args: [
        connectionId,
        user.id,
        sourceNoteId,
        targetNoteId,
        connectionType,
        1.0, // Manual connections have full strength
        reason || null
      ]
    });

    // Fetch the created connection with note details
    const connection = await queryOne(
      `SELECT
        nc.*,
        sn.title as source_title,
        tn.title as target_title
       FROM note_connections nc
       JOIN notes sn ON nc.source_note_id = sn.id
       JOIN notes tn ON nc.target_note_id = tn.id
       WHERE nc.id = ?`,
      [connectionId]
    );

    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    console.error("Failed to create connection:", error);
    return NextResponse.json(
      { error: "Failed to create connection" },
      { status: 500 }
    );
  }
}

// GET /api/connections - List all connections for the user
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const noteId = searchParams.get("noteId");

    let sql = `
      SELECT
        nc.*,
        sn.title as source_title,
        sn.slug as source_slug,
        tn.title as target_title,
        tn.slug as target_slug
      FROM note_connections nc
      JOIN notes sn ON nc.source_note_id = sn.id
      JOIN notes tn ON nc.target_note_id = tn.id
      WHERE nc.user_id = ?
    `;
    const args: string[] = [user.id];

    // Filter by specific note (connections from or to this note)
    if (noteId) {
      sql += ` AND (nc.source_note_id = ? OR nc.target_note_id = ?)`;
      args.push(noteId, noteId);
    }

    sql += ` ORDER BY nc.created_at DESC LIMIT 500`;

    const result = await db.execute({ sql, args });
    const connections = result.rows;

    return NextResponse.json({ connections });
  } catch (error) {
    console.error("Failed to fetch connections:", error);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}
