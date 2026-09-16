import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { Capture } from "@/lib/db/schema";
import { safeParseJson, isErrorResponse, isValidCaptureType } from "@/lib/api/validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/captures/[id] - Get a single capture
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const capture = await queryOne<Capture>(
    "SELECT * FROM captures WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!capture) {
    return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  }

  return NextResponse.json({ capture });
}

// PUT /api/captures/[id] - Update a capture
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<Capture>(
    "SELECT * FROM captures WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  }

  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;
  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (body.captureType !== undefined && !isValidCaptureType(body.captureType)) {
    return NextResponse.json({ error: "Invalid capture type" }, { status: 400 });
  }

  if (body.content !== undefined) {
    updates.push("content = ?");
    args.push(typeof body.content === "string" ? body.content.trim() : String(body.content));
  }

  if (body.captureType !== undefined) {
    updates.push("capture_type = ?");
    args.push(body.captureType as string);
  }

  if (body.dailyNoteId !== undefined) {
    updates.push("daily_note_id = ?");
    args.push((body.dailyNoteId as string) || null);
  }

  if (body.isProcessed !== undefined) {
    updates.push("processed = ?");
    args.push(body.isProcessed ? 1 : 0);
  }

  if (body.tags !== undefined) {
    updates.push("tags = ?");
    args.push(JSON.stringify(body.tags));
  }

  if (updates.length === 0) {
    return NextResponse.json({ capture: existing });
  }

  args.push(id, user.id);

  await db.execute({
    sql: `UPDATE captures SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    args,
  });

  const capture = await queryOne<Capture>(
    "SELECT * FROM captures WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  return NextResponse.json({ capture });
}

// DELETE /api/captures/[id] - Delete a capture
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await queryOne<Capture>(
    "SELECT * FROM captures WHERE id = ? AND user_id = ?",
    [id, user.id]
  );

  if (!existing) {
    return NextResponse.json({ error: "Capture not found" }, { status: 404 });
  }

  await db.execute({
    sql: "DELETE FROM captures WHERE id = ? AND user_id = ?",
    args: [id, user.id],
  });

  return NextResponse.json({ success: true });
}
