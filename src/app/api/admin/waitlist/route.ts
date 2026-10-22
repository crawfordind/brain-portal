import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, db } from "@/lib/db/client";
import { requireAdmin } from "@/lib/auth/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { getAppUrl } from "@/lib/app-url";
import { renderWaitlistApprovedEmail } from "@/lib/waitlist/emails";

interface WaitlistEntry {
  id: string;
  email: string;
  source: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await query<WaitlistEntry>(
    "SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 500"
  );

  return NextResponse.json({ entries });
}

const STATUSES = new Set(["pending", "approved", "rejected"]);

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: unknown; status?: unknown; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : undefined;
  const notes = typeof body.notes === "string" ? body.notes : undefined;

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }
  if (status !== undefined && !STATUSES.has(status)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  }

  const entry = await queryOne<WaitlistEntry>("SELECT * FROM waitlist WHERE id = ?", [id]);
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Build update
  const updates: string[] = [];
  const args: (string | null)[] = [];

  if (status) {
    updates.push("status = ?");
    args.push(status);
  }
  if (notes !== undefined) {
    updates.push("notes = ?");
    args.push(notes);
  }

  updates.push("updated_at = datetime('now')");
  args.push(id);

  await db.execute({
    sql: `UPDATE waitlist SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  if (status !== "approved") {
    return NextResponse.json({ success: true });
  }

  // Approval creates the account. Signups are closed by default
  // (signup-policy.ts) and only existing users may sign in under `closed`, so
  // approving used to send "your access is ready" to someone the login route
  // would then silently refuse. Creating the row is what `npm run user:create`
  // does; an admin approving an address is the same deliberate act.
  const address = entry.email.trim().toLowerCase();
  await db.execute({
    sql: "INSERT INTO users (email) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ?)",
    args: [address, address],
  });

  let emailed = false;
  if (isEmailConfigured()) {
    emailed = await sendEmail({
      to: address,
      ...renderWaitlistApprovedEmail({ appUrl: getAppUrl(), email: address }),
    });
  }

  // `emailed` lets the admin page say what actually happened instead of
  // claiming a message was sent when SMTP is not configured or failed.
  return NextResponse.json({ success: true, accountCreated: true, emailed });
}
