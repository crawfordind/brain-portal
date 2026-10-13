import { cookies } from "next/headers";
import { db, query, queryOne, mutate } from "@/lib/db/client";
import type { User, Session, MagicLink } from "@/lib/db/schema";
import { randomBytes, createHash } from "crypto";
import { mayCreateAccount } from "./signup-policy";
import { getAppUrl } from "@/lib/app-url";
import {
  assessMagicLink,
  magicLinkTtlMinutes,
  normalizeEmail,
  MAX_ACTIVE_LINKS_PER_EMAIL,
  type MagicLinkFailure,
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

// Create a magic link for email login
export async function createMagicLink(email: string, baseUrl?: string, expirySeconds?: number): Promise<string> {
  const address = normalizeEmail(email);
  const token = generateToken();
  const hashedToken = hashToken(token);
  const expiry = expirySeconds ?? magicLinkTtlMinutes() * 60;
  const expiresAt = new Date(Date.now() + expiry * 1000).toISOString();

  // Earlier links for this address stay valid. This used to delete every one
  // of them, so pressing "send again" while the first email sat in a queue
  // killed the link that then arrived. Only spent links are cleared, plus the
  // oldest beyond a small cap so one address cannot pile them up.
  await db.batch(
    [
      {
        sql: `DELETE FROM magic_links
              WHERE lower(email) = ?
                AND (used = TRUE OR julianday(expires_at) <= julianday('now'))`,
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
      {
        sql: "INSERT INTO magic_links (email, token, expires_at) VALUES (?, ?, ?)",
        args: [address, hashedToken, expiresAt],
      },
    ],
    "write"
  );

  const appUrl = (baseUrl || getAppUrl()).replace(/\/$/, "");
  return `${appUrl}/auth/verify?token=${token}&email=${encodeURIComponent(address)}`;
}

export type VerifyMagicLinkResult =
  | { ok: true; user: User; sessionToken: string }
  | { ok: false; reason: MagicLinkFailure };

// Verify magic link and create session
export async function verifyMagicLink(email: string, token: string): Promise<VerifyMagicLinkResult> {
  const address = normalizeEmail(email);
  const hashedToken = hashToken(token);

  // Looked up by token alone (256 random bits, UNIQUE) so the failure can be
  // named: "already used" and "expired" need different advice from "invalid".
  const magicLink = await queryOne<MagicLink & StoredMagicLink>(
    "SELECT * FROM magic_links WHERE token = ?",
    [hashedToken]
  );

  const assessment = assessMagicLink(magicLink, address);
  if (!assessment.ok || !magicLink) {
    return { ok: false, reason: assessment.ok ? "invalid" : assessment.reason };
  }

  // Spend it atomically: two clicks racing each other (or a click racing a
  // scanner) get one session between them, never two.
  const spent = await db.execute({
    sql: "UPDATE magic_links SET used = TRUE WHERE id = ? AND used = FALSE",
    args: [magicLink.id],
  });
  if (spent.rowsAffected === 0) {
    return { ok: false, reason: "used" };
  }

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
