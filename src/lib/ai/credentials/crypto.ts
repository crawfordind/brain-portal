/**
 * Encryption for stored provider keys.
 *
 * AES-256-GCM with a key derived (HKDF-SHA256) from `AI_KEY_ENCRYPTION_SECRET`,
 * or `SESSION_SECRET` when that is unset. The user id and provider are bound
 * in as associated data, so a ciphertext copied onto another account's row,
 * or another provider's, fails to decrypt rather than handing one person's
 * key to someone else.
 *
 * Rotating the secret makes every stored key unreadable. That is reported as
 * the key's status ("unreadable") and the person re-enters it; it never falls
 * through to a different key. A dedicated `AI_KEY_ENCRYPTION_SECRET` means
 * rotating `SESSION_SECRET` (which signs everyone out) leaves keys alone.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class AiKeySecretMissingError extends Error {
  constructor() {
    super("Set AI_KEY_ENCRYPTION_SECRET (or SESSION_SECRET) on the server to store personal AI keys.");
    this.name = "AiKeySecretMissingError";
  }
}

export function encryptionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = env.AI_KEY_ENCRYPTION_SECRET?.trim() || env.SESSION_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "brain-portal", "ai-provider-keys:v1", 32));
}

function associatedData(userId: string, provider: string): Buffer {
  return Buffer.from(`${userId}:${provider}`, "utf8");
}

export function encryptApiKey(
  apiKey: string,
  binding: { userId: string; provider: string },
  secret: string | null = encryptionSecret()
): string {
  if (!secret) throw new AiKeySecretMissingError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(associatedData(binding.userId, binding.provider));
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

/** Null when the value cannot be read: wrong secret, tampered, or another row's. */
export function decryptApiKey(
  stored: string,
  binding: { userId: string; provider: string },
  secret: string | null = encryptionSecret()
): string | null {
  if (!secret) return null;
  const [version, body] = stored.split(":", 2);
  if (version !== VERSION || !body) return null;
  try {
    const raw = Buffer.from(body, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), raw.subarray(0, IV_BYTES));
    decipher.setAAD(associatedData(binding.userId, binding.provider));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
