import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProjectAccess, isOwner } from "@/lib/permissions";
import {
  createProjectInvite,
  getProjectCollaborators,
  sendInviteEmail,
} from "@/lib/collaborators";
import { createMagicLink } from "@/lib/auth/index";
import { getAppUrl } from "@/lib/app-url";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/collaborators - List collaborators (owner only)
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const access = await getProjectAccess(id, user.id);

  if (!isOwner(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const collaborators = await getProjectCollaborators(id);

  return NextResponse.json({
    collaborators,
    owner: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
}

// POST /api/projects/[id]/collaborators - Send invite (owner only)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const access = await getProjectAccess(id, user.id);

  if (!isOwner(access)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, role = "viewer" } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  if (!["editor", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Can't invite yourself
  if (email.toLowerCase().trim() === user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "You can't invite yourself" },
      { status: 400 }
    );
  }

  try {
    const { inviteToken, isResend } = await createProjectInvite(
      id,
      email,
      role as "editor" | "viewer",
      user.id
    );

    // Create magic link with 7-day expiry to match invite lifespan, then append invite token
    const baseUrl = getAppUrl({ requestOrigin: request.nextUrl.origin });
    const SEVEN_DAYS = 7 * 24 * 60 * 60;
    const magicLinkUrl = await createMagicLink(email.toLowerCase().trim(), baseUrl, SEVEN_DAYS);
    const inviteUrl = `${magicLinkUrl}&invite=${inviteToken}`;

    // Send invite email
    const inviterName = user.display_name || user.email;
    const emailSent = await sendInviteEmail(email, access!.project.name, inviterName, inviteUrl);

    if (!emailSent) {
      return NextResponse.json(
        { error: "Invite created but failed to send email. Check SMTP configuration." },
        { status: 500 }
      );
    }

    // Return updated collaborator list
    const collaborators = await getProjectCollaborators(id);

    return NextResponse.json({ collaborators, isResend }, { status: 201 });
  } catch (error) {
    console.error("Failed to send invite:", error);
    return NextResponse.json(
      { error: "Failed to send invite" },
      { status: 500 }
    );
  }
}
