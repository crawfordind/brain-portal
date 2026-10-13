/**
 * The sign-in email. Pure, so its copy can be tested without SMTP.
 *
 * The code comes first because it works anywhere: read the email on a phone,
 * type six digits on a laptop. The link stays as the one-tap option for
 * signing in on the device that has the email open.
 */

import { escapeHtml, safeHref } from "@/lib/email/html";
import { formatSignInCode } from "./magic-link";

export interface SignInEmailInput {
  url: string;
  /** Null when the database cannot store codes yet: the email is link-only. */
  code: string | null;
  /** "30 minutes" */
  lifetime: string;
}

export function renderSignInEmail({ url, code, lifetime }: SignInEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const shown = code ? formatSignInCode(code) : null;
  const href = safeHref(url);

  // The code in the subject means a phone's notification is enough: no need
  // to open the message at all.
  const subject = shown ? `${shown} is your Brain Portal sign-in code` : "Sign in to Brain Portal";

  const codeBlock = shown
    ? `<p style="color: #4a4a4a; font-size: 16px; line-height: 1.5; margin: 0 0 12px;">Enter this code on the sign-in screen, on any device:</p>
            <p style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1a1a1a; background: #f4f4f5; border-radius: 8px; padding: 16px 20px; margin: 0 0 24px; display: inline-block;">${escapeHtml(shown)}</p>
            <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5; margin: 0;">Or, on this device, tap the button:</p>`
    : `<p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">Click the button below to sign in to your account:</p>`;

  const html = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 24px;">Sign in to Brain Portal</h2>
            ${codeBlock}
            <a href="${href}" style="display: inline-block; margin: 16px 0 24px; padding: 14px 28px; background-color: #0d9488; color: white; text-decoration: none; border-radius: 8px; font-weight: 500;">
              Sign In
            </a>
            <p style="color: #666; font-size: 14px; margin-top: 8px;">
              ${shown ? "The code and the link" : "This link"} work once and expire in ${escapeHtml(lifetime)}. If you asked for more than one email, any of them will work.
            </p>
            <p style="color: #666; font-size: 14px;">
              If you didn&apos;t request this email, you can safely ignore it. Never share this code with anyone.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            <p style="color: #999; font-size: 12px;">
              Brain Portal — Think clearly. Connect everything.
            </p>
          </div>
        `;

  const text = [
    "Sign in to Brain Portal",
    "",
    ...(shown ? [`Your sign-in code: ${shown}`, "Enter it on the sign-in screen, on any device.", "", `Or open this link on this device: ${url}`] : [`Click this link to sign in: ${url}`]),
    "",
    `${shown ? "The code and the link" : "This link"} work once and expire in ${lifetime}.`,
    "",
    "If you didn't request this email, you can safely ignore it. Never share this code with anyone.",
  ].join("\n");

  return { subject, html, text };
}
