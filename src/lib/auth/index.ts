import { cookies } from "next/headers";
import { db, query, queryOne, mutate } from "@/lib/db/client";
import type { User, Session, MagicLink } from "@/lib/db/schema";
import { randomBytes, createHash, randomInt, timingSafeEqual } from "crypto";
import { mayCreateAccount } from "./signup-policy";
import { getAppUrl } from "@/lib/app-url";
import {
  assessMagicLink,
  magicLinkTtlMinutes,
  normalizeEmail,
  normalizeSignInCode,
  MAX_ACTIVE_LINKS_PER_EMAIL,
  MAX_CODE_ATTEMPTS,
  MAX_LINK_USES,
  SIGN_IN_CODE_LENGTH,
  type MagicLinkFailure,
  type SignInCodeFailure,
  type StoredMagicLink,
} from "./magic-link";

const SESSION_COOKIE = "brain_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Generate secure random token
function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// Hash token for storage
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A code's stored form. Salted with its own link's token hash, so the same
 * six digits on two links hash differently and a leaked table cannot be
 * reversed with one precomputed list of a million codes.
 */
function hashSignInCode(linkTokenHash: string, code: string): string {
  return createHash("sha256").update(`${linkTokenHash}:${code}`).digest("hex");
}

function generateSignInCode(): string {
  return randomInt(0, 10 ** SIGN_IN_CODE_LENGTH).toString().padStart(SIGN_IN_CODE_LENGTH, "0");
}

function isMissingColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such column|has no column named/i.test(message);
}

export interface SignInEmail {
  url: string;
  /**
   * Six digits to type instead of opening the link, or null when the database
   * has not been migrated for codes yet (the email then carries the link only).
   */
  code: string | null;
}

/**
 * Issue a sign-in link and, unless `withCode` is false, a code for the same
 * login. Project invites pass `withCode: false`: they live for days and are
 * opened by clicking, so a long-lived guessable code would only add risk.
 *
 * `browserSecret` is the requesting browser's `SIGN_IN_BROWSER_COOKIE`; its
 * hash is stored so that browser is always let through (see `verifyMagicLink`).
 */
