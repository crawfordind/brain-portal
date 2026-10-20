/**
 * Server-side checks shared by the sign-in routes: may this account connect a
 * ChatGPT plan here, and the pending sign-in kept in a short-lived cookie.
 */

import { db } from "@/lib/db/client";
import { chatGptPlanAccess } from "./types";

export const PENDING_COOKIE = "bp_chatgpt_signin";
export const PENDING_COOKIE_PATH = "/api/ai-keys/chatgpt";
export const PENDING_COOKIE_MAX_AGE = 15 * 60;

export interface PendingSignIn {
  verifier: string;
  state: string;
  nonce: string;
  /** Null on a first sign-in; the callback then carries the issued id. */
  clientId: string | null;
  /** The person agreed to background use. */
  background: boolean;
}

export function encodePending(p: PendingSignIn): string {
  return Buffer.from(JSON.stringify(p)).toString("base64url");
}

export function decodePending(raw: string | undefined): PendingSignIn | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<PendingSignIn>;
    if (typeof p.verifier !== "string" || typeof p.state !== "string" || typeof p.nonce !== "string") return null;
    return {
      verifier: p.verifier,
      state: p.state,
      nonce: p.nonce,
      clientId: typeof p.clientId === "string" ? p.clientId : null,
      background: p.background === true,
    };
  } catch {
    return null;
  }
}

export async function accessFor(user: { email: string }, env = process.env) {
  const count = await db
    .execute("SELECT COUNT(*) AS n FROM users")
    .then((r) => Number(r.rows[0]?.n ?? 0))
    .catch(() => 0);
  return chatGptPlanAccess({ email: user.email, env, accountCount: count });
}
