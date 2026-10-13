import { NextRequest, NextResponse } from "next/server";
import { verifySignInCode } from "@/lib/auth";
import type { SignInCodeFailure } from "@/lib/auth/magic-link";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Sign in with the six-digit code from the sign-in email.
 *
 * The code lets the email be read on one device and typed on another, which a
 * link cannot do: opening a link signs in whichever browser opened it.
 * Guessing is bounded twice: per IP here, and per code in `verifySignInCode`
 * (five wrong tries and that code stops working; its link does not).
 */

const SESSION_COOKIE = "brain_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const MESSAGES: Record<SignInCodeFailure, string> = {
  wrong_code: "That code isn't right. Check the newest email and try again.",
  locked: "Too many wrong codes. Use the link in the email, or request a new code.",
  expired: "That code has expired or was already used. Request a new one.",
  not_allowed: "This server only signs in existing accounts. Ask the person who runs it to add your address.",
};

/** Same-origin paths only, so the response cannot be used as an open redirect. */
function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

export async function POST(request: NextRequest) {
  // Its own bucket: typing codes must not spend the budget for requesting them.
  const rateLimit = await checkRateLimit({
    bucket: "auth-code",
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again.", reason: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)) } }
    );
  }

  let body: { email?: unknown; code?: unknown; redirect?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter your email and the code from it." }, { status: 400 });
  }

  const { email, code } = body;
  if (typeof email !== "string" || !email.trim() || typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "Enter your email and the code from it." }, { status: 400 });
  }

  try {
    const result = await verifySignInCode(email, code);

    if (!result.ok) {
      return NextResponse.json(
        { error: MESSAGES[result.reason], reason: result.reason, attemptsLeft: result.attemptsLeft },
        { status: result.reason === "not_allowed" ? 403 : 400 }
      );
    }

    const response = NextResponse.json({ success: true, redirect: safeRedirect(body.redirect) });
    response.cookies.set(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Sign-in code error:", error);
    return NextResponse.json({ error: "Couldn't check the code. Please try again." }, { status: 500 });
  }
}
