/**
 * PUT /api/crm/structure/move
 *
 * Body: { kind: "product" | "project", id, ventureId | null }
 *
 * Moves a member between ventures, or detaches it with a null ventureId.
 * Existing interactions are NOT rewritten: they keep the venture they were
 * logged under, because a move must not change what happened in the past. See
 * src/lib/crm/structure.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  moveToVenture,
  StructureError,
  type MemberKind,
} from "@/lib/crm/structure";

export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const kind = body.kind as MemberKind;

    if (kind !== "product" && kind !== "project") {
      return NextResponse.json(
        { error: 'kind must be "product" or "project"' },
        { status: 400 }
      );
    }
    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const ventureId =
      body.ventureId === null || body.ventureId === undefined
        ? null
        : String(body.ventureId);

    await moveToVenture(user.id, kind, body.id, ventureId);

    return NextResponse.json({
      ok: true,
      // Say it out loud in the response so a client can show the reassurance.
      historyPreserved: true,
      message: ventureId
        ? "Moved. Past interactions keep the venture they were logged under."
        : "Unassigned. Past interactions keep the venture they were logged under.",
    });
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to move" }, { status: 500 });
  }
}
