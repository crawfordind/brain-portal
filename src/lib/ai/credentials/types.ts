/**
 * Who pays for an AI call: the vocabulary.
 *
 * Each account can bring its own key for OpenRouter, OpenAI or Anthropic. The
 * server's `OPENROUTER_API_KEY` stays as the operator's key: what runs when a
 * user has none (if the operator allows it), and what runs work that belongs
 * to nobody in particular.
 *
 * Imports nothing, so the Settings panel, the API routes, the standalone MCP
 * server and the tests all share it (same reason as `sharing/types.ts`).
 */

export const AI_PROVIDERS = ["openrouter", "openai", "anthropic", "chatgpt"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * What a call needs from a provider. Kept to the three the app uses, because
 * the providers genuinely differ on them: Anthropic has no embeddings API.
 */
export type AiCapability = "chat" | "vision" | "embedding";

export interface ProviderInfo {
  provider: AiProvider;
  label: string;
  /** One line for the Settings card. */
  description: string;
  /** Where a person creates a key. */
  keysUrl: string;
  /** Key prefixes this provider issues, used to catch a key pasted into the wrong box. */
  keyPrefixes: string[];
  capabilities: AiCapability[];
  /** OpenRouter can mint a key for this app with one click (OAuth PKCE). */
  supportsConnect: boolean;
  /** Signed in to, never pasted (the ChatGPT plan). */
  signInOnly?: boolean;
  /** Paid by a flat subscription rather than per token, so it is tried first. */
  flatRate?: boolean;
}

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  openrouter: {
    provider: "openrouter",
    label: "OpenRouter",
    description: "One key for hundreds of models, including Claude, GPT and Gemini. Covers every feature.",
    keysUrl: "https://openrouter.ai/settings/keys",
    keyPrefixes: ["sk-or-"],
    capabilities: ["chat", "vision", "embedding"],
    supportsConnect: true,
  },
  openai: {
    provider: "openai",
    label: "OpenAI",
    description: "Your OpenAI API key. Covers every feature, including search.",
    keysUrl: "https://platform.openai.com/api-keys",
    keyPrefixes: ["sk-"],
    capabilities: ["chat", "vision", "embedding"],
    supportsConnect: false,
  },
  anthropic: {
    provider: "anthropic",
    label: "Anthropic (Claude)",
    description:
      "Your Claude API key. Claude has no embeddings API, so search indexing needs an OpenRouter or OpenAI key too.",
    keysUrl: "https://platform.claude.com/settings/keys",
    keyPrefixes: ["sk-ant-"],
    capabilities: ["chat", "vision"],
    supportsConnect: false,
  },
  chatgpt: {
    provider: "chatgpt",
    label: "ChatGPT plan",
    description:
      "Sign in with ChatGPT to run AI on your Plus or Pro plan instead of paying per token. Search indexing still needs an OpenRouter or OpenAI key.",
    keysUrl: "https://chatgpt.com/",
    keyPrefixes: [],
    capabilities: ["chat", "vision"],
    supportsConnect: false,
    signInOnly: true,
    flatRate: true,
  },
};

/**
 * The order providers are tried in when the person hasn't picked one: the
 * flat-rate plan first (it costs nothing extra per call), then pay-per-token
 * keys. A preferred provider always goes first.
 */
export const COST_ORDER: AiProvider[] = ["chatgpt", "openrouter", "openai", "anthropic"];

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function providerSupports(provider: AiProvider, capability: AiCapability): boolean {
  return PROVIDER_INFO[provider].capabilities.includes(capability);
}

/**
 * The operator's rule for the server key (`AI_KEY_POLICY`):
 *
 * - `user_or_server` (default): a user's own key when they have one, the
 *   server key otherwise. What every deployment did before keys existed.
 * - `user_only`: every account brings its own key. The server key, if set,
 *   only runs work that belongs to no account.
 * - `server_only`: personal keys are switched off; Settings says so.
 */
export const AI_KEY_POLICIES = ["user_or_server", "user_only", "server_only"] as const;
export type AiKeyPolicy = (typeof AI_KEY_POLICIES)[number];

