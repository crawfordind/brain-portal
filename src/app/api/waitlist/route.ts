import { NextRequest, NextResponse } from "next/server";
import { db, queryOne } from "@/lib/db/client";
import { sendEmail, isEmailConfigured } from "@/lib/email/index";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  // Unauthenticated, and it sends an email per new address — without a limit
  // this route is a spam relay funded by the operator's SMTP quota.
  const rateLimit = await checkRateLimit({
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

  if (isEmailConfigured()) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://brain-portal.vercel.app";

    await sendEmail({
      to: email,
      subject: "You're on the list — Brain Portal",
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
      You're on the list.
    </h1>
    <p style="color:#71717a;font-size:16px;line-height:1.7;margin:0 0 40px;">
      We received your request for early access to Brain Portal — a private, AI-powered knowledge system built for people who think seriously about their work. We'll reach out as soon as your spot opens up.
    </p>

    <!-- Divider -->
    <div style="height:1px;background:#1c1c2e;margin-bottom:40px;"></div>

    <!-- What's coming -->
    <h2 style="color:#fff;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 24px;color:#0d9488;">
      What you're getting access to
    </h2>

    <div style="display:flex;flex-direction:column;gap:20px;margin-bottom:40px;">

      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">🧠</div>
        <div>
          <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">Living Knowledge Graph</div>
          <div style="color:#71717a;font-size:13px;line-height:1.6;">Your notes don't exist in isolation. DC uses AI embeddings to automatically discover connections between your ideas — building a graph that grows smarter every day.</div>
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">⌘</div>
        <div>
          <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">One keystroke to everything</div>
          <div style="color:#71717a;font-size:13px;line-height:1.6;">⌘K opens your entire knowledge base from anywhere. Search notes, run commands, capture ideas, create tasks — all without touching your mouse.</div>
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">🎙️</div>
        <div>
          <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">Voice capture</div>
          <div style="color:#71717a;font-size:13px;line-height:1.6;">Capture thoughts the moment they surface. Speak naturally — DC transcribes, organizes, and connects your voice notes to your existing knowledge automatically.</div>
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">🤖</div>
        <div>
          <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">AI that knows your work</div>
          <div style="color:#71717a;font-size:13px;line-height:1.6;">Not a generic chatbot. DC's AI builds context from your specific notes, projects, and history — so it can actually help you write, decide, and move forward.</div>
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div style="width:36px;height:36px;background:#0f0f1a;border:1px solid #1c1c2e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;">🔒</div>
        <div>
          <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">Private by design</div>
          <div style="color:#71717a;font-size:13px;line-height:1.6;">Your knowledge is yours. Magic-link authentication, HTTP-only sessions, no passwords stored. Your data never trains anyone's model.</div>
        </div>
      </div>

    </div>

    <!-- Divider -->
    <div style="height:1px;background:#1c1c2e;margin-bottom:32px;"></div>

    <!-- Footer -->
    <p style="color:#3f3f46;font-size:12px;line-height:1.6;margin:0;">
      You're receiving this because you requested early access at ${appUrl}/waitlist.<br>
      Brain Portal · Think clearly. Connect everything.
    </p>

  </div>
</body>
</html>
      `.trim(),
      text: `You're on the list — Brain Portal\n\nWe received your request for early access. We'll reach out as soon as your spot opens up.\n\nWhat you're getting access to:\n\n• Living Knowledge Graph — AI automatically discovers connections between your notes\n• ⌘K to everything — Search, capture, create from anywhere\n• Voice capture — Speak your ideas, DC organizes them\n• AI that knows your work — Context-aware assistant built on your knowledge\n• Private by design — Magic-link auth, no passwords, your data stays yours\n\nBrain Portal · Think clearly. Connect everything.`,
    });
  }

  return NextResponse.json({ success: true });
}
