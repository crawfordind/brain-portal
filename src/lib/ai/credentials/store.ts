/**
 * Reading and writing personal AI keys.
 *
 * Every function takes a client, so the Next.js app (`@/lib/db/client`) and
 * the standalone MCP server (`src/mcp/db.ts`) share one implementation.
 * Decrypted keys leave this module only through `loadUserAiKeys`, which is
 * server-side by construction: nothing here is reachable from the browser.
 */

import type { Client, InValue } from "@libsql/client";
import { decryptApiKey, encryptApiKey } from "./crypto";
import { isMissingUserAiKeysTable } from "./schema";
import {
  isAiProvider,
  keyHint,
  type AiKeyStatus,
  type AiKeySummary,
  type AiProvider,
} from "./types";

type Db = Pick<Client, "execute">;

interface KeyRow {
  provider: string;
  encrypted_key: string;
  key_hint: string;
  source: string;
  status: string;
  last_error: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

async function rows<T>(db: Db, sql: string, args: InValue[]): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows.map((row) => ({ ...row }) as unknown as T);
}

function toSummary(row: KeyRow): AiKeySummary | null {
  if (!isAiProvider(row.provider)) return null;
  return {
    provider: row.provider,
    hint: row.key_hint,
    status: (["unknown", "ok", "invalid", "unreadable"].includes(row.status) ? row.status : "unknown") as AiKeyStatus,
    lastError: row.last_error,
    verifiedAt: row.verified_at,
    source: row.source === "connect" ? "connect" : "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** What Settings shows. A database without the table has no keys. */
export async function listUserAiKeys(db: Db, userId: string): Promise<AiKeySummary[]> {
  try {
    const found = await rows<KeyRow>(
      db,
      "SELECT * FROM user_ai_keys WHERE user_id = ? ORDER BY created_at",
      [userId]
    );
    return found.map(toSummary).filter((s): s is AiKeySummary => s !== null);
  } catch (error) {
    if (isMissingUserAiKeysTable(error)) return [];
    throw error;
  }
}

export interface LoadedKey {
  provider: AiProvider;
  /** Null when it could not be decrypted: the person must enter it again. */
  apiKey: string | null;
  status: AiKeyStatus;
}

/** Decrypted keys, for making calls. Server-side only. */
export async function loadUserAiKeys(db: Db, userId: string): Promise<LoadedKey[]> {
  let found: KeyRow[];
  try {
    found = await rows<KeyRow>(db, "SELECT * FROM user_ai_keys WHERE user_id = ?", [userId]);
  } catch (error) {
    if (isMissingUserAiKeysTable(error)) return [];
    throw error;
  }
  return found
    .filter((row) => isAiProvider(row.provider))
    .map((row) => {
      const provider = row.provider as AiProvider;
      const apiKey = decryptApiKey(row.encrypted_key, { userId, provider });
      return {
        provider,
        apiKey,
        status: apiKey === null ? "unreadable" : ((row.status as AiKeyStatus) || "unknown"),
      };
    });
}

/** Store (or replace) one provider's key. */
export async function saveUserAiKey(
  db: Db,
  input: {
    userId: string;
    provider: AiProvider;
    apiKey: string;
    source?: "manual" | "connect";
    /** Set when the key was just tested against the provider. */
    verified?: boolean;
    /** What Settings shows instead of the key; derived from the key when omitted. */
    hint?: string;
  }
): Promise<void> {
  const encrypted = encryptApiKey(input.apiKey, { userId: input.userId, provider: input.provider });
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO user_ai_keys (user_id, provider, encrypted_key, key_hint, source, status, last_error, verified_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(user_id, provider) DO UPDATE SET
            encrypted_key = excluded.encrypted_key,
            key_hint = excluded.key_hint,
            source = excluded.source,
            status = excluded.status,
            last_error = NULL,
            verified_at = excluded.verified_at,
            updated_at = excluded.updated_at`,
    args: [
      input.userId,
      input.provider,
      encrypted,
      input.hint ?? keyHint(input.apiKey),
      input.source ?? "manual",
      input.verified ? "ok" : "unknown",
      input.verified ? now : null,
      now,
      now,
    ],
  });
}

export async function deleteUserAiKey(db: Db, userId: string, provider: AiProvider): Promise<boolean> {
  const result = await db.execute({
    sql: "DELETE FROM user_ai_keys WHERE user_id = ? AND provider = ?",
    args: [userId, provider],
  });
  return result.rowsAffected > 0;
}

/**
 * Record what a test or a real call learned about a key. Best effort: a
 * failure to write the status must never turn a working call into a failed one.
 */
export async function recordKeyStatus(
  db: Db,
  userId: string,
  provider: AiProvider,
  status: AiKeyStatus,
  lastError: string | null = null
): Promise<void> {
  try {
    await db.execute({
      sql: `UPDATE user_ai_keys
            SET status = ?, last_error = ?, verified_at = CASE WHEN ? = 'ok' THEN ? ELSE verified_at END
            WHERE user_id = ? AND provider = ?`,
      args: [status, lastError ? lastError.slice(0, 300) : null, status, new Date().toISOString(), userId, provider],
    });
  } catch (error) {
    console.error("[AI keys] could not record key status:", error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Preferences: which provider to use first, and per-provider model choices.
// Stored on users.preferences beside the existing `models` key; no migration.
// ---------------------------------------------------------------------------

export interface AiPreferences {
  provider: AiProvider | null;
  /** Model ids chosen per slot, per direct provider (OpenRouter uses `models`). */
  modelsByProvider: Partial<Record<AiProvider, Record<string, string>>>;
  /** Backups and consent; see `RoutingOptions`. */
  routing: { fallback: boolean; serverFallback: boolean; chatgptBackground: boolean };
}

const DEFAULT_ROUTING_PREFS: AiPreferences["routing"] = { fallback: true, serverFallback: false, chatgptBackground: false };

export function parseAiPreferences(raw: string | null | undefined): AiPreferences {
  const empty: AiPreferences = { provider: null, modelsByProvider: {}, routing: { ...DEFAULT_ROUTING_PREFS } };
  if (!raw) return empty;
  try {
    const blob = JSON.parse(raw) as Record<string, unknown> | null;
    if (!blob || typeof blob !== "object") return empty;
    const provider = isAiProvider(blob.ai_provider) ? blob.ai_provider : null;
    const byProvider: AiPreferences["modelsByProvider"] = {};
    const stored = blob.models_by_provider;
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
        if (!isAiProvider(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const slots: Record<string, string> = {};
        for (const [slot, id] of Object.entries(value as Record<string, unknown>)) {
          if (typeof id === "string" && id.trim()) slots[slot] = id.trim();
        }
        byProvider[key] = slots;
      }
    }
    const r = blob.ai_routing && typeof blob.ai_routing === "object" ? (blob.ai_routing as Record<string, unknown>) : {};
    const routing = {
      fallback: typeof r.fallback === "boolean" ? r.fallback : DEFAULT_ROUTING_PREFS.fallback,
      serverFallback: typeof r.server_fallback === "boolean" ? r.server_fallback : DEFAULT_ROUTING_PREFS.serverFallback,
      chatgptBackground:
        typeof r.chatgpt_background === "boolean" ? r.chatgpt_background : DEFAULT_ROUTING_PREFS.chatgptBackground,
    };
    return { provider, modelsByProvider: byProvider, routing };
  } catch {
    return empty;
  }
}

export async function readAiPreferences(db: Db, userId: string): Promise<AiPreferences> {
  const found = await rows<{ preferences: string | null }>(db, "SELECT preferences FROM users WHERE id = ?", [userId]);
  return parseAiPreferences(found[0]?.preferences);
}

/**
 * Read-modify-write on the preferences blob, touching only the AI keys: the
 * blob holds unrelated settings.
 */
export async function updateAiPreferences(
  db: Db,
  userId: string,
  update: {
    provider?: AiProvider | null;
    models?: { provider: AiProvider; slots: Record<string, string | null> };
    routing?: Partial<AiPreferences["routing"]>;
  }
): Promise<AiPreferences> {
  const found = await rows<{ preferences: string | null }>(db, "SELECT preferences FROM users WHERE id = ?", [userId]);
  let blob: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(found[0]?.preferences || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) blob = parsed as Record<string, unknown>;
  } catch {
    // Corrupt preferences shouldn't block saving.
  }
  const current = parseAiPreferences(found[0]?.preferences);

  if (update.provider !== undefined) {
    if (update.provider === null) delete blob.ai_provider;
    else blob.ai_provider = update.provider;
  }
  if (update.models) {
    const slots = { ...(current.modelsByProvider[update.models.provider] ?? {}) };
    for (const [slot, id] of Object.entries(update.models.slots)) {
      if (id === null || id === "") delete slots[slot];
      else slots[slot] = id;
    }
    blob.models_by_provider = { ...current.modelsByProvider, [update.models.provider]: slots };
  }

  if (update.routing) {
    const next = { ...current.routing, ...update.routing };
    blob.ai_routing = {
      fallback: next.fallback,
      server_fallback: next.serverFallback,
      chatgpt_background: next.chatgptBackground,
    };
  }

  await db.execute({
    sql: "UPDATE users SET preferences = ?, updated_at = datetime('now') WHERE id = ?",
    args: [JSON.stringify(blob), userId],
  });
  return parseAiPreferences(JSON.stringify(blob));
}