export async function createSignIn(
  email: string,
  options: { baseUrl?: string; expirySeconds?: number; withCode?: boolean; browserSecret?: string } = {}
): Promise<SignInEmail> {
  const address = normalizeEmail(email);
  const token = generateToken();
  const hashedToken = hashToken(token);
  const expiry = options.expirySeconds ?? magicLinkTtlMinutes() * 60;
  const expiresAt = new Date(Date.now() + expiry * 1000).toISOString();
  const code = options.withCode === false ? null : generateSignInCode();
  const browserHash = options.browserSecret ? hashToken(options.browserSecret) : null;

  // Earlier links for this address stay valid. This used to delete every one
  // of them, so pressing "send again" while the first email sat in a queue
  // killed the link that then arrived. Only expired links are cleared, plus
  // the oldest beyond a small cap so one address cannot pile them up. A link
  // a scanner used up is *not* cleared: its code may still be the one the
  // person is about to type.
  const prune = [
    {
      sql: `DELETE FROM magic_links
            WHERE lower(email) = ? AND julianday(expires_at) <= julianday('now')`,
      args: [address],
    },
    {
      sql: `DELETE FROM magic_links
            WHERE lower(email) = ?
              AND id NOT IN (
                SELECT id FROM magic_links WHERE lower(email) = ?
                ORDER BY julianday(expires_at) DESC, rowid DESC
                LIMIT ?
              )`,
      args: [address, address, MAX_ACTIVE_LINKS_PER_EMAIL - 1],
    },
  ];

  // A database that has not run `npm run db:migrate` since a column was added
  // must not break sign-in over it: each fallback drops the newest columns,
  // down to the link alone, as it was originally.
  const attempts: Array<{ columns: string[]; values: (string | null)[]; hasCode: boolean }> = [
    {
      columns: ["code_hash", "browser_hash"],
      values: [code ? hashSignInCode(hashedToken, code) : null, browserHash],
      hasCode: code !== null,
    },
    { columns: ["code_hash"], values: [code ? hashSignInCode(hashedToken, code) : null], hasCode: code !== null },
    { columns: [], values: [], hasCode: false },
  ];

  let issuedCode: string | null = null;
  for (let i = 0; i < attempts.length; i++) {
    const { columns, values, hasCode } = attempts[i];
    const names = ["email", "token", "expires_at", ...columns];
    try {
      await db.batch(
        [
          ...prune,
          {
            sql: `INSERT INTO magic_links (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
            args: [address, hashedToken, expiresAt, ...values],
          },
        ],
        "write"
      );
      issuedCode = hasCode ? code : null;
      break;
    } catch (error) {
      if (!isMissingColumn(error) || i === attempts.length - 1) throw error;
      console.warn("[AUTH] magic_links is missing sign-in columns; run `npm run db:migrate`");
    }
  }

  const appUrl = (options.baseUrl || getAppUrl()).replace(/\/$/, "");
  return {
    url: `${appUrl}/auth/verify?token=${token}&email=${encodeURIComponent(address)}`,
    code: issuedCode,
  };
}

// Create a magic link (no code) — project invites.
export async function createMagicLink(email: string, baseUrl?: string, expirySeconds?: number): Promise<string> {
  const { url } = await createSignIn(email, { baseUrl, expirySeconds, withCode: false });
  return url;
}

export type VerifyMagicLinkResult =
  | { ok: true; user: User; sessionToken: string }
  | { ok: false; reason: MagicLinkFailure };

/**
 * Find or (policy permitting) create the account for an address whose
 * sign-in was just spent, and open a session for it.
 */
async function startSession(
  address: string
): Promise<{ ok: true; user: User; sessionToken: string } | { ok: false; reason: "not_allowed" | "invalid" }> {
  // Get the user, creating one only if this deployment's signup policy allows
  // it. Without this gate any address that can receive mail gets an account,
  // an AI budget on the operator's key, and a seat in the database.
  // `lower(email)`: accounts created before addresses were normalised may be
  // stored with capitals.
  let user = await queryOne<User>("SELECT * FROM users WHERE lower(email) = ?", [address]);

  if (!user) {
    if (!mayCreateAccount(address)) {
      return { ok: false, reason: "not_allowed" };
    }
    // Insert new user
    await db.execute({
      sql: "INSERT INTO users (email) VALUES (?)",
      args: [address],
    });
    user = await queryOne<User>("SELECT * FROM users WHERE email = ?", [address]);
  }

  if (!user) {
    return { ok: false, reason: "invalid" };
  }

  // Create session
  const sessionToken = generateToken();
  const hashedSessionToken = hashToken(sessionToken);
  const sessionExpiry = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

  await db.execute({
    sql: "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
    args: [user.id, hashedSessionToken, sessionExpiry],
  });

  return { ok: true, user, sessionToken };
}

/**
 * Count one use of a link by a browser other than the one that asked for it.
 * Atomic: racing consumers cannot take more than `MAX_LINK_USES` between them.
 */
async function countLinkUse(id: string): Promise<boolean> {
  try {
    const spent = await db.execute({
      sql: `UPDATE magic_links
            SET link_uses = COALESCE(link_uses, 0) + 1,
                used = CASE WHEN COALESCE(link_uses, 0) + 1 >= ? THEN TRUE ELSE used END
            WHERE id = ? AND used = FALSE AND COALESCE(link_uses, 0) < ?`,
      args: [MAX_LINK_USES, id, MAX_LINK_USES],
    });
    return spent.rowsAffected > 0;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    // Not migrated yet: one use, as before.
    const spent = await db.execute({
      sql: "UPDATE magic_links SET used = TRUE WHERE id = ? AND used = FALSE",
      args: [id],
    });
    return spent.rowsAffected > 0;
  }
}

/** Whether `browserSecret` is the secret of the browser that asked for this link. */
function isSameBrowser(link: { browser_hash?: string | null }, browserSecret: string | null | undefined): boolean {
  if (!browserSecret || !link.browser_hash) return false;
  const expected = Buffer.from(link.browser_hash, "hex");
  const actual = Buffer.from(hashToken(browserSecret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Verify a sign-in link and create a session.
 *
 * The browser that requested the email (it carries `browserSecret`) is let in
 * for as long as the link lives, however many times anything else opened it.
 * Any other browser counts as one of the link's `MAX_LINK_USES`.
 */
export async function verifyMagicLink(
  email: string,
  token: string,
  options: { browserSecret?: string | null } = {}
): Promise<VerifyMagicLinkResult> {
  const address = normalizeEmail(email);
  const hashedToken = hashToken(token);

  // Looked up by token alone (256 random bits, UNIQUE) so the failure can be
  // named: "already used" and "expired" need different advice from "invalid".
  const magicLink = await queryOne<MagicLink & StoredMagicLink>(
    "SELECT * FROM magic_links WHERE token = ?",
    [hashedToken]
  );

  const sameBrowser = magicLink ? isSameBrowser(magicLink, options.browserSecret) : false;
  const assessment = assessMagicLink(magicLink, address, new Date(), { sameBrowser });
  if (!assessment.ok || !magicLink) {
    return { ok: false, reason: assessment.ok ? "invalid" : assessment.reason };
  }

  if (!sameBrowser && !(await countLinkUse(magicLink.id))) {
    return { ok: false, reason: "used" };
  }

  return startSession(address);
}

export type VerifySignInCodeResult =
  | { ok: true; user: User; sessionToken: string }
  | { ok: false; reason: SignInCodeFailure; attemptsLeft?: number };

/**
 * Sign in with the six digits from the email instead of its link.
 *
 * The code is spent only by typing it. Opening the link, which a mail scanner
 * does without asking, leaves the code working: that is the way in when a
 * scanner got to the link first.
 *
 * Every guess is charged before it is checked: the attempt counter is raised
 * on all of this address's live codes in one statement, and only codes still
 * under the limit come back to be compared. Parallel guesses therefore cannot
 * slip in extra tries between a read and a write.
 */
export async function verifySignInCode(email: string, rawCode: string): Promise<VerifySignInCodeResult> {
  const address = normalizeEmail(email);
  const code = normalizeSignInCode(rawCode);

  if (code.length !== SIGN_IN_CODE_LENGTH) {
    return { ok: false, reason: "wrong_code" };
  }

  // `code_used` is the code's own flag. A database not yet migrated for it
  // falls back to the link's `used`, as before.
  let spentColumn = "code_used";
  const live = () => `lower(email) = ? AND COALESCE(${spentColumn}, 0) = 0 AND code_hash IS NOT NULL
                AND julianday(expires_at) > julianday('now')`;
  const charge = () =>
    query<{ id: string; token: string; code_hash: string; code_attempts: number }>(
      `UPDATE magic_links SET code_attempts = COALESCE(code_attempts, 0) + 1
       WHERE ${live()} AND COALESCE(code_attempts, 0) < ?
       RETURNING id, token, code_hash, code_attempts`,
      [address, MAX_CODE_ATTEMPTS]
    );

  let candidates: Awaited<ReturnType<typeof charge>>;
  try {
    candidates = await charge();
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    spentColumn = "used";
    candidates = await charge();
  }

  if (candidates.length === 0) {
    const locked = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM magic_links WHERE ${live()} AND COALESCE(code_attempts, 0) >= ?`,
      [address, MAX_CODE_ATTEMPTS]
    );
    return { ok: false, reason: locked && Number(locked.n) > 0 ? "locked" : "expired" };
  }

  const match = candidates.find((candidate) => {
    const expected = Buffer.from(candidate.code_hash, "hex");
    const actual = Buffer.from(hashSignInCode(candidate.token, code), "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });

  if (!match) {
    const attemptsLeft = Math.max(
      0,
      MAX_CODE_ATTEMPTS - Math.min(...candidates.map((c) => Number(c.code_attempts)))
    );
    return { ok: false, reason: attemptsLeft > 0 ? "wrong_code" : "locked", attemptsLeft };
  }

  const spent = await db.execute({
    sql: `UPDATE magic_links SET ${spentColumn} = TRUE WHERE id = ? AND COALESCE(${spentColumn}, 0) = 0`,
    args: [match.id],
  });
  if (spent.rowsAffected === 0) {
    return { ok: false, reason: "expired" };
  }

  const session = await startSession(address);
  if (!session.ok) {
    return { ok: false, reason: session.reason === "not_allowed" ? "not_allowed" : "expired" };
  }
  return session;
}

// Set session cookie
export async function setSessionCookie(sessionToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

// Get current user from session
export async function getCurrentUser(): Promise<User | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

    if (!sessionToken) {
      return null;
    }

    const hashedToken = hashToken(sessionToken);

    const user = await queryOne<User>(
      `SELECT u.* FROM users u
       JOIN sessions s ON u.id = s.user_id
       WHERE s.token = ? AND julianday(s.expires_at) > julianday('now')`,
      [hashedToken]
    );

    return user;
  } catch (error) {
    console.error("Failed to get current user:", error);
    return null;
  }
}

// Get session from request (for API routes)
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return null;
  }

  const hashedToken = hashToken(sessionToken);

  return queryOne<Session>(
    "SELECT * FROM sessions WHERE token = ? AND julianday(expires_at) > julianday('now')",
    [hashedToken]
  );
}

// Logout - clear session
export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionToken) {
    const hashedToken = hashToken(sessionToken);
    await db.execute({
      sql: "DELETE FROM sessions WHERE token = ?",
      args: [hashedToken],
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

// Require auth - use in server components/actions
export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

// Clean up expired sessions and magic links
export async function cleanupExpiredTokens(): Promise<void> {
  // julianday, not text comparison: rows are ISO strings ("…T…Z"), and the
  // "T" sorts after the space in datetime('now'), which kept expired rows
  // alive until the following UTC day.
  await db.execute("DELETE FROM sessions WHERE julianday(expires_at) < julianday('now')");
  await db.execute("DELETE FROM magic_links WHERE julianday(expires_at) < julianday('now')");
}
