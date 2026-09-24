import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { queryOne, mutate } from "@/lib/db/client";
import type { Note } from "@/lib/db/schema";
import { getAppUrl } from "@/lib/app-url";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/notes/[id]/share - Enable sharing and generate token
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify note ownership
  const note = await queryOne<Note>(
    "SELECT * FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  try {
    // If already shared, return existing token
    if (note.share_token) {
      const shareUrl = `${getAppUrl({ requestOrigin: request.nextUrl.origin })}/shared/${note.share_token}`;
      return NextResponse.json({
        shareUrl,
        token: note.share_token,
      });
    }

    // Generate new token
    const token = randomUUID();
    const shareUrl = `${getAppUrl({ requestOrigin: request.nextUrl.origin })}/shared/${token}`;

    // Update database with share_token and shared_at
    await mutate(
      `UPDATE notes
       SET share_token = ?,
           shared_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [token, id, user.id]
    );

    return NextResponse.json({ shareUrl, token });
  } catch (error) {
    console.error("Failed to enable sharing:", error);
    return NextResponse.json(
      { error: "Failed to enable sharing" },
      { status: 500 }
    );
  }
}

// DELETE /api/notes/[id]/share - Revoke sharing
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify note ownership
  const note = await queryOne<Note>(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  try {
    // Set share_token and shared_at to NULL
    await mutate(
      `UPDATE notes
       SET share_token = NULL,
           shared_at = NULL,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to revoke sharing:", error);
    return NextResponse.json(
      { error: "Failed to revoke sharing" },
      { status: 500 }
    );
  }
}

// PUT /api/notes/[id]/share - Regenerate token
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify note ownership
  const note = await queryOne<Note>(
    "SELECT id FROM notes WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  try {
    // Generate new UUID v4 token
    const token = randomUUID();
    const shareUrl = `${getAppUrl({ requestOrigin: request.nextUrl.origin })}/shared/${token}`;

    // Update database (old token auto-invalidated)
    await mutate(
      `UPDATE notes
       SET share_token = ?,
           shared_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?
       RETURNING *`,
      [token, id, user.id]
    );

    return NextResponse.json({ shareUrl, token });
  } catch (error) {
    console.error("Failed to regenerate token:", error);
    return NextResponse.json(
      { error: "Failed to regenerate token" },
      { status: 500 }
    );
  }
}
