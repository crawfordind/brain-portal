import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";
import { mayCreateAccount } from "@/lib/auth/signup-policy";
import { queryOne } from "@/lib/db/client";
import { getAppUrl } from "@/lib/app-url";
import { describeMinutes, magicLinkTtlMinutes, normalizeEmail } from "@/lib/auth/magic-link";

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();

  // Rate limit: 5 login attempts per 15 minutes per IP
  // Its own bucket, so chat or link clicks from the same IP cannot use it up.
  const rateLimit = await checkRateLimit({
    bucket: "auth-login",
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
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Don't send a link to an address that could not sign in with it. Doing so
    // burns SMTP quota on strangers and turns this route into a mail relay.
    // The response is identical either way so it cannot be used to enumerate
    // which addresses have accounts.
    // lower(email): accounts created before addresses were normalised may be
    // stored with capitals, and a phone keyboard capitalises the first letter.
    const normalizedEmail = normalizeEmail(email);
    const existingUser = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = ?",
      [normalizedEmail]
    );

    if (!existingUser && !mayCreateAccount(normalizedEmail)) {
      return NextResponse.json({
        success: true,
        message: "Check your email for a sign-in link",
      });
    }

    // The configured origin, not the Host header: the Host header is supplied
    // by the client, so trusting it let anyone request a sign-in email whose
    // link pointed at a domain of their choosing (the token rides along).
    // The request origin is only a fallback for local development.
    const baseUrl = getAppUrl({ requestOrigin: request.nextUrl.origin });

    const magicLink = await createMagicLink(normalizedEmail, baseUrl);
    const lifetime = describeMinutes(magicLinkTtlMinutes());

    // Send email if SMTP is configured
    if (isEmailConfigured()) {

      const sent = await sendEmail({
        to: normalizedEmail,
        subject: "Sign in to Brain Portal",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 24px;">Sign in to Brain Portal</h2>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">Click the button below to sign in to your account:</p>
            <a href="${magicLink}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This link works once and expires in ${lifetime}. If you asked for more than one, any of them will work.
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
        text: `Sign in to Brain Portal\n\nClick this link to sign in: ${magicLink}\n\nThis link works once and expires in ${lifetime}.\n\nIf you didn't request this email, you can safely ignore it.`,
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
