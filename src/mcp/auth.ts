/**
 * MCP Server Authentication
 *
 * Validates API keys for MCP server access. API keys are stored hashed
 * in the mcp_api_keys table and scoped to a specific user.
 *
 * Security model:
 * - Keys are SHA-256 hashed before storage (never stored in plaintext)
 * - Keys are scoped to a single user_id
 * - Keys can be revoked (is_active = false)
 * - All access is logged for audit
 * - Rate limiting per key (configurable)
 */

import { createHash, randomBytes } from "crypto";
import { db, query, queryOne } from "./db";

export interface McpApiKey {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  is_active: number;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AuthenticatedUser {
  userId: string;
  keyId: string;
  keyName: string;
  scopes: string[];
  rateLimitPerMinute: number;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate an API key and return the authenticated user context.
 * Returns null if the key is invalid, expired, or revoked.
 */
export async function validateApiKey(
  apiKey: string
): Promise<AuthenticatedUser | null> {
  const keyHash = hashKey(apiKey);

  const record = await queryOne<McpApiKey>(
    `SELECT * FROM mcp_api_keys
     WHERE key_hash = ?
       AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    [keyHash]
  );

  if (!record) {
    return null;
  }

  // Update last_used_at
  await db.execute(
    `UPDATE mcp_api_keys SET last_used_at = datetime('now') WHERE id = ?`,
    [record.id]
  );

  return {
    userId: record.user_id,
    keyId: record.id,
    keyName: record.name,
    scopes: JSON.parse(record.scopes),
    rateLimitPerMinute: record.rate_limit_per_minute ?? 60,
  };
}

/**
 * Check if the authenticated user has a required scope.
 */
export function hasScope(user: AuthenticatedUser, scope: string): boolean {
  return user.scopes.includes("*") || user.scopes.includes(scope);
}

/**
 * Generate a new API key for a user. Returns the plaintext key (only shown once).
 */
export async function generateApiKey(
  userId: string,
  name: string,
  options: {
    scopes?: string[];
    rateLimitPerMinute?: number;
    expiresInDays?: number;
  } = {}
): Promise<{ key: string; keyPrefix: string; id: string }> {
  const rawKey = `bp_mcp_${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);
  const scopes = JSON.stringify(options.scopes || ["*"]);
  const rateLimit = options.rateLimitPerMinute || 60;
  const expiresAt = options.expiresInDays
    ? new Date(Date.now() + options.expiresInDays * 86400000).toISOString()
    : null;

  const result = await queryOne<{ id: string }>(
    `INSERT INTO mcp_api_keys (user_id, name, key_hash, key_prefix, scopes, rate_limit_per_minute, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [userId, name, keyHash, keyPrefix, scopes, rateLimit, expiresAt]
  );

  return { key: rawKey, keyPrefix, id: result?.id || "" };
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  await db.execute(
    `UPDATE mcp_api_keys SET is_active = FALSE WHERE id = ? AND user_id = ?`,
    [keyId, userId]
  );
  return true;
}

/**
 * List API keys for a user (without key hashes).
 */
export async function listApiKeys(
  userId: string
): Promise<Omit<McpApiKey, "key_hash">[]> {
  const keys = await query<McpApiKey>(
    `SELECT id, user_id, name, key_prefix, scopes, is_active,
            rate_limit_per_minute, last_used_at, expires_at, created_at
     FROM mcp_api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  return keys;
}

/**
 * Authenticate from environment. The MCP_API_KEY env var is checked.
 * Falls back to MCP_USER_ID for development/trusted environments.
 */
export async function authenticateFromEnv(): Promise<AuthenticatedUser> {
  const apiKey = process.env.MCP_API_KEY;
  if (apiKey) {
    const user = await validateApiKey(apiKey);
    if (!user) {
      throw new Error(
        "Invalid or expired MCP_API_KEY. Generate a new key via the Brain Portal settings."
      );
    }
    return user;
  }

  // Development fallback: use MCP_USER_ID directly (trusted environments only)
  const userId = process.env.MCP_USER_ID;
  if (userId) {
    const userExists = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE id = ?",
      [userId]
    );
    if (!userExists) {
      throw new Error(`MCP_USER_ID "${userId}" not found in database.`);
    }
    return {
      userId,
      keyId: "dev-fallback",
      keyName: "Development Mode",
      scopes: ["*"],
      rateLimitPerMinute: 10000,
    };
  }

  throw new Error(
    "Authentication required. Set MCP_API_KEY or MCP_USER_ID environment variable."
  );
}
