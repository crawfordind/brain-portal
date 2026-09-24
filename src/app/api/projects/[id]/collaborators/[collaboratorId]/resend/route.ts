import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess, isOwner } from "@/lib/permissions";
import {
  createProjectInvite,
  getProjectCollaborators,
  sendInviteEmail,
} from "@/lib/collaborators";
import { createMagicLink } from "@/lib/auth/index";
import { queryOne } from "@/lib/db/client";
import type { ProjectCollaborator } from "@/lib/db/schema";
import { getAppUrl } from "@/lib/app-url";

interface RouteParams {
  params: Promise<{ id: string; collaboratorId: string }>;
}

// POST /api/projects/[id]/collaborators/[collaboratorId]/resend - Resend invite
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, collaboratorId } = await params;
  const access = await getProjectAccess(id, user.id);

  if (!isOwner(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get the existing collaborator to find their email
  const collab = await queryOne<ProjectCollaborator>(
    "SELECT * FROM project_collaborators WHERE id = ? AND project_id = ? AND status = 'pending'",
    [collaboratorId, id]
  );

  if (!collab) {
    return NextResponse.json(
      { error: "Pending invite not found" },
      { status: 404 }
    );
  }

  try {
    const { inviteToken } = await createProjectInvite(
      id,
      collab.email,
      collab.role,
      user.id
    );

    const baseUrl = getAppUrl({ requestOrigin: request.nextUrl.origin });
    const SEVEN_DAYS = 7 * 24 * 60 * 60;
    const magicLinkUrl = await createMagicLink(collab.email, baseUrl, SEVEN_DAYS);
    const inviteUrl = `${magicLinkUrl}&invite=${inviteToken}`;

    const inviterName = user.display_name || user.email;
    const emailSent = await sendInviteEmail(collab.email, access!.project.name, inviterName, inviteUrl);

    if (!emailSent) {
      return NextResponse.json(
        { error: "Failed to resend invite email. Check SMTP configuration." },
        { status: 500 }
      );
    }

    const collaborators = await getProjectCollaborators(id);
    return NextResponse.json({ collaborators });
  } catch (error) {
    console.error("Failed to resend invite:", error);
    return NextResponse.json(
      { error: "Failed to resend invite" },
      { status: 500 }
    );
  }
}
