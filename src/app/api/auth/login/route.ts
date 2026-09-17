import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { mayCreateAccount } from "@/lib/auth/signup-policy";
import { queryOne } from "@/lib/db/client";

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();

  // Rate limit: 5 login attempts per 15 minutes per IP
  const rateLimit = await checkRateLimit({
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) } }
    );
  }

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      console.log(`[AUTH] ✗ Invalid request - email is required`);
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Don't send a link to an address that could not sign in with it. Doing so
    // burns SMTP quota on strangers and turns this route into a mail relay.
    // The response is identical either way so it cannot be used to enumerate
    // which addresses have accounts.
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (!existingUser && !mayCreateAccount(normalizedEmail)) {
      return NextResponse.json({
        success: true,
        message: "Check your email for a sign-in link",
      });
    }

    // Get the base URL from the request
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    const magicLink = await createMagicLink(email, baseUrl);

    // Send email if SMTP is configured
    if (isEmailConfigured()) {

      const sent = await sendEmail({
        to: email,
        subject: "Sign in to Brain Portal",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 24px;">Sign in to Brain Portal</h2>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">Click the button below to sign in to your account:</p>
            <a href="${magicLink}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This link expires in 15 minutes.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn&apos;t request this email, you can safely ignore it.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            <p style="color: #999; font-size: 12px;">
              Brain Portal — Think clearly. Connect everything.
            </p>
          </div>
        `,
        text: `Sign in to Brain Portal\n\nClick this link to sign in: ${magicLink}\n\nThis link expires in 15 minutes.\n\nIf you didn't request this email, you can safely ignore it.`,
      });

      const totalDuration = Date.now() - requestStartTime;

      if (sent) {
        console.log(`[AUTH] ✓ Sign-in link sent (${totalDuration}ms)`);
        return NextResponse.json({
          success: true,
          message: "Check your email for a sign-in link"
        });
      } else {
        console.log(`[AUTH] ✗ Email send failed (${totalDuration}ms)`);
        return NextResponse.json(
          { error: "Failed to send email. Please try again." },
          { status: 500 }
        );
      }
    }

    // In development without SMTP, return the link directly
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({
        success: true,
        message: "Development mode - use the link below",
        magicLink,
      });
    }

    console.log(`[AUTH] ✗ Email service not configured`);
    return NextResponse.json(
      { error: "Email service not configured" },
      { status: 500 }
    );
  } catch (error) {
    const totalDuration = Date.now() - requestStartTime;
    console.error(
      `[AUTH] ✗ Login error after ${totalDuration}ms:`,
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Failed to send login email" },
      { status: 500 }
    );
  }
}
