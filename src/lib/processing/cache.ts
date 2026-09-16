import crypto from "crypto";
import { db, queryOne, mutate } from "@/lib/db/client";
import type { AICache } from "@/lib/db/schema";

export type Tier = "local" | "embedding" | "fast_llm" | "full_llm";

export interface CacheOptions {
  ttlHours?: number; // null = never expires
  operation: string;
  tier: Tier;
  model?: string;
  tokensUsed?: number;
  costCents?: number;
}

/**
 * Generate a cache key from operation type and inputs
 */
export function generateCacheKey(operation: string, inputs: unknown): string {
  const content = JSON.stringify({ operation, inputs });
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Generate a content hash for change detection
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Get a cached response
 */
export async function getCached<T>(
  userId: string,
  key: string
): Promise<T | null> {
  const cached = await queryOne<AICache>(
    `SELECT * FROM ai_cache
     WHERE cache_key = ? AND user_id = ?
     AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    [key, userId]
  );

  if (cached) {
    // Update hit count
    await db.execute({
      sql: `UPDATE ai_cache
            SET hit_count = hit_count + 1, last_hit_at = datetime('now')
            WHERE cache_key = ?`,
      args: [key],
    });
    return JSON.parse(cached.output) as T;
  }
  return null;
}

/**
 * Set a cache entry
 */
export async function setCache<T>(
  userId: string,
  key: string,
  value: T,
  options: CacheOptions
): Promise<void> {
  const expiresAt = options.ttlHours
    ? new Date(Date.now() + options.ttlHours * 60 * 60 * 1000).toISOString()
    : null;

  await db.execute({
    sql: `INSERT OR REPLACE INTO ai_cache
          (user_id, cache_key, operation_type, model, tier, input_hash, output,
           tokens_used, cost_cents, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      userId,
      key,
      options.operation,
      options.model || null,
      options.tier,
      key, // input_hash same as cache_key
      JSON.stringify(value),
      options.tokensUsed || 0,
      options.costCents || 0,
      expiresAt,
    ],
  });
}

/**
 * Invalidate cache entries matching a pattern
 * Pattern can be a cache key prefix or operation type
 */
export async function invalidateCache(
  userId: string,
  options: { key?: string; operation?: string; entityId?: string }
): Promise<number> {
  let sql = `DELETE FROM ai_cache WHERE user_id = ?`;
  const args: (string | number)[] = [userId];

  if (options.key) {
    sql += ` AND cache_key = ?`;
    args.push(options.key);
  }

  if (options.operation) {
    sql += ` AND operation_type = ?`;
    args.push(options.operation);
  }

  // For entity-based invalidation, we search in the output JSON
  // This is less efficient but works for our use case
  if (options.entityId) {
    sql += ` AND output LIKE ?`;
    args.push(`%${options.entityId}%`);
  }

  const result = await db.execute({ sql, args });
  return result.rowsAffected;
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  const result = await db.execute({
    sql: `DELETE FROM ai_cache WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
    args: [],
  });
  return result.rowsAffected;
}

/**
 * Get cache statistics for a user
 */
export async function getCacheStats(userId: string): Promise<{
  totalEntries: number;
  totalHits: number;
  totalTokens: number;
  totalCostCents: number;
  byTier: Record<Tier, { count: number; tokens: number; cost: number }>;
}> {
  const stats = await queryOne<{
    total_entries: number;
    total_hits: number;
    total_tokens: number;
    total_cost: number;
  }>(
    `SELECT
      COUNT(*) as total_entries,
      SUM(hit_count) as total_hits,
      SUM(tokens_used) as total_tokens,
      SUM(cost_cents) as total_cost
     FROM ai_cache WHERE user_id = ?`,
    [userId]
  );

  const tierStats = await db.execute({
    sql: `SELECT
            tier,
            COUNT(*) as count,
            SUM(tokens_used) as tokens,
            SUM(cost_cents) as cost
          FROM ai_cache
          WHERE user_id = ?
          GROUP BY tier`,
    args: [userId],
  });

  const byTier: Record<Tier, { count: number; tokens: number; cost: number }> = {
    local: { count: 0, tokens: 0, cost: 0 },
    embedding: { count: 0, tokens: 0, cost: 0 },
    fast_llm: { count: 0, tokens: 0, cost: 0 },
    full_llm: { count: 0, tokens: 0, cost: 0 },
  };

  for (const row of tierStats.rows) {
    const tier = row.tier as Tier;
    byTier[tier] = {
      count: (row.count as number) || 0,
      tokens: (row.tokens as number) || 0,
      cost: (row.cost as number) || 0,
    };
  }

  return {
    totalEntries: stats?.total_entries || 0,
    totalHits: stats?.total_hits || 0,
    totalTokens: stats?.total_tokens || 0,
    totalCostCents: stats?.total_cost || 0,
    byTier,
  };
}
