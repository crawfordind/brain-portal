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

    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const fromEmail = process.env.SMTP_FROM || "brain@example.com";
  const fromName = process.env.SMTP_FROM_NAME || "Brain Portal";

  const startTime = Date.now();
  console.log(`[EMAIL] Starting email send to ${options.to} - Subject: "${options.subject}"`);

  try {
    const transporter = getTransporter();
    console.log(`[EMAIL] SMTP transporter ready (host: ${process.env.SMTP_HOST})`);

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    const duration = Date.now() - startTime;
    console.log(`[EMAIL] ✓ Email sent successfully to ${options.to} (took ${duration}ms)`);
    return true;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[EMAIL] ✗ Failed to send email to ${options.to} after ${duration}ms:`, error);
    if (error instanceof Error) {
      console.error(`[EMAIL] Error details: ${error.message}`);
      console.error(`[EMAIL] Error stack:`, error.stack);
    }
    return false;
  }
}

export function isEmailConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}
