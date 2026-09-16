/**
 * MCP API Key management (Next.js-side).
 *
 * Mirrors `src/mcp/auth.ts` but uses the Next.js-shared Turso client so
 * these functions can run inside API routes. Keys are hashed with SHA-256
 * before storage; the plaintext key is returned exactly once at creation.
 */

import { createHash, randomBytes } from "crypto";
import { db, query, queryOne } from "@/lib/db/client";

/**
 * Canonical scope list. `*` grants everything.
 * Scopes are checked by `src/mcp/guard.ts` on every tool/resource/prompt call.
 */
export const MCP_SCOPES = [
  "notes:read",
  "notes:write",
  "tasks:read",
  "tasks:write",
  "projects:read",
  "projects:write",
  "captures:read",
  "captures:write",
  "search:read",
  "ai:search",
  "ai:insights",
  "ai:delegate",
  "resources:read",
  "prompts:read",
  "crm:read",
  "crm:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number] | "*";

/** Preset scope bundles surfaced in the UI. */
export const SCOPE_PRESETS: Record<string, McpScope[]> = {
  full_access: ["*"],
  read_only: [
    "notes:read",
    "tasks:read",
    "projects:read",
    "captures:read",
    "search:read",
    "resources:read",
    "prompts:read",
    "crm:read",
  ],
  ai_only: [
    "ai:search",
    "ai:insights",
    "ai:delegate",
    "search:read",
    "resources:read",
    "prompts:read",
  ],
};

export interface McpKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  is_active: number;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface McpKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  scopes: McpScope[];
  is_active: boolean;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function toSummary(row: McpKeyRow): McpKeySummary {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: JSON.parse(row.scopes) as McpScope[],
    is_active: Boolean(row.is_active),
    rate_limit_per_minute: row.rate_limit_per_minute,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export async function listKeysForUser(userId: string): Promise<McpKeySummary[]> {
  const rows = await query<McpKeyRow>(
    `SELECT id, user_id, name, key_prefix, scopes, is_active,
            rate_limit_per_minute, last_used_at, expires_at, created_at
       FROM mcp_api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(toSummary);
}

export interface CreateKeyOptions {
  name: string;
  scopes?: McpScope[];
  rateLimitPerMinute?: number;
  /** Days until expiry. Omit for no expiration. */
  expiresInDays?: number;
}

export async function createKeyForUser(
  userId: string,
  opts: CreateKeyOptions
): Promise<{ key: string; summary: McpKeySummary }> {
  const scopes: McpScope[] = opts.scopes?.length ? opts.scopes : ["*"];
  const rateLimit = opts.rateLimitPerMinute ?? 60;
  const expiresAt = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString()
    : null;

  const rawKey = `bp_mcp_${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);

  const inserted = await queryOne<McpKeyRow>(
    `INSERT INTO mcp_api_keys (
       user_id, name, key_hash, key_prefix, scopes,
       rate_limit_per_minute, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id, user_id, name, key_prefix, scopes, is_active,
               rate_limit_per_minute, last_used_at, expires_at, created_at`,
    [
      userId,
      opts.name,
      keyHash,
      keyPrefix,
      JSON.stringify(scopes),
      rateLimit,
      expiresAt,
    ]
  );

  if (!inserted) {
    throw new Error("Failed to create MCP API key");
  }

  return { key: rawKey, summary: toSummary(inserted) };
}

/** Revoke (soft-delete) a key owned by `userId`. Returns true if a row changed. */
export async function revokeKeyForUser(
  userId: string,
  keyId: string
): Promise<boolean> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM mcp_api_keys WHERE id = ? AND user_id = ?`,
    [keyId, userId]
  );
  if (!existing) return false;

  await db.execute({
    sql: `UPDATE mcp_api_keys
            SET is_active = FALSE, updated_at = datetime('now')
          WHERE id = ? AND user_id = ?`,
    args: [keyId, userId],
  });
  return true;
}

/** Validate that a scope list contains only canonical scopes or the wildcard. */
export function validateScopes(scopes: unknown): McpScope[] | null {
  if (!Array.isArray(scopes) || scopes.length === 0) return null;
  const valid = new Set<string>(MCP_SCOPES);
  for (const s of scopes) {
    if (typeof s !== "string") return null;
    if (s !== "*" && !valid.has(s)) return null;
  }
  return scopes as McpScope[];
}