export function parseAiKeyPolicy(raw: string | undefined | null): AiKeyPolicy {
  const value = raw?.trim().toLowerCase();
  return (AI_KEY_POLICIES as readonly string[]).includes(value ?? "") ? (value as AiKeyPolicy) : "user_or_server";
}

/** Trim and strip the quotes and "Bearer " people paste along with a key. */
export function normalizeApiKey(raw: string): string {
  const unquote = (value: string) => value.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  return unquote(unquote(raw).replace(/^bearer\s+/i, ""));
}

/** The provider a key's prefix belongs to, most specific first. */
export function detectProvider(key: string): AiProvider | null {
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  return null;
}

/**
 * A plain-language reason the key cannot be right for `provider`, or null.
 * Catches the common slip of pasting a key into the wrong provider's box
 * before a network round trip.
 */
export function keyFormatProblem(provider: AiProvider, key: string): string | null {
  if (PROVIDER_INFO[provider].signInOnly) return "A ChatGPT plan is connected with Sign in with ChatGPT, not a pasted key.";
  if (!key) return "Paste your API key.";
  if (/\s/.test(key)) return "That has spaces in it. Copy just the key.";
  if (key.length < 20 || key.length > 512) return "That doesn't look like a complete API key.";
  const detected = detectProvider(key);
  if (detected && detected !== provider) {
    return `That looks like an ${PROVIDER_INFO[detected].label} key. Add it under ${PROVIDER_INFO[detected].label} instead.`;
  }
  if (!PROVIDER_INFO[provider].keyPrefixes.some((prefix) => key.startsWith(prefix))) {
    return `${PROVIDER_INFO[provider].label} keys start with ${PROVIDER_INFO[provider].keyPrefixes.join(" or ")}.`;
  }
  return null;
}

/** What Settings shows instead of the key: "sk-ant-…a1b2". */
export function keyHint(key: string): string {
  const prefix = PROVIDER_INFO[detectProvider(key) ?? "openai"].keyPrefixes.find((p) => key.startsWith(p)) ?? "";
  return `${prefix}…${key.slice(-4)}`;
}

/** Last known health of a stored key, set by a test or by a real call. */
export type AiKeyStatus = "unknown" | "ok" | "invalid" | "unreadable";

/** A stored key as anything outside the server may see it: never the key. */
export interface AiKeySummary {
  provider: AiProvider;
  hint: string;
  status: AiKeyStatus;
  lastError: string | null;
  verifiedAt: string | null;
  source: "manual" | "connect";
  createdAt: string;
  updatedAt: string;
}

/** Routing preferences that decide the order and the backups. */
export interface RoutingOptions {
  /** Try the account's other keys when one fails (default on). */
  fallback: boolean;
  /** After all of those, the server's key (default off; `user_or_server` only). */
  serverFallback: boolean;
  /** The call is background work rather than something the person just asked for. */
  background: boolean;
  /** The person agreed to their ChatGPT plan running background work. */
  chatgptBackground: boolean;
  /** This account may use a ChatGPT plan on this server (see chatgpt/types.ts). */
  chatgptAllowed: boolean;
}

export const DEFAULT_ROUTING: RoutingOptions = {
  fallback: true,
  serverFallback: false,
  background: false,
  chatgptBackground: false,
  chatgptAllowed: true,
};

/**
 * Every key a call may use, in the order to try them. Pure.
 *
 * - The preferred provider first, then the cost order (flat-rate plan, then
 *   pay-per-token keys). Only keys able to do the job count.
 * - With `fallback` on, the rest of the account's capable keys follow as
 *   backups, and with `serverFallback` the server's key last. Off, it is just
 *   the first, which is what `chooseCredential` returns.
 * - A ChatGPT plan runs background work only with the person's consent, and
 *   only for accounts allowed to use one here.
 */
