/**
 * POST /api/crm/contacts/[id]/resolve — act on the review queue from the app.
 *
 * Body, one of:
 *   { action: "merge", intoId }     this placeholder is that contact
 *                                   ("which Justin?" → this Justin)
 *   { action: "confirm", name? }    a new contact, optionally with a full name
 *   { action: "same" }              a flagged possible duplicate is the same
 *   { action: "different" }         ... or is a different person
 *
 * The MCP server had `resolve_contact` and `merge_contacts`; the web app had
 * no way to act on what it listed under "Needs review" at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decideMergeCandidate, resolveContact } from "@/lib/crm/merge";
import { StructureError } from "@/lib/crm/structure";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "merge": {
        if (typeof body.intoId !== "string" || !body.intoId) {
          return NextResponse.json({ error: "intoId is required" }, { status: 400 });
        }
        const result = await resolveContact(user.id, id, { mergeIntoId: body.intoId });
        return NextResponse.json({ entityId: result.entityId });
      }
      case "confirm": {
        const name = typeof body.name === "string" ? body.name : null;
        const result = await resolveContact(user.id, id, { confirmedName: name });
        return NextResponse.json({ entityId: result.entityId });
      }
      case "same":
      case "different": {
        const result = await decideMergeCandidate(user.id, id, body.action);
        return NextResponse.json({ entityId: result.entityId });
      }
      default:
        return NextResponse.json(
          { error: "action must be merge, confirm, same or different" },
          { status: 400 }
        );
    }
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to resolve contact" }, { status: 500 });
  }
}
