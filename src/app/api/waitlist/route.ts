import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAppUrl } from "@/lib/app-url";
import { renderWaitlistJoinedEmail } from "@/lib/waitlist/emails";

export async function POST(request: NextRequest) {
  // Unauthenticated, and it sends an email per new address — without a limit
  // this route is a spam relay funded by the operator's SMTP quota.
  const rateLimit = await checkRateLimit({
    bucket: "waitlist",
    maxRequests: 3,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  try {
    // Check for existing entry
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM waitlist WHERE email = ?",
      [email]
    );

    if (existing) {
      // Silently succeed — don't expose whether email was already on the list
      return NextResponse.json({ success: true });
    }

    await db.execute({
      sql: "INSERT INTO waitlist (email) VALUES (?)",
      args: [email],
    });
  } catch (error) {
    // A JSON error, not Next's HTML 500: the form shows `error` to the person,
    // and an HTML body used to surface as "Network error".
    console.error("[WAITLIST] Could not record signup:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "We couldn't save that just now. Please try again in a minute." },
      { status: 500 }
    );
  }

  // The address is on the list whether or not the confirmation goes out, so a
  // mail failure is logged (inside sendEmail) rather than reported as a failure.
  if (isEmailConfigured()) {
    await sendEmail({ to: email, ...renderWaitlistJoinedEmail({ appUrl: getAppUrl() }) });
  }

  return NextResponse.json({ success: true });
}
