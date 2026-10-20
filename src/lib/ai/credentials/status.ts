/**
 * Everything the Settings panel shows about an account's AI keys, in one read.
 *
 * Never a key: only hints, statuses, and which provider and whose key each
 * kind of work will actually run on, answered by the same resolver every
 * model call uses so the panel cannot disagree with what happens.
 */

import { db } from "@/lib/db/client";
import { encryptionSecret } from "./crypto";
import { listUserAiKeys, readAiPreferences } from "./store";
import { AiCredentialError, resolveAiCredential, serverApiKey } from "./resolve";
import {
  AI_PROVIDERS,
  PROVIDER_INFO,
  parseAiKeyPolicy,
  type AiCapability,
  type AiKeyPolicy,
  type AiKeySummary,
  type AiProvider,
  type ProviderInfo,
} from "./types";
import { directModelIds } from "../models/direct-catalog";
import { DIRECT_PROVIDER_CANDIDATES, directModelChain, type DirectProvider } from "../models/providers";
import { MODEL_SLOTS, SLOT_DEFINITIONS, type ModelSlot } from "../models/slots";

export type EffectiveRoute =
  | { ok: true; provider: AiProvider; source: "user" | "server" }
  | { ok: false; code: string; message: string };

export interface DirectModelSlot {
  slot: ModelSlot;
  label: string;
  description: string;
  selected: string | null;
  /** What runs now: the first model in the chain. */
  current: string;
  /** Model ids the key can use, or null when the list couldn't be fetched. */
  options: string[] | null;
}

export interface AiKeysStatus {
  policy: AiKeyPolicy;
  personalKeysEnabled: boolean;
  /** False when the server has no secret to encrypt keys with. */
  encryptionReady: boolean;
  /** Presence only, never the value. */
  serverKey: boolean;
  providers: ProviderInfo[];
  keys: AiKeySummary[];
  preferred: AiProvider | null;
  effective: Record<AiCapability, EffectiveRoute>;
  /** Model choices for the provider running chat, when it is OpenAI or Anthropic. */
  directModels: { provider: DirectProvider; slots: DirectModelSlot[] } | null;
}

async function route(capability: AiCapability, userId: string): Promise<{ route: EffectiveRoute; apiKey?: string }> {
  try {
    const credential = await resolveAiCredential(capability, { userId });
    return { route: { ok: true, provider: credential.provider, source: credential.source }, apiKey: credential.apiKey };
  } catch (error) {
    if (error instanceof AiCredentialError) return { route: { ok: false, code: error.code, message: error.message } };
    return { route: { ok: false, code: "error", message: "Couldn't read your AI keys. Try again." } };
  }
}

export async function getAiKeysStatus(userId: string, env = process.env): Promise<AiKeysStatus> {
  const policy = parseAiKeyPolicy(env.AI_KEY_POLICY);
  const [keys, prefs, chat, vision, embedding] = await Promise.all([
    listUserAiKeys(db, userId),
    readAiPreferences(db, userId),
    route("chat", userId),
    route("vision", userId),
    route("embedding", userId),
  ]);

  let directModels: AiKeysStatus["directModels"] = null;
  if (chat.route.ok && (chat.route.provider === "openai" || chat.route.provider === "anthropic") && chat.apiKey) {
    const provider = chat.route.provider;
    const available = await directModelIds(provider, chat.apiKey);
    const chosen = prefs.modelsByProvider[provider] ?? {};
    directModels = {
      provider,
      slots: MODEL_SLOTS.filter((slot) => (DIRECT_PROVIDER_CANDIDATES[provider][slot]?.length ?? 0) > 0 && slot !== "embedding").map(
        (slot) => ({
          slot,
          label: SLOT_DEFINITIONS[slot].label,
          description: SLOT_DEFINITIONS[slot].description,
          selected: chosen[slot] ?? null,
          current: directModelChain({ provider, slot, userChoice: chosen[slot], availableIds: available })[0],
          options: available ? [...available].filter((id) => usableForChat(provider, id)).sort() : null,
        })
      ),
    };
  }

  return {
    policy,
    personalKeysEnabled: policy !== "server_only",
    encryptionReady: Boolean(encryptionSecret(env)),
    serverKey: Boolean(serverApiKey(env)),
    providers: AI_PROVIDERS.map((p) => PROVIDER_INFO[p]),
    keys,
    preferred: prefs.provider,
    effective: { chat: chat.route, vision: vision.route, embedding: embedding.route },
    directModels,
  };
}

/** Hide embedding, audio and image-generation models from a chat picker. */
export function usableForChat(provider: DirectProvider, id: string): boolean {
  if (provider === "anthropic") return id.startsWith("claude-");
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !/(embedding|audio|realtime|transcribe|tts|image|search|moderation|whisper|dall-e)/.test(id);
}
