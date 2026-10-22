/**
 * POST /api/crm/contacts/[id]/not-contact — "this isn't a contact": file it
 *   as a tag (`{ tag? }`, default its name) on the notes and captures that
 *   mention it, and hide it from contacts.
 * DELETE /api/crm/contacts/[id]/not-contact — undo: it is a contact again.
 *
 * See `src/lib/crm/not-contact.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markNotContact, restoreContact } from "@/lib/crm/not-contact";
import { StructureError } from "@/lib/crm/structure";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function failure(e: unknown, fallback: string) {
  if (e instanceof StructureError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // An empty body means "use its name as the tag".
  }

  try {
    const result = await markNotContact(user.id, id, {
      tag: typeof body.tag === "string" ? body.tag : null,
    });
    return NextResponse.json({
      entityId: result.entity.id,
      tag: result.tag,
      tagged: result.tagged,
    });
  } catch (e) {
    return failure(e, "Failed to file it as a tag");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const entity = await restoreContact(user.id, id);
    return NextResponse.json({ entityId: entity.id });
  } catch (e) {
    return failure(e, "Failed to restore the contact");
  }
}
