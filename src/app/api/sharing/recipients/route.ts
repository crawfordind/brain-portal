import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { shareErrorResponse } from "@/lib/sharing/http";
import { getSavedRecipients, setSavedRecipients } from "@/lib/sharing/store";

// GET /api/sharing/recipients - the accounts this user has named for sharing
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ recipients: await getSavedRecipients(user.id) });
}

// PUT /api/sharing/recipients - replace the list: { recipients: [{ label, email }] }
//
// Session only, on purpose. This list is what an MCP key may share with, so
// no MCP tool can edit it: an agent cannot add its own destination.
export async function PUT(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { recipients?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const recipients = await setSavedRecipients(user.id, body.recipients);
    return NextResponse.json({ recipients });
  } catch (error) {
    return shareErrorResponse(error, "Failed to save recipients");
  }
}
