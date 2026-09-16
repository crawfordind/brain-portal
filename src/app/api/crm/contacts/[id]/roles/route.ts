/**
 * Contact roles at ventures.
 *
 * The edge reads source -> edge_type -> target, with the person as source. A
 * contact may hold several roles and be attached to several ventures, which is
 * the point of one Rolodex across several businesses, so POST adds rather than
 * replaces.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  isContactRole,
  listContactRoles,
  removeContactRole,
  setContactRole,
  StructureError,
} from "@/lib/crm/structure";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    return NextResponse.json({ roles: await listContactRoles(user.id, id) });
  } catch {
    return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const body = await request.json();
    const role = String(body.role ?? "");
    if (!isContactRole(role)) {
      return NextResponse.json(
        { error: `"${role}" is not a contact role` },
        { status: 400 }
      );
    }
    if (!body.ventureId) {
      return NextResponse.json({ error: "ventureId is required" }, { status: 400 });
    }

    await setContactRole(user.id, id, String(body.ventureId), role, body.note);
    return NextResponse.json({ roles: await listContactRoles(user.id, id) });
  } catch (e) {
    if (e instanceof StructureError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Failed to set role" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const ventureId = sp.get("ventureId");
  const role = sp.get("role");

  if (!ventureId || !role || !isContactRole(role)) {
    return NextResponse.json(
      { error: "ventureId and a valid role are required" },
      { status: 400 }
    );
  }

  try {
    const removed = await removeContactRole(user.id, id, ventureId, role);
    return NextResponse.json({
      removed,
      roles: await listContactRoles(user.id, id),
    });
  } catch {
    return NextResponse.json({ error: "Failed to remove role" }, { status: 500 });
  }
}
