import { NextRequest, NextResponse } from "next/server";
import { verifyEmailActionToken, type TokenVerification } from "@/lib/email/action-tokens";
import { executeEmailAction, previewEmailAction } from "@/lib/email/actions";
import { renderActionPage, type ActionPageInput } from "@/lib/email/action-page";
import { absoluteUrl } from "@/lib/app-url";

/**
 * The endpoint behind every button in a notification email.
 *
 * Public in the middleware: the signed token *is* the credential (see
 * `src/lib/email/action-tokens.ts`), because an inbox cannot carry a session.
 *
 * - GET never changes anything. Link previews, prefetchers and antivirus
 *   scanners issue GETs, so a GET renders a confirmation that a real browser
 *   posts straight through.
 * - POST performs the action. It also accepts RFC 8058 one-click unsubscribe
 *   (`List-Unsubscribe=One-Click` in the body, token in the query string), so
 *   the mail client's own "Unsubscribe" button works without opening a page.
 */

export const dynamic = "force-dynamic";

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  // The token is in this page's URL; never hand it to another origin.
  "Referrer-Policy": "no-referrer",
};

function page(input: ActionPageInput, status = 200): NextResponse {
  return new NextResponse(renderActionPage(input), { status, headers: PAGE_HEADERS });
}

function invalidTokenPage(
  reason: Exclude<TokenVerification, { ok: true }>["reason"],
  origin: string
): NextResponse {
  const detail =
    reason === "expired"
      ? "Links in notification emails stop working after a while. You can do the same thing from the app."
      : reason === "unconfigured"
        ? "Email actions aren't set up on this server. You can do the same thing from the app."
        : "This link is incomplete or has been changed. Try opening it again from the email.";
  return page(
    {
      tone: "error",
      headline: reason === "expired" ? "This link has expired." : "This link isn't valid.",
      detail,
      link: { url: absoluteUrl("/tasks", { requestOrigin: origin }), label: "Open Brain Portal" },
    },
    reason === "unconfigured" ? 503 : 400
  );
}

function notFoundPage(origin: string): NextResponse {
  return page(
    {
      tone: "error",
      headline: "Nothing to do here.",
      detail: "The item this email was about no longer exists.",
      link: { url: absoluteUrl("/tasks", { requestOrigin: origin }), label: "Open Brain Portal" },
    },
    404
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const verified = verifyEmailActionToken(token);
  if (!verified.ok) return invalidTokenPage(verified.reason, request.nextUrl.origin);

  try {
    const preview = await previewEmailAction(verified.payload);
    if (!preview) return notFoundPage(request.nextUrl.origin);

    return page({
      tone: "confirm",
      headline: preview.question,
      subject: preview.subject,
      form: { token: token!, label: preview.confirmLabel, autoSubmit: true },
    });
  } catch (error) {
    console.error("[EMAIL ACTION] preview failed:", error);
    return page({ tone: "error", headline: "Something went wrong.", detail: "Please try again in a moment." }, 500);
  }
}

export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get("token");
  let oneClickUnsubscribe = false;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fromBody = form.get("token");
      if (typeof fromBody === "string" && fromBody) token = fromBody;
      oneClickUnsubscribe = form.get("List-Unsubscribe") === "One-Click";
    } catch {
      // Fall through with whatever the query string carried.
    }
  }

  const verified = verifyEmailActionToken(token);
  if (!verified.ok) {
    if (oneClickUnsubscribe) {
      return NextResponse.json({ error: verified.reason }, { status: 400 });
    }
    return invalidTokenPage(verified.reason, request.nextUrl.origin);
  }

  // One-click unsubscribe may only ever unsubscribe, whatever the token says.
  if (oneClickUnsubscribe && verified.payload.a !== "unsubscribe") {
    return NextResponse.json({ error: "not_an_unsubscribe_link" }, { status: 400 });
  }

  try {
    const outcome = await executeEmailAction(verified.payload);

    if (oneClickUnsubscribe) {
      return NextResponse.json({ success: outcome.ok }, { status: outcome.ok ? 200 : 400 });
    }

    return page(
      {
        tone: outcome.ok ? "success" : "error",
        headline: outcome.headline,
        subject: outcome.subject,
        detail: outcome.detail,
        form: outcome.undo ? { token: outcome.undo.token, label: outcome.undo.label, secondary: true } : undefined,
        link: outcome.openUrl ? { url: outcome.openUrl, label: outcome.openLabel || "Open Brain Portal" } : undefined,
      },
      outcome.ok ? 200 : 404
    );
  } catch (error) {
    console.error("[EMAIL ACTION] action failed:", error);
    if (oneClickUnsubscribe) {
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    return page({ tone: "error", headline: "Something went wrong.", detail: "Please try again in a moment." }, 500);
  }
}
