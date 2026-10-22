/**
 * The two emails the waitlist sends: "you're on the list" and "you're in".
 *
 * Pure, so the copy is testable. Every sentence here is a promise the app
 * must keep. The previous versions named a feature page that had been retired
 * (the graph), referred to the product by one person's initials, and promised
 * that "your data never trains anyone's model", which depends on the AI
 * provider an operator chooses and is not this app's to promise.
 */

import { escapeHtml, safeHref } from "@/lib/email/html";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function layout(body: string, footer: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#0b0b12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;">
    <div style="margin-bottom:36px;">
      <span style="display:inline-block;width:28px;height:28px;vertical-align:middle;background:linear-gradient(135deg,#0f766e,#2dd4bf);border-radius:8px;"></span>
      <span style="color:#fff;font-size:15px;font-weight:600;vertical-align:middle;margin-left:10px;">Brain Portal</span>
    </div>
    ${body}
    <div style="height:1px;background:#1f1f2e;margin:36px 0 24px;"></div>
    <p style="color:#6b6b78;font-size:12px;line-height:1.6;margin:0;">${footer}</p>
  </div>
</body>
</html>`;
}

const FEATURES: { title: string; body: string }[] = [
  {
    title: "One box for everything",
    body: "Type, paste or say a thought into the Brain Bar. Cmd+K searches notes, tasks and projects from anywhere.",
  },
  {
    title: "Search by meaning",
    body: "Notes are indexed by meaning as well as words, so related ideas surface without folders or tags.",
  },
  {
    title: "Ask about anything you wrote",
    body: "Open a chat on any note, task or capture. The answer starts from that item and the notes nearest to it.",
  },
  {
    title: "Your AI, your choice",
    body: "Connect your own OpenRouter, OpenAI or Claude key, pick the model per job, and see every call it made.",
  },
  {
    title: "Open source",
    body: "AGPL-licensed. Read exactly how your data is handled, or run the whole thing yourself.",
  },
];

/** Sent once, when an address first joins the list. */
export function renderWaitlistJoinedEmail(input: { appUrl: string }): RenderedEmail {
  const waitlistUrl = `${input.appUrl}/waitlist`;
  const list = FEATURES.map(
    (f) => `<div style="margin:0 0 18px;">
      <div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(f.title)}</div>
      <div style="color:#9a9aa8;font-size:13px;line-height:1.6;">${escapeHtml(f.body)}</div>
    </div>`
  ).join("\n");

  const html = layout(
    `<h1 style="color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.02em;margin:0 0 14px;">You're on the list.</h1>
    <p style="color:#b4b4c0;font-size:15px;line-height:1.7;margin:0 0 12px;">
      Thanks for asking for early access to Brain Portal. Spots are opened by hand, a few at a time.
      When yours is ready you'll get one more email with a sign-in link. There's no password to set.
    </p>
    <p style="color:#b4b4c0;font-size:15px;line-height:1.7;margin:0 0 32px;">
      Nothing else will be sent to this address until then.
    </p>
    <div style="color:#2dd4bf;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 18px;">What's waiting</div>
    ${list}`,
    `You're receiving this because this address was entered at <a href="${safeHref(waitlistUrl)}" style="color:#6b6b78;">${escapeHtml(waitlistUrl)}</a>. If that wasn't you, ignore this email and nothing more will be sent.`
  );

  const text = [
    "You're on the list. (Brain Portal)",
    "",
    "Thanks for asking for early access. Spots are opened by hand, a few at a time. When yours is ready you'll get one more email with a sign-in link. There's no password to set.",
    "",
    "What's waiting:",
    ...FEATURES.map((f) => `- ${f.title}: ${f.body}`),
    "",
    `You're receiving this because this address was entered at ${waitlistUrl}. If that wasn't you, ignore this email.`,
  ].join("\n");

  return { subject: "You're on the list for Brain Portal", html, text };
}

/** Sent when an admin approves an address. The account already exists. */
export function renderWaitlistApprovedEmail(input: { appUrl: string; email: string }): RenderedEmail {
  const loginUrl = `${input.appUrl}/auth/login?email=${encodeURIComponent(input.email)}`;

  const html = layout(
    `<h1 style="color:#fff;font-size:26px;font-weight:700;letter-spacing:-0.02em;margin:0 0 14px;">You're in.</h1>
    <p style="color:#b4b4c0;font-size:15px;line-height:1.7;margin:0 0 28px;">
      Your Brain Portal account is ready. Sign in with this email address. We'll send you a
      link and a six-digit code, so it works even if you read email on another device.
    </p>
    <a href="${safeHref(loginUrl)}" style="display:inline-block;background:#0d9488;color:#fff;font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:10px;">Sign in</a>
    <p style="color:#9a9aa8;font-size:13px;line-height:1.7;margin:28px 0 0;">
      A good first step: press Cmd+K (Ctrl+K on Windows) and type anything on your mind.
    </p>`,
    `You're receiving this because ${escapeHtml(input.email)} asked for early access to Brain Portal.`
  );

  const text = [
    "You're in. (Brain Portal)",
    "",
    "Your account is ready. Sign in with this email address; we'll send you a link and a six-digit code.",
    "",
    loginUrl,
    "",
    "A good first step: press Cmd+K (Ctrl+K on Windows) and type anything on your mind.",
  ].join("\n");

  return { subject: "You're in: your Brain Portal account is ready", html, text };
}
