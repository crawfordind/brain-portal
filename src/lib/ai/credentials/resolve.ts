/**
 * Whose key pays for this call: the server side of `chooseCredential`.
 *
 * Reads the account's stored keys (decrypted, cached briefly), applies the
 * operator's `AI_KEY_POLICY`, and returns a key to call with or throws an
 * `AiCredentialError` that says, in the person's terms, what to do.
 */

import type { Client } from "@libsql/client";
import { currentAiUser, isBackgroundAi } from "./context";
import { loadUserAiKeys, readAiPreferences, recordKeyStatus, type AiPreferences, type LoadedKey } from "./store";
import { chatGptPlanAccess, parseChatGptSession } from "../chatgpt/types";
import {
  chooseCredential,
  chooseCredentialChain,
  credentialErrorMessage,
  parseAiKeyPolicy,
  type AiCapability,
  type AiCredentialErrorCode,
  type AiProvider,
  type CredentialChoice,
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
const cache = new Map<
  string,
  { keys: LoadedKey[]; prefs: AiPreferences; email: string; accountCount: number; expiresAt: number }
>();

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
  const [keys, prefs, who] = await Promise.all([
    loadUserAiKeys(db, userId),
    readAiPreferences(db, userId),
    db
      .execute({ sql: "SELECT email, (SELECT COUNT(*) FROM users) AS n FROM users WHERE id = ?", args: [userId] })
      .then((r) => ({ email: String(r.rows[0]?.email ?? ""), accountCount: Number(r.rows[0]?.n ?? 0) }))
      .catch(() => ({ email: "", accountCount: 0 })),
  ]);
  const entry = { keys, prefs, ...who, expiresAt: Date.now() + CACHE_TTL_MS };
  cache.set(userId, entry);
  return entry;
}

export function serverApiKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.OPENROUTER_API_KEY?.trim() || null;
}

type ResolveOptions = { userId?: string | null; db?: Db; env?: Record<string, string | undefined> };

/**
 * Resolve the key for one call: the first of `resolveAiCredentialChain`,
 * without backups.
 *
 * `userId` comes from the caller or, failing that, from `runWithAiUser`. No
 * user at all means work that belongs to nobody, which only the server key
 * can pay for.
 */
export async function resolveAiCredential(capability: AiCapability, options: ResolveOptions = {}): Promise<ResolvedCredential> {
  const [first] = await resolveChain(capability, options, false);
  return first;
}

/**
 * Every credential a call may use, best first: the preferred provider, then
 * the cheapest (a flat-rate ChatGPT plan before pay-per-token keys), then,
 * when the person turned backups on, the rest of their keys and optionally
 * the server's. The caller tries them in order (see `client.ts`). Never empty:
 * it throws `AiCredentialError` instead.
 */
export async function resolveAiCredentialChain(capability: AiCapability, options: ResolveOptions = {}): Promise<ResolvedCredential[]> {
  return resolveChain(capability, options, true);
}

async function resolveChain(capability: AiCapability, options: ResolveOptions, withBackups: boolean): Promise<ResolvedCredential[]> {
  const env = options.env ?? process.env;
  const userId = options.userId ?? currentAiUser();
  const policy = parseAiKeyPolicy(env.AI_KEY_POLICY);
  const serverKey = serverApiKey(env);
  const db = userId && policy !== "server_only" ? options.db ?? (await defaultDb()) : null;

  let account: Awaited<ReturnType<typeof loadAccount>> | null = null;
  if (userId && db) {
    try {
      account = await loadAccount(db, userId);
    } catch (error) {
      // Reading keys failed (database down). Not the same as "has no keys":
      // charging the operator's key for this account's work would be a silent
      // swap, so fail the call instead.
      console.error("[AI keys] could not load keys:", error instanceof Error ? error.message : error);
      throw error;
    }
  }
  const keys: LoadedKey[] = account?.keys ?? [];
  const prefs: AiPreferences = account?.prefs ?? {
    provider: null,
    modelsByProvider: {},
    routing: { fallback: true, serverFallback: false, chatgptBackground: false },
  };

  const input = {
    policy,
    capability,
    hasUser: Boolean(userId),
    userProviders: keys.map((k) => k.provider),
    preferred: prefs.provider,
    serverKey: Boolean(serverKey),
  };
  const routing = {
    fallback: withBackups && prefs.routing.fallback,
    serverFallback: prefs.routing.serverFallback,
    background: isBackgroundAi(),
    chatgptBackground: prefs.routing.chatgptBackground,
    chatgptAllowed: account ? chatGptPlanAccess({ email: account.email, env, accountCount: account.accountCount }).allowed : false,
  };
  const choices: CredentialChoice[] = withBackups
    ? chooseCredentialChain({ ...input, routing })
    : chooseCredentialChain({ ...input, routing: { ...routing, fallback: false } });
  if (choices.length === 0) choices.push(chooseCredential(input));

  const resolved: ResolvedCredential[] = [];
  let lastError: unknown = null;
  for (const choice of choices) {
    if (choice.kind === "none") throw new AiCredentialError(choice.code, capability);
    if (choice.kind === "server") {
      resolved.push({ provider: "openrouter", apiKey: serverKey!, source: "server", userId });
      continue;
    }
    const stored = keys.find((k) => k.provider === choice.provider)!;
    if (!stored.apiKey) {
      lastError = new AiCredentialError("key_unreadable", capability);
      continue;
    }
    if (choice.provider !== "chatgpt") {
      resolved.push({ provider: choice.provider, apiKey: stored.apiKey, source: "user", userId });
      continue;
    }
    // A ChatGPT plan is stored as a sign-in; turn it into a current access token.
    const session = parseChatGptSession(stored.apiKey);
    if (!session) {
      lastError = new AiCredentialError("key_unreadable", capability);
      continue;
    }
    try {
      const { chatGptAccessToken } = await import("../chatgpt/session");
      const token = await chatGptAccessToken(db!, userId!, session, { onRefreshed: () => invalidateAiCredentialCache(userId!) });
      resolved.push({ provider: "chatgpt", apiKey: token, source: "user", userId });
    } catch (error) {
      invalidateAiCredentialCache(userId!);
      lastError = error;
    }
  }
  if (resolved.length === 0) throw lastError ?? new AiCredentialError("no_key", capability);
  return resolved;
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
