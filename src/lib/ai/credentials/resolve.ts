/**
 * Whose key pays for this call: the server side of `chooseCredential`.
 *
 * Reads the account's stored keys (decrypted, cached briefly), applies the
 * operator's `AI_KEY_POLICY`, and returns a key to call with or throws an
 * `AiCredentialError` that says, in the person's terms, what to do.
 */

import type { Client } from "@libsql/client";
import { currentAiUser } from "./context";
import { loadUserAiKeys, readAiPreferences, recordKeyStatus, type AiPreferences, type LoadedKey } from "./store";
import {
  chooseCredential,
  credentialErrorMessage,
  parseAiKeyPolicy,
  type AiCapability,
  type AiCredentialErrorCode,
  type AiProvider,
} from "./types";

export class AiCredentialError extends Error {
  readonly code: AiCredentialErrorCode;
  readonly capability: AiCapability;
  constructor(code: AiCredentialErrorCode, capability: AiCapability) {
    super(credentialErrorMessage(code, capability));
    this.name = "AiCredentialError";
    this.code = code;
    this.capability = capability;
  }
}

export interface ResolvedCredential {
  provider: AiProvider;
  apiKey: string;
  /** "user": the account's own key. "server": the operator's OPENROUTER_API_KEY. */
  source: "user" | "server";
  /** The account the call is for, if any. Used to record a key's health. */
  userId: string | null;
}

type Db = Pick<Client, "execute">;

/**
 * A resolution runs on every model call, so the account's keys are cached
 * briefly. Writes in this process clear the entry at once; another instance
 * sees a change within this window.
 */
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<string, { keys: LoadedKey[]; prefs: AiPreferences; expiresAt: number }>();

export function invalidateAiCredentialCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

async function defaultDb(): Promise<Db> {
  // Imported lazily: the standalone MCP server passes its own client and must
  // not construct the Next.js one.
  const { db } = await import("@/lib/db/client");
  return db;
}

async function loadAccount(db: Db, userId: string) {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit;
  const [keys, prefs] = await Promise.all([loadUserAiKeys(db, userId), readAiPreferences(db, userId)]);
  const entry = { keys, prefs, expiresAt: Date.now() + CACHE_TTL_MS };
  cache.set(userId, entry);
  return entry;
}

export function serverApiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.OPENROUTER_API_KEY?.trim() || null;
}

/**
 * Resolve the key for one call.
 *
 * `userId` comes from the caller or, failing that, from `runWithAiUser`. No
 * user at all means work that belongs to nobody, which only the server key
 * can pay for.
 */
export async function resolveAiCredential(
  capability: AiCapability,
  options: { userId?: string | null; db?: Db; env?: Record<string, string | undefined> } = {}
): Promise<ResolvedCredential> {
  const env = options.env ?? process.env;
  const userId = options.userId ?? currentAiUser();
  const policy = parseAiKeyPolicy(env.AI_KEY_POLICY);
  const serverKey = serverApiKey(env);

  let keys: LoadedKey[] = [];
  let prefs: AiPreferences = { provider: null, modelsByProvider: {} };
  if (userId && policy !== "server_only") {
    try {
      ({ keys, prefs } = await loadAccount(options.db ?? (await defaultDb()), userId));
    } catch (error) {
      // Reading keys failed (database down). Not the same as "has no keys":
      // charging the operator's key for this account's work would be a silent
      // swap, so fail the call instead.
      console.error("[AI keys] could not load keys:", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  const choice = chooseCredential({
    policy,
    capability,
    hasUser: Boolean(userId),
    userProviders: keys.map((k) => k.provider),
    preferred: prefs.provider,
    serverKey: Boolean(serverKey),
  });

  if (choice.kind === "none") throw new AiCredentialError(choice.code, capability);
  if (choice.kind === "server") {
    return { provider: "openrouter", apiKey: serverKey!, source: "server", userId };
  }

  const stored = keys.find((k) => k.provider === choice.provider)!;
  if (!stored.apiKey) throw new AiCredentialError("key_unreadable", capability);
  return { provider: choice.provider, apiKey: stored.apiKey, source: "user", userId };
}

/** The model-selection preferences for a direct provider, from the same cached read. */
export async function directProviderModelChoices(
  userId: string | null,
  provider: AiProvider,
  db?: Db
): Promise<Record<string, string>> {
  if (!userId) return {};
  try {
    const { prefs } = await loadAccount(db ?? (await defaultDb()), userId);
    return prefs.modelsByProvider[provider] ?? {};
  } catch {
    return {};
  }
}

/**
 * Note that a provider rejected a user's key (401), so Settings can say so.
 * Server keys are not recorded per user.
 */
export async function noteKeyRejected(credential: ResolvedCredential, message: string, db?: Db): Promise<void> {
  if (credential.source !== "user" || !credential.userId) return;
  invalidateAiCredentialCache(credential.userId);
  await recordKeyStatus(db ?? (await defaultDb()), credential.userId, credential.provider, "invalid", message);
}

/**
 * A provider's answer that means "this key is not accepted". 401 only: a 403
 * or 402 is a permission, region or credit problem with a valid key.
 */
export function isAuthError(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 401;
}
