/**
 * The small standalone page an email button lands on.
 *
 * Served straight from the route handler rather than as an app page, so it
 * needs no session, no client bundle and no layout: someone tapping "Mark
 * done" on their phone gets a readable answer in one round trip.
 */

import { escapeHtml, safeHref } from "./html";
import { EMAIL_ACTION_PATH } from "./links";

export interface ActionPageInput {
  tone: "success" | "confirm" | "error";
  headline: string;
  subject?: string | null;
  detail?: string;
  /** A POST form: the confirmation step, or an undo. */
  form?: { token: string; label: string; autoSubmit?: boolean; secondary?: boolean };
  link?: { url: string; label: string };
}

const ICONS: Record<ActionPageInput["tone"], string> = {
  success: "✓",
  confirm: "?",
  error: "!",
};

export function renderActionPage(input: ActionPageInput): string {
  const { tone, headline, subject, detail, form, link } = input;

  const formHtml = form
    ? `<form id="action-form" method="post" action="${EMAIL_ACTION_PATH}">
        <input type="hidden" name="token" value="${escapeHtml(form.token)}">
        <button type="submit" class="btn ${form.secondary ? "btn-secondary" : "btn-primary"}">${escapeHtml(form.label)}</button>
      </form>`
    : "";

  const linkHtml = link
    ? `<a class="btn ${form && !form.secondary ? "btn-secondary" : "btn-primary"}" href="${safeHref(link.url)}">${escapeHtml(link.label)}</a>`
    : "";

  // One tap in the inbox should be one tap. The confirmation step exists so
  // that a plain GET never changes anything (link previews and prefetchers
  // issue GETs); a real browser runs this and posts straight through, and
  // without JavaScript the button is right there.
  const autoSubmit = form?.autoSubmit
    ? `<script>try{document.getElementById("action-form").requestSubmit()}catch(e){document.getElementById("action-form").submit()}</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(headline)} · Brain Portal</title>
<style>
  :root { --bg:#f4f4f5; --card:#ffffff; --text:#18181b; --muted:#71717a; --border:#e4e4e7; --accent:#6366f1; --accent-text:#ffffff; --ok:#16a34a; --warn:#d97706; --err:#dc2626; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f0f10; --card:#18181b; --text:#f4f4f5; --muted:#a1a1aa; --border:#27272a; --accent:#818cf8; --accent-text:#0f0f10; --ok:#4ade80; --warn:#fbbf24; --err:#f87171; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:16px; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
  .card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:32px 24px; text-align:center; }
  .icon { width:48px; height:48px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; margin-bottom:16px; color:#fff; }
  .icon.success { background:var(--ok); } .icon.confirm { background:var(--accent); } .icon.error { background:var(--err); }
  h1 { font-size:20px; margin:0 0 8px; line-height:1.3; }
  .subject { font-size:15px; font-weight:600; margin:0 0 8px; overflow-wrap:anywhere; }
  .detail { color:var(--muted); font-size:14px; line-height:1.5; margin:0 0 20px; }
  .actions { display:flex; flex-direction:column; gap:10px; margin-top:20px; }
  .btn { display:block; width:100%; min-height:48px; padding:12px 20px; border-radius:10px; font-size:15px; font-weight:600; text-decoration:none; cursor:pointer; border:1px solid transparent; font-family:inherit; }
  .btn-primary { background:var(--accent); color:var(--accent-text); }
  .btn-secondary { background:transparent; color:var(--text); border-color:var(--border); }
  .brand { margin-top:24px; font-size:12px; color:var(--muted); letter-spacing:0.08em; text-transform:uppercase; }
</style>
</head>
<body>
  <main class="card">
    <div class="icon ${tone}" aria-hidden="true">${ICONS[tone]}</div>
    <h1>${escapeHtml(headline)}</h1>
    ${subject ? `<p class="subject">${escapeHtml(subject)}</p>` : ""}
    ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ""}
    <div class="actions">
      ${form?.secondary ? `${linkHtml}${formHtml}` : `${formHtml}${linkHtml}`}
    </div>
    <div class="brand">Brain Portal</div>
  </main>
  ${autoSubmit}
</body>
</html>`;
}
