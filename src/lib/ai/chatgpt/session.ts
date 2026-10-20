/**
 * A ChatGPT sign-in as the rest of the app uses it: a current access token.
 *
 * The session is stored encrypted in `user_ai_keys` (provider "chatgpt") in
 * place of an API key. Access tokens last an hour; refresh tokens work once
 * and are replaced on every refresh, so refreshing is serialized across
 * server instances with a short database lease. Whoever loses the race waits
 * for the winner's new token instead of spending the old one.
 */

import type { Client } from "@libsql/client";
import { decryptApiKey, encryptApiKey } from "../credentials/crypto";
import { ChatGptAuthError, refreshChatGptSession } from "./oauth";
import { needsRefresh, parseChatGptSession, type ChatGptSession } from "./types";

type Db = Pick<Client, "execute">;

const LEASE_MS = 30_000;
const WAIT_STEP_MS = 500;
const WAIT_MAX_MS = 10_000;

export function chatGptHint(session: Pick<ChatGptSession, "email">): string {
  return session.email ? `ChatGPT plan · ${session.email}` : "ChatGPT plan";
}

export async function saveChatGptSession(db: Db, userId: string, session: ChatGptSession, verified = true): Promise<void> {
  const encrypted = encryptApiKey(JSON.stringify(session), { userId, provider: "chatgpt" });
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO user_ai_keys (user_id, provider, encrypted_key, key_hint, source, status, last_error, verified_at, created_at, updated_at)
          VALUES (?, 'chatgpt', ?, ?, 'connect', ?, NULL, ?, ?, ?)
          ON CONFLICT(user_id, provider) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            key_hint = excluded.key_hint,
            source = excluded.source,
            status = excluded.status,
            last_error = NULL,
            verified_at = COALESCE(excluded.verified_at, user_ai_keys.verified_at),
            updated_at = excluded.updated_at`,
    args: [userId, encrypted, chatGptHint(session), verified ? "ok" : "unknown", verified ? now : null, now, now],
  });
}

async function readSession(db: Db, userId: string): Promise<ChatGptSession | null> {
  const result = await db.execute({
    sql: "SELECT encrypted_key FROM user_ai_keys WHERE user_id = ? AND provider = 'chatgpt'",
    args: [userId],
  });
  const raw = result.rows[0]?.encrypted_key;
  if (typeof raw !== "string") return null;
  return parseChatGptSession(decryptApiKey(raw, { userId, provider: "chatgpt" }));
}

async function takeLease(db: Db, userId: string): Promise<boolean | null> {
  try {
    const result = await db.execute({
      sql: `UPDATE user_ai_keys SET refresh_lock_until = ?
            WHERE user_id = ? AND provider = 'chatgpt'
              AND (refresh_lock_until IS NULL OR julianday(refresh_lock_until) < julianday('now'))`,
      args: [new Date(Date.now() + LEASE_MS).toISOString(), userId],
    });
    return result.rowsAffected > 0;
  } catch (error) {
    // The lease column arrives with `npm run db:migrate`; without it, refresh unguarded.
    if (/no such column:\s*refresh_lock_until/i.test(error instanceof Error ? error.message : String(error))) return null;
    throw error;
  }
}

async function releaseLease(db: Db, userId: string): Promise<void> {
  try {
    await db.execute({
      sql: "UPDATE user_ai_keys SET refresh_lock_until = NULL WHERE user_id = ? AND provider = 'chatgpt'",
      args: [userId],
    });
  } catch {
    // The lease expires on its own.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The current access token for this account's ChatGPT sign-in, refreshing it
 * when it is about to lapse. Throws `ChatGptAuthError` when the person has to
 * sign in again (and records that, so Settings says so).
 */
export async function chatGptAccessToken(
  db: Db,
  userId: string,
  session: ChatGptSession,
  deps: { fetchImpl?: typeof fetch; onRefreshed?: () => void } = {}
): Promise<string> {
  if (!needsRefresh(session)) return session.accessToken;

  const lease = await takeLease(db, userId);
  if (lease === false) {
    // Someone else is refreshing: wait for their token rather than racing them.
    for (let waited = 0; waited < WAIT_MAX_MS; waited += WAIT_STEP_MS) {
      await sleep(WAIT_STEP_MS);
      const latest = await readSession(db, userId);
      if (latest && !needsRefresh(latest)) {
        deps.onRefreshed?.();
        return latest.accessToken;
      }
    }
    throw new ChatGptAuthError("Renewing the ChatGPT sign-in is taking too long. Try again in a moment.", {
      needsSignIn: false,
      status: 503,
    });
  }

  try {
    // Another instance may have refreshed between our read and our lease.
    const latest = (await readSession(db, userId)) ?? session;
    if (!needsRefresh(latest)) return latest.accessToken;
    const next = await refreshChatGptSession(latest, deps.fetchImpl);
    await saveChatGptSession(db, userId, next);
    deps.onRefreshed?.();
    return next.accessToken;
  } catch (error) {
    if (error instanceof ChatGptAuthError && error.needsSignIn) {
      try {
        await db.execute({
          sql: "UPDATE user_ai_keys SET status = 'invalid', last_error = ? WHERE user_id = ? AND provider = 'chatgpt'",
          args: [error.message.slice(0, 300), userId],
        });
      } catch {
        // Best effort.
      }
    }
    throw error;
  } finally {
    if (lease) await releaseLease(db, userId);
  }
}
