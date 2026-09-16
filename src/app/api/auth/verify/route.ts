import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth";
import { acceptProjectInvite } from "@/lib/collaborators";
import { checkRateLimit } from "@/lib/rate-limit";

const SESSION_COOKIE = "brain_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function GET(request: NextRequest) {
  // Rate limit: 10 verify attempts per 15 minutes per IP
  const rateLimit = await checkRateLimit({
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.redirect(new URL("/auth/error?reason=rate_limited", request.url));
  }

  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const invite = searchParams.get("invite");

  if (!token || !email) {
    return NextResponse.redirect(new URL("/auth/error?reason=missing_params", request.url));
  }

  try {
    const result = await verifyMagicLink(email, token);

    if (!result) {
      return NextResponse.redirect(new URL("/auth/error?reason=invalid_token", request.url));
    }

    // If there's an invite token, try to accept it
    let redirectPath = "/";
    if (invite) {
      try {
        const accepted = await acceptProjectInvite(invite, result.user.id);
        if (accepted) {
          redirectPath = `/projects/${accepted.projectSlug}`;
        }
      } catch (e) {
        // Invite acceptance failed — still authenticated, redirect to home
        console.error("Invite acceptance error:", e);
      }
    }

    const response = NextResponse.redirect(new URL(redirectPath, request.url));
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
    return NextResponse.redirect(new URL("/auth/error?reason=verification_failed", request.url));
  }
}
