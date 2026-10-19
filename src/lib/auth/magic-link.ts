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
 * - Corporate mail scanners (Defender Safe Links, Mimecast, Proofpoint) open
 *   every link in a real browser that runs JavaScript, before the recipient
 *   sees the message. A link that signed in on first open was spent by the
 *   scanner, and because the code and link were one login, the code died with
 *   it. Now the browser that asked for the email is recognised and always let
 *   through, any other browser must press a button, a link tolerates a few
 *   stray opens, and the code is spent only by typing it.
 */

export const DEFAULT_MAGIC_LINK_MINUTES = 30;
const MIN_MAGIC_LINK_MINUTES = 5;
const MAX_MAGIC_LINK_MINUTES = 24 * 60;

/** How many unused sign-in links one address may hold at once. */
export const MAX_ACTIVE_LINKS_PER_EMAIL = 5;

/**
 * How many browsers other than the one that asked may sign in with one link.
 * One would be "one-time", and one is exactly what a scanner uses up. A few
 * leaves the person's own click working after a scanner (or two: some
 * gateways open a link from more than one sandbox) got there first. The
 * browser that requested the email is not counted against this at all.
 */
export const MAX_LINK_USES = 3;

/**
 * Cookie set on the browser that requests a sign-in email, holding a random
 * secret whose hash is stored on the link. A scanner never has it, so its
 * presence is what tells "the person, back in the browser they asked from"
 * apart from everything else that opens the link.
 */
export const SIGN_IN_BROWSER_COOKIE = "brain_signin_browser";

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
  /** The link has been used by as many other browsers as it allows. */
  | "used"
  /** The link outlived its lifetime. */
  | "expired"
  /** The link is genuine, but this server does not create accounts for that address. */
  | "not_allowed";

export interface StoredMagicLink {
  email: string;
  expires_at: string;
  /** Set once `link_uses` reaches `MAX_LINK_USES` (or, on rows from before that column, after one use). */
  used: number | boolean | null;
  link_uses?: number | null;
}

/**
 * Why a stored link can or cannot be used right now. Order matters: a link
 * for another address is "invalid" whatever its state, so this cannot be used
 * to learn anything about someone else's link.
 *
 * `sameBrowser` means the request carries the secret of the browser that
 * asked for this link. That browser is never refused for use: whatever a
 * scanner did to the link, the person can still finish where they started.
 */
export function assessMagicLink(
  link: StoredMagicLink | null,
  email: string,
  now: Date = new Date(),
  { sameBrowser = false }: { sameBrowser?: boolean } = {}
): { ok: true } | { ok: false; reason: Exclude<MagicLinkFailure, "not_allowed"> } {
  if (!link) return { ok: false, reason: "invalid" };
  if (normalizeEmail(link.email) !== normalizeEmail(email)) return { ok: false, reason: "invalid" };
  const expiresAt = parseStoredTimestamp(link.expires_at);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!sameBrowser) {
    const spent = link.used === true || link.used === 1 || Number(link.link_uses ?? 0) >= MAX_LINK_USES;
    if (spent) return { ok: false, reason: "used" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sign-in codes
//
// The same email carries a six-digit code next to the link, so the email can
// be read on a phone and the code typed on a laptop (or the other way round),
// and an in-app mail browser that would keep the session to itself is never
// involved. The link stays for one-tap sign-in on the same device.
// ---------------------------------------------------------------------------

export const SIGN_IN_CODE_LENGTH = 6;

/**
 * Wrong guesses one link's code tolerates before it stops accepting codes.
 * The link itself keeps working: someone guessing at an address cannot lock
 * its owner out of the email they were sent. With at most
 * `MAX_ACTIVE_LINKS_PER_EMAIL` links, a guesser gets 25 tries at a million.
 */
export const MAX_CODE_ATTEMPTS = 5;

/** Digits only, so "123 456", "123-456" and a pasted " 123456\n" all match. */
export function normalizeSignInCode(input: string): string {
  return input.replace(/\D/g, "");
}

/** "123 456": easier to read off one screen and type into another. */
export function formatSignInCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type SignInCodeFailure =
  /** Not the right code for any of this address's live links. */
  | "wrong_code"
  /** Too many wrong codes; the email's link still works. */
  | "locked"
  /** No live code for this address: expired, already typed once, or never sent. */
  | "expired"
  /** The code was right, but this server does not create accounts for that address. */
  | "not_allowed";