export function chooseCredentialChain(
  input: Parameters<typeof chooseCredential>[0] & { routing?: Partial<RoutingOptions> }
): CredentialChoice[] {
  const routing = { ...DEFAULT_ROUTING, ...input.routing };
  const { policy, capability, hasUser, userProviders, preferred, serverKey } = input;
  const usable = userProviders.filter(
    (p) =>
      p !== "chatgpt" || (routing.chatgptAllowed && (!routing.background || routing.chatgptBackground))
  );
  const first = chooseCredential({ ...input, userProviders: usable });
  if (first.kind !== "user" || !routing.fallback) return [first];

  const order: AiProvider[] = [...(preferred ? [preferred] : []), ...COST_ORDER.filter((p) => p !== preferred)];
  const chain: CredentialChoice[] = order
    .filter((p) => usable.includes(p) && providerSupports(p, capability))
    .map((provider) => ({ kind: "user" as const, provider }));
  if (routing.serverFallback && policy === "user_or_server" && serverKey && hasUser) {
    chain.push({ kind: "server", provider: "openrouter", reason: "no_user_key" });
  }
  return chain;
}

/** The result of the pure choice: which key a call should use. */
export type CredentialChoice =
  | { kind: "user"; provider: AiProvider }
  | { kind: "server"; provider: "openrouter"; reason: "no_user_key" | "capability_gap" | "system" | "policy" }
  | { kind: "none"; code: AiCredentialErrorCode };

export type AiCredentialErrorCode =
  /** Nobody has a key: not the user, not the server. */
  | "no_key"
  /** The operator requires personal keys and this account has none. */
  | "user_key_required"
  /** The account's keys cannot do this job (Claude only, asked for embeddings). */
  | "capability_missing"
  /** The operator switched personal keys off and the server has no key. */
  | "server_key_missing"
  /** The stored key could not be decrypted (the server secret changed). */
  | "key_unreadable";

/**
 * Choose whose key pays for one call. Pure.
 *
 * - A user's own capable key always wins: their preferred provider first, then
 *   a ChatGPT plan, OpenRouter, OpenAI, Anthropic (`COST_ORDER`).
 * - It never silently swaps a key the user chose for the server's because the
 *   user's key is failing; a rejected key fails the call, loudly. The server
 *   key stands in only when the user has *no* key able to do the job.
 */
export function chooseCredential(input: {
  policy: AiKeyPolicy;
  capability: AiCapability;
  /** Null for work that belongs to no account. */
  hasUser: boolean;
  userProviders: AiProvider[];
  preferred: AiProvider | null;
  serverKey: boolean;
}): CredentialChoice {
  const { policy, capability, hasUser, userProviders, preferred, serverKey } = input;

  const server = (reason: "no_user_key" | "capability_gap" | "system" | "policy"): CredentialChoice =>
    serverKey ? { kind: "server", provider: "openrouter", reason } : { kind: "none", code: "no_key" };

  if (policy === "server_only") {
    return serverKey ? { kind: "server", provider: "openrouter", reason: "policy" } : { kind: "none", code: "server_key_missing" };
  }
  if (!hasUser) return server("system");

  const order: AiProvider[] = [
    ...(preferred ? [preferred] : []),
    ...COST_ORDER.filter((p) => p !== preferred),
  ];
  const capable = order.find((p) => userProviders.includes(p) && providerSupports(p, capability));
  if (capable) return { kind: "user", provider: capable };

  if (userProviders.length > 0) {
    // The user has keys, just none that can do this (only Claude, asked to embed).
    if (policy === "user_or_server" && serverKey) return server("capability_gap");
    return { kind: "none", code: "capability_missing" };
  }

  if (policy === "user_only") return { kind: "none", code: "user_key_required" };
  return server("no_user_key");
}

/** What the person should be told, in their terms. Never names a variable's value. */
export function credentialErrorMessage(code: AiCredentialErrorCode, capability: AiCapability): string {
  switch (code) {
    case "user_key_required":
      return "Add your AI provider key in Settings → AI provider to use AI features.";
    case "capability_missing":
      return capability === "embedding"
        ? "Search indexing needs an OpenRouter or OpenAI key. Claude has no embeddings API. Add one in Settings → AI provider."
        : "None of your saved AI keys can do this. Add another provider in Settings → AI provider.";
    case "server_key_missing":
      return "This server's AI key is not set up. Ask the person who runs it to set OPENROUTER_API_KEY.";
    case "key_unreadable":
      return "Your saved AI key can no longer be read (the server's secret changed). Enter it again in Settings → AI provider.";
    case "no_key":
    default:
      return "No AI key is set up. Add your own in Settings → AI provider, or ask the person who runs this server to set one.";
  }
}
