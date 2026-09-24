/**
 * Signed, self-contained tokens behind the buttons in an email.
 *
 * A button in an inbox cannot carry a session cookie, so the link itself has to
 * say who is acting, on what, and prove the server minted it. The token is
 * `v1.<payload>.<signature>`: base64url JSON, then an HMAC-SHA256 over it.
 * No table, no migration — which also means a token cannot be revoked
 * individually, so every action it can name is designed to be safe to repeat
 * (see `src/lib/email/actions.ts`).
 *
 * The secret is `EMAIL_ACTION_SECRET`, falling back to `SESSION_SECRET`.
 * Neither set → `isEmailActionSigningAvailable()` is false and emails simply
 * render without buttons, rather than signing with a guessable key.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const EMAIL_ACTIONS = [
  "task_complete",
  "task_extend",
  "task_reopen",
  "task_set_due",
  "reminder_dismiss",
  "reminder_snooze",
  "reminder_reopen",
  "unsubscribe",
] as const;

export type EmailAction = (typeof EMAIL_ACTIONS)[number];

/** Which notification preference a one-click unsubscribe turns off. */
export const UNSUBSCRIBE_CATEGORIES = [
  "reminders",
  "tasks",
  "daily_digest",
  "weekly_report",
  "agent_updates",
  "all",
] as const;

export type UnsubscribeCategory = (typeof UNSUBSCRIBE_CATEGORIES)[number];

export interface EmailActionPayload {
  /** User the action runs as. Every write is also scoped to this id. */
  u: string;
  a: EmailAction;
  /** Entity id (task or reminder). Absent for `unsubscribe`. */
  id?: string;
  /** Action parameters, e.g. `{ days: 1, due: "2026-09-25" }`. */
  p?: Record<string, string | number | null>;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const VERSION = "v1";

/** Links in a notification stay usable for two weeks. */
export const ACTION_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
/** Unsubscribe links should keep working long after the email arrived. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
/** An undo offered on the result page is only useful right away. */
export const UNDO_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function getSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.EMAIL_ACTION_SECRET || env.SESSION_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

export function isEmailActionSigningAvailable(): boolean {
  return getSecret() !== null;
}

function sign(data: string, secret: string): string {
  // Domain-separated so a token here can never collide with any other HMAC
  // the app computes with the same SESSION_SECRET.
  return createHmac("sha256", `email-action:${secret}`).update(data).digest("base64url");
}

export function createEmailActionToken(
  input: Omit<EmailActionPayload, "exp">,
  ttlSeconds: number = ACTION_TOKEN_TTL_SECONDS,
  now: number = Date.now()
): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: EmailActionPayload = {
    ...input,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${VERSION}.${body}.${sign(`${VERSION}.${body}`, secret)}`;
}

export type TokenVerification =
  | { ok: true; payload: EmailActionPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "unconfigured" };

export function verifyEmailActionToken(
  token: string | null | undefined,
  now: number = Date.now()
): TokenVerification {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (!token || typeof token !== "string" || token.length > 4096) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }

  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: EmailActionPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !payload ||
    typeof payload.u !== "string" ||
    typeof payload.exp !== "number" ||
    !(EMAIL_ACTIONS as readonly string[]).includes(payload.a)
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp * 1000 < now) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
