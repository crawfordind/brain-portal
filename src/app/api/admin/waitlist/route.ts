import { NextRequest, NextResponse } from "next/server";
import { query, db } from "@/lib/db/client";
import { requireAdmin } from "@/lib/auth/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { getAppUrl } from "@/lib/app-url";

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

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { id, status, notes } = body as {
    id: string;
    status?: string;
    notes?: string;
  };

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
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

  // If approving, send approval email with login link
  if (status === "approved") {
    const entry = await query<WaitlistEntry>(
      "SELECT * FROM waitlist WHERE id = ?",
      [id]
    );

    if (entry[0] && isEmailConfigured()) {
      const appUrl = getAppUrl();
      const loginUrl = `${appUrl}/auth/login`;

      await sendEmail({
        to: entry[0].email,
        subject: "You're in — Brain Portal",
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#05050a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">

    <!-- Logo mark -->
    <div style="margin-bottom:40px;">
      <div style="display:inline-flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#0f766e,#0d9488);border-radius:8px;"></div>
        <span style="color:#fff;font-size:15px;font-weight:600;letter-spacing:-0.02em;">Brain Portal</span>
      </div>
    </div>

    <!-- Headline -->
    <h1 style="color:#fff;font-size:28px;font-weight:700;letter-spacing:-0.03em;margin:0 0 16px;">
      Your access is ready.
    </h1>
    <p style="color:#a1a1aa;font-size:16px;line-height:1.7;margin:0 0 32px;">
      You've been approved for early access to Brain Portal. Your private, AI-powered knowledge system is waiting for you.
    </p>

    <!-- CTA Button -->
    <div style="margin-bottom:40px;">
      <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#0f766e,#0d9488);color:#fff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:-0.01em;">
        Sign In to Get Started
      </a>
    </div>

    <p style="color:#71717a;font-size:14px;line-height:1.7;margin:0 0 40px;">
      Click the button above, enter your email, and we'll send you a magic link — no password needed.
    </p>

    <!-- Divider -->
    <div style="height:1px;background:#1c1c2e;margin-bottom:32px;"></div>

    <!-- Footer -->
    <p style="color:#3f3f46;font-size:12px;line-height:1.6;margin:0;">
      You're receiving this because you requested early access at ${appUrl}/waitlist.<br>
      Brain Portal &middot; Think clearly. Connect everything.
    </p>

  </div>
</body>
</html>
        `.trim(),
        text: `Your access is ready — Brain Portal\n\nYou've been approved for early access. Sign in to get started:\n\n${loginUrl}\n\nClick the link, enter your email, and we'll send you a magic link — no password needed.\n\nBrain Portal · Think clearly. Connect everything.`,
      });
    }
  }

  return NextResponse.json({ success: true });
}
