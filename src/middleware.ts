import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Routes reachable without a session cookie.
 *
 * Every one of these authenticates itself by another means — an MCP bearer
 * key, the cron secret, a service token, a share token, or a signed email
 * action token — or is genuinely public. Matching is on exact path or
 * path-prefix-plus-slash, never bare
 * `startsWith`: with bare prefixes "/api/brain" also matched
 * "/api/brainstorm-everything", so a route added later under a public
 * prefix-neighbour would silently inherit public access.
 */
const publicRoutes = [
  "/auth/login",
  "/auth/verify",
  "/auth/error",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/health",
  "/api/mcp/docs",
  "/api/mcp/rpc",
  "/api/cron",
  "/api/brain",
  "/api/email/action",
  "/waitlist",
  "/api/waitlist",
  "/shared",
];

function isPublicRoute(pathname: string): boolean {
  return publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/;

/** File extensions served as static assets, which carry no session. */
const STATIC_ASSET_RE =
  /\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|webmanifest|json)$/i;

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Nothing in the app uses the camera, microphone-as-recorder, geolocation or
  // payment APIs from an embed, so deny them rather than inherit the default.
  // (Voice capture uses the Web Speech API on the top-level document, which
  // `microphone=(self)` still permits.)
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)"
  );
  // HSTS only makes sense once the app is actually served over TLS; sending it
  // from a local http dev server would pin localhost to https in the browser.
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Retired routes, pointed at whatever replaced them.
  //
  // These must name a route that actually exists. "/captures" and "/insights"
  // used to redirect to "/inbox", which was never built — so both sent the
  // user from a page that no longer exists to one that never did, and the
  // 404 blamed the destination.
  const redirects: Record<string, string> = {
    "/graph": "/",
    "/weekly": "/",
    "/captures": "/",
    "/insights": "/",
    "/daily": "/notes",
    "/attachments": "/search",
  };

  if (redirects[pathname]) {
    return NextResponse.redirect(new URL(redirects[pathname], request.url));
  }

  if (isPublicRoute(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Static assets only. This used to exempt any path containing a dot, which
  // meant "/api/notes/a.b" skipped the session check entirely — the route's own
  // auth still caught it, but the middleware was not the backstop it looked
  // like. Match real asset extensions instead, and never exempt /api.
  if (
    !pathname.startsWith("/api/") &&
    (pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon") ||
      STATIC_ASSET_RE.test(pathname))
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("brain_session");

  if (!sessionCookie?.value || !SESSION_TOKEN_RE.test(sessionCookie.value)) {
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/waitlist", request.url));
    }
    const loginUrl = new URL("/auth/login", request.url);
    // Keep the query string: a Web Share Target navigation carries the entire
    // shared payload in it, and dropping it loses what the user shared.
    loginUrl.searchParams.set("redirect", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
