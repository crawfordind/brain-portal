/**
 * The rules of a sign-in link, kept pure so they can be tested without a
 * database. `src/lib/auth/index.ts` does the reading and writing.
 *
 * Every rule here exists because a real link stopped working before the user
 * got to it:
 *
 * - Email is slow. Greylisting, provider queues and a phone that only polls
 *   every so often can eat most of a 15-minute window, so the lifetime is
 *   longer and configurable.
 * - Asking for another link used to delete the first. When the first email
 *   then arrived, it was dead. Earlier links now stay valid until they expire.
 * - "Dave@example.com" (a phone's autocapitalisation) and "dave@example.com"
 *   were different people to the database.
 */

export const DEFAULT_MAGIC_LINK_MINUTES = 30;
const MIN_MAGIC_LINK_MINUTES = 5;
const MAX_MAGIC_LINK_MINUTES = 24 * 60;

/** How many unused sign-in links one address may hold at once. */
export const MAX_ACTIVE_LINKS_PER_EMAIL = 5;

/**
 * Lifetime of a sign-in link in minutes, from `MAGIC_LINK_EXPIRY_MINUTES`.
 * Anything unparseable falls back to the default; anything out of range is
 * clamped, so a typo cannot produce a link that is dead on arrival or one that
 * lives for a month.
 */
export function magicLinkTtlMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.MAGIC_LINK_EXPIRY_MINUTES?.trim();
  if (!raw) return DEFAULT_MAGIC_LINK_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAGIC_LINK_MINUTES;
  return Math.min(MAX_MAGIC_LINK_MINUTES, Math.max(MIN_MAGIC_LINK_MINUTES, Math.round(parsed)));
}

/** "30 minutes", "1 hour", "2 hours" — for the email copy. */
export function describeMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** The one spelling of an address the database stores and compares. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A stored timestamp as a Date. Rows are written from JS as ISO strings, but
 * SQLite's `datetime('now')` shape (no zone, UTC by definition) is accepted
 * too. Comparing the two as text, as the old query did, is wrong: the `T` in
 * an ISO string sorts after the space in SQLite's format, so a link stayed
 * valid until the end of the UTC day rather than for its stated lifetime.
 */
export function parseStoredTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const parsed = new Date(hasZone ? trimmed : `${trimmed.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type MagicLinkFailure =
  /** No such link, or it was issued to another address. */
  | "invalid"
  /** The link worked once already. */
  | "used"
  /** The link outlived its lifetime. */
  | "expired"
  /** The link is genuine, but this server does not create accounts for that address. */
  | "not_allowed";

export interface StoredMagicLink {
  email: string;
  expires_at: string;
  used: number | boolean | null;
}

/**
 * Why a stored link can or cannot be used right now. Order matters: a link
 * for another address is "invalid" whatever its state, so this cannot be used
 * to learn anything about someone else's link.
 */
export function assessMagicLink(
  link: StoredMagicLink | null,
  email: string,
  now: Date = new Date()
): { ok: true } | { ok: false; reason: Exclude<MagicLinkFailure, "not_allowed"> } {
  if (!link) return { ok: false, reason: "invalid" };
  if (normalizeEmail(link.email) !== normalizeEmail(email)) return { ok: false, reason: "invalid" };
  if (link.used === true || link.used === 1) return { ok: false, reason: "used" };
  const expiresAt = parseStoredTimestamp(link.expires_at);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}
