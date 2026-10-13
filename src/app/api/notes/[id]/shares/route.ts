import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAppUrl } from "@/lib/app-url";
import { getNoteAccess } from "@/lib/sharing/access";
import { shareErrorResponse } from "@/lib/sharing/http";
import { getSavedRecipients, listNoteShares, shareNote } from "@/lib/sharing/store";
import { isMissingNoteSharesTable } from "@/lib/sharing/schema";
import type { NoteShare } from "@/lib/sharing/store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function ownedNote(idOrSlug: string, userId: string) {
  const access = await getNoteAccess(idOrSlug, userId);
  // A collaborator who can open the note still may not share it onward.
  return access?.role === "owner" ? access.note : null;
}

// GET /api/notes/[id]/shares - everything the share dialog shows (owner only)
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await ownedNote(id, user.id);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  let shares: NoteShare[] = [];
  let accountSharingReady = true;
  try {
    shares = await listNoteShares(user.id, note.id);
  } catch (error) {
    if (!isMissingNoteSharesTable(error)) return shareErrorResponse(error, "Failed to load shares");
    accountSharingReady = false;
  }

  const recipients = await getSavedRecipients(user.id);
  const publicLink = note.share_token
    ? {
        url: `${getAppUrl({ requestOrigin: request.nextUrl.origin })}/shared/${note.share_token}`,
        sharedAt: note.shared_at,
      }
    : null;

  return NextResponse.json({ shares, recipients, publicLink, accountSharingReady });
}

// POST /api/notes/[id]/shares - share with an account: { email, permission? }
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await ownedNote(id, user.id);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  let body: { email?: unknown; permission?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  if (body.permission !== undefined && body.permission !== "view" && body.permission !== "edit") {
    return NextResponse.json({ error: "permission must be 'view' or 'edit'" }, { status: 400 });
  }

  try {
    const result = await shareNote({
      ownerId: user.id,
      noteId: note.id,
      email: body.email,
      permission: body.permission as "view" | "edit" | undefined,
      origin: { via: "app" },
    });
    return NextResponse.json(
      { share: result.share, created: result.created },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return shareErrorResponse(error, "Failed to share note");
  }
}
