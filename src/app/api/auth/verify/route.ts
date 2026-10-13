import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, getCurrentUser } from "@/lib/auth";
import { normalizeEmail, type MagicLinkFailure } from "@/lib/auth/magic-link";
import { acceptProjectInvite } from "@/lib/collaborators";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Spends a sign-in link and starts a session.
 *
 * - GET never spends anything. Mail scanners (Outlook Safe Links, Defender,
 *   corporate gateways) and link previews fetch every URL in a message before
 *   the recipient sees it. When a GET signed in, the scanner used the one-time
 *   link and the user's own click landed on "expired or already used". A GET
 *   here is sent to `/auth/verify`, the page a real browser posts from.
 * - POST does the work. It is what `/auth/verify` submits.
 */

const SESSION_COOKIE = "brain_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const ERROR_REASON: Record<MagicLinkFailure, string> = {
  invalid: "invalid_token",
  used: "link_used",
  expired: "link_expired",
  not_allowed: "not_allowed",
};

function redirectTo(path: string, request: NextRequest): NextResponse {
  // 303 so the browser follows a POST with a GET.
  return NextResponse.redirect(new URL(path, request.url), 303);
}

async function readParams(request: NextRequest): Promise<{ token: string | null; email: string | null; invite: string | null }> {
  const query = request.nextUrl.searchParams;
  let token = query.get("token");
  let email = query.get("email");
  let invite = query.get("invite");

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const field = (name: string) => {
        const value = form.get(name);
        return typeof value === "string" && value ? value : null;
      };
      token = field("token") ?? token;
      email = field("email") ?? email;
      invite = field("invite") ?? invite;
    } catch {
      // Fall through with whatever the query string carried.
    }
  }

  return { token, email, invite };
}

async function acceptInvite(invite: string | null, userId: string, email: string): Promise<string> {
  if (!invite) return "/";
  try {
    const accepted = await acceptProjectInvite(invite, userId, email);
    if (accepted) return `/projects/${accepted.projectSlug}`;
  } catch (e) {
    // Invite acceptance failed — still authenticated, redirect to home
    console.error("Invite acceptance error:", e);
  }
  return "/";
}

export async function GET(request: NextRequest) {
  // Links emailed before this change pointed at `/auth/verify`, which used to
  // forward here. Send any GET back to that page without touching the link.
  const target = new URL("/auth/verify", request.url);
  for (const name of ["token", "email", "invite"]) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) target.searchParams.set(name, value);
  }
  return NextResponse.redirect(target);
}

export async function POST(request: NextRequest) {
  // Its own bucket: requesting links and using them must not share a budget.
  const rateLimit = await checkRateLimit({
    bucket: "auth-verify",
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return redirectTo("/auth/error?reason=rate_limited", request);
  }

  const { token, email, invite } = await readParams(request);

  if (!token || !email) {
    return redirectTo("/auth/error?reason=missing_params", request);
  }

  try {
    const result = await verifyMagicLink(email, token);

    if (!result.ok) {
      // A second click, or a link opened after an earlier one already signed
      // this browser in: the person is where they wanted to be, so take them
      // there instead of showing an error about a link they no longer need.
      if (result.reason === "used" || result.reason === "expired") {
        const current = await getCurrentUser();
        if (current && normalizeEmail(current.email) === normalizeEmail(email)) {
          return redirectTo(await acceptInvite(invite, current.id, current.email), request);
        }
      }
      return redirectTo(`/auth/error?reason=${ERROR_REASON[result.reason]}`, request);
    }

    const redirectPath = await acceptInvite(invite, result.user.id, result.user.email);

    const response = redirectTo(redirectPath, request);
    response.cookies.set(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Verification error:", error);
    return redirectTo("/auth/error?reason=verification_failed", request);
  }
}
