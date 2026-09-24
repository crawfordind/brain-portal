import { cookies } from "next/headers";
import { db, query, queryOne, mutate } from "@/lib/db/client";
import type { User, Session, MagicLink } from "@/lib/db/schema";
import { randomBytes, createHash } from "crypto";
import { mayCreateAccount } from "./signup-policy";
import { getAppUrl } from "@/lib/app-url";

const SESSION_COOKIE = "brain_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const MAGIC_LINK_EXPIRY = 60 * 15; // 15 minutes

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
  const token = generateToken();
  const hashedToken = hashToken(token);
  const expiry = expirySeconds ?? MAGIC_LINK_EXPIRY;
  const expiresAt = new Date(Date.now() + expiry * 1000).toISOString();

  // Delete any existing magic links for this email
  await db.execute({
    sql: "DELETE FROM magic_links WHERE email = ?",
    args: [email],
  });

  // Create new magic link
  await db.execute({
    sql: "INSERT INTO magic_links (email, token, expires_at) VALUES (?, ?, ?)",
    args: [email, hashedToken, expiresAt],
  });

  const appUrl = (baseUrl || getAppUrl()).replace(/\/$/, "");
  return `${appUrl}/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;
}

// Verify magic link and create session
export async function verifyMagicLink(
  email: string,
  token: string
): Promise<{ user: User; sessionToken: string } | null> {
  const hashedToken = hashToken(token);

  // Find valid magic link
  const magicLink = await queryOne<MagicLink>(
    `SELECT * FROM magic_links
     WHERE email = ? AND token = ? AND used = FALSE AND expires_at > datetime('now')`,
    [email, hashedToken]
  );

  if (!magicLink) {
    return null;
  }

  // Delete magic link after use to prevent replay attacks and reduce data exposure
  await db.execute({
    sql: "DELETE FROM magic_links WHERE id = ?",
    args: [magicLink.id],
  });

  // Get the user, creating one only if this deployment's signup policy allows
  // it. Without this gate any address that can receive mail gets an account,
  // an AI budget on the operator's key, and a seat in the database.
  let user = await queryOne<User>("SELECT * FROM users WHERE email = ?", [email]);

  if (!user) {
    if (!mayCreateAccount(email)) {
      return null;
    }
    // Insert new user
    await db.execute({
      sql: "INSERT INTO users (email) VALUES (?)",
      args: [email],
    });
    user = await queryOne<User>("SELECT * FROM users WHERE email = ?", [email]);
  }

  if (!user) {
    return null;
  }

  // Create session
  const sessionToken = generateToken();
  const hashedSessionToken = hashToken(sessionToken);
  const sessionExpiry = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

  await db.execute({
    sql: "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
    args: [user.id, hashedSessionToken, sessionExpiry],
  });

  return { user, sessionToken };
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
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
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
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')",
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
  await db.execute("DELETE FROM sessions WHERE expires_at < datetime('now')");
  await db.execute("DELETE FROM magic_links WHERE expires_at < datetime('now')");
}
