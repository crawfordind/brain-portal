import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess, isOwner } from "@/lib/permissions";
import {
  updateCollaboratorRole,
  removeCollaborator,
  getProjectCollaborators,
} from "@/lib/collaborators";

interface RouteParams {
  params: Promise<{ id: string; collaboratorId: string }>;
}

// PATCH /api/projects/[id]/collaborators/[collaboratorId] - Update role (owner only)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, collaboratorId } = await params;
  const access = await getProjectAccess(id, user.id);

  if (!isOwner(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { role } = body;

  if (!["editor", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  await updateCollaboratorRole(collaboratorId, id, role);

  const collaborators = await getProjectCollaborators(id);
  return NextResponse.json({ collaborators });
}

// DELETE /api/projects/[id]/collaborators/[collaboratorId] - Remove collaborator (owner only)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, collaboratorId } = await params;
  const access = await getProjectAccess(id, user.id);

  if (!isOwner(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await removeCollaborator(collaboratorId, id);

  const collaborators = await getProjectCollaborators(id);
  return NextResponse.json({ collaborators });
}
