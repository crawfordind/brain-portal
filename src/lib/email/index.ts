import nodemailer from "nodemailer";
// nodemailer 10 ships its own types, so `Transporter` is no longer
// a namespace — import the type directly.
import type { Transporter } from "nodemailer";

// Lazy initialization for serverless
let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!_transporter) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error("SMTP configuration is not complete");
    }

    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // true for 465, false for other ports. Inferred from the port when unset,
      // since "465 without SMTP_SECURE" is the most common way to hang a send.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // A serverless function has a hard ceiling. Without these, one stalled
      // SMTP handshake eats the whole notification cron run.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return _transporter;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Extra headers, e.g. `List-Unsubscribe`. */
  headers?: Record<string, string>;
  replyTo?: string;
}

/**
 * Errors worth one more attempt: connection drops, timeouts, and SMTP 4xx
 * ("try again later"). A 5xx (bad address, rejected auth) will fail the same
 * way every time.
 */
function isTransientSmtpError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; responseCode?: number };
  if (typeof e.responseCode === "number") {
    return e.responseCode >= 400 && e.responseCode < 500;
  }
  return ["ETIMEDOUT", "ECONNECTION", "ECONNRESET", "ESOCKET", "EDNS", "ECONNREFUSED"].includes(e.code ?? "");
}

/** Readable plain-text fallback for clients that won't render HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text ? `${text} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function maskAddress(address: string): string {
  const [local, domain] = address.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "brain@example.com";
  const fromName = (process.env.SMTP_FROM_NAME || "Brain Portal").replace(/"/g, "'");
  // Header injection guard: a subject is often built from a task title.
  const subject = options.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

  const startTime = Date.now();
  const recipient = maskAddress(options.to);

  const message = {
    from: `"${fromName}" <${fromEmail}>`,
    to: options.to,
    subject,
    html: options.html,
    text: options.text || htmlToText(options.html),
    headers: options.headers,
    replyTo: options.replyTo,
  };

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const transporter = getTransporter();
      await transporter.sendMail(message);
      console.log(`[EMAIL] ✓ Sent "${subject}" to ${recipient} (${Date.now() - startTime}ms)`);
      return true;
    } catch (error) {
      const transient = isTransientSmtpError(error);
      console.error(
        `[EMAIL] ✗ Attempt ${attempt}/${maxAttempts} failed for ${recipient} after ${Date.now() - startTime}ms:`,
        error instanceof Error ? error.message : error
      );
      // A pooled connection that broke stays broken; build a fresh one.
      _transporter = null;
      if (!transient || attempt === maxAttempts) return false;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

export function isEmailConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}
